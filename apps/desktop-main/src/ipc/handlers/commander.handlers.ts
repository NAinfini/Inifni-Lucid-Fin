import type { BrowserWindow, IpcMain } from 'electron';
import log from 'electron-log';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AdapterRegistry, LLMRegistry } from '@lucid-fin/adapters-ai';
import {
  AgentOrchestrator,
  AgentToolRegistry,
  createCanvasTools,
  createCharacterTools,
  createColorStyleTools,
  createEquipmentTools,
  createJobTools,
  createSceneTools,
  createLocationTools,
  createPresetTools,
  createProjectTools,
  createRenderTools,
  createScriptTools,
  createSeriesTools,
  createWorkflowTools,
  type JobQueue,
  type WorkflowEngine,
  type AgentContext,
  type AgentEvent,
} from '@lucid-fin/application';
import { OpenAICompatibleLLM } from '@lucid-fin/adapters-ai';
import { parseScript } from '@lucid-fin/domain';
import {
  BUILT_IN_SHOT_TEMPLATES,
  createEmptyPresetTrackSet,
  type ScriptDocument,
  type Canvas,
  type CanvasEdge,
  type CanvasNode,
  type CanvasNote,
  type ProjectManifest,
  type PresetCategory,
  type PresetDefinition,
  type PresetTrackSet,
  type ShotTemplate,
} from '@lucid-fin/contracts';
import type { CAS, SqliteIndex, ProjectFS } from '@lucid-fin/storage';
import type { CanvasStore } from './canvas.handlers.js';
import { cancelCanvasGeneration, startCanvasGeneration } from './canvas-generation.handlers.js';
import { getCurrentProjectId, getCurrentProjectPath, setCurrentProject } from '../project-context.js';

type CommanderStreamPayload = {
  type: 'chunk' | 'tool_call' | 'tool_result' | 'done' | 'error' | 'tool_confirm' | 'tool_question';
  content?: string;
  toolName?: string;
  toolCallId?: string;
  arguments?: Record<string, unknown>;
  result?: unknown;
  error?: string;
  tier?: number;
  question?: string;
  options?: Array<{ label: string; description?: string }>;
  startedAt?: number;
  completedAt?: number;
};

type RunningCommanderSession = {
  aborted: boolean;
  canvasId: string;
  orchestrator?: import('@lucid-fin/application').AgentOrchestrator;
};

const runningSessions = new Map<string, RunningCommanderSession>();

// In-memory log buffer for Commander AI logger.read tool
interface MainLogEntry {
  id: string;
  timestamp: number;
  level: 'debug' | 'info' | 'warn' | 'error';
  category: string;
  message: string;
  detail?: string;
}
const LOG_BUFFER_MAX = 200;
const mainLogBuffer: MainLogEntry[] = [];
function pushLog(level: MainLogEntry['level'], category: string, message: string, detail?: string): void {
  mainLogBuffer.push({ id: `ml-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, timestamp: Date.now(), level, category, message, detail });
  if (mainLogBuffer.length > LOG_BUFFER_MAX) mainLogBuffer.splice(0, mainLogBuffer.length - LOG_BUFFER_MAX);
}
const mutatingToolNames = new Set([
  'canvas.addNode',
  'canvas.moveNode',
  'canvas.renameNode',
  'canvas.renameCanvas',
  'canvas.deleteCanvas',
  'canvas.connectNodes',
  'canvas.cutNodes',
  'canvas.setPresets',
  'canvas.layout',
  'canvas.generate',
  'canvas.cancelGeneration',
  'canvas.deleteNode',
  'canvas.deleteEdge',
  'canvas.editNodeContent',
  'canvas.setNodeProvider',
  'canvas.setCharacterRefs',
  'canvas.setEquipmentRefs',
  'canvas.setLocationRefs',
  'canvas.removeCharacterRef',
  'canvas.removeEquipmentRef',
  'canvas.removeLocationRef',
  'canvas.batchCreate',
  'canvas.writeNodePresetTracks',
  'canvas.setBackdropOpacity',
  'canvas.setBackdropColor',
  'canvas.setBackdropBorderStyle',
  'canvas.setBackdropTitleSize',
  'canvas.setBackdropLockChildren',
  'canvas.toggleBackdropCollapse',
  'canvas.addPresetTrackEntry',
  'canvas.removePresetTrackEntry',
  'canvas.updatePresetTrackEntry',
  'canvas.movePresetTrackEntry',
  'canvas.applyShotTemplate',
  'canvas.createCustomPreset',
]);

export const entityMutatingToolNames = new Set([
  'character.create',
  'character.update',
  'character.delete',
  'character.generateReferenceImage',
  'character.setReferenceImage',
  'character.deleteReferenceImage',
  'equipment.create',
  'equipment.update',
  'equipment.delete',
  'equipment.generateReferenceImage',
  'equipment.setReferenceImage',
  'equipment.deleteReferenceImage',
  'location.create',
  'location.update',
  'location.delete',
  'location.generateReferenceImage',
  'location.setReferenceImage',
  'location.deleteReferenceImage',
  'scene.create',
  'scene.update',
  'scene.delete',
]);

const MAX_CONTEXT_SELECTED_NODES = 10;
const MAX_CONTEXT_CHARACTERS = 20;
const MAX_CONTEXT_LOCATIONS = 20;
const CONTEXT_DESCRIPTION_CHAR_LIMIT = 120;
const MAX_CONTEXT_PROMPT_GUIDES = 3;
const CONTEXT_PROMPT_GUIDE_CHAR_LIMIT = 600;

function requireCanvas(store: CanvasStore, canvasId: string): Canvas {
  const canvas = store.get(canvasId);
  if (!canvas) {
    throw new Error(`Canvas not found: ${canvasId}`);
  }
  return canvas;
}

function requireNode(store: CanvasStore, canvasId: string, nodeId: string): { canvas: Canvas; node: CanvasNode } {
  const canvas = requireCanvas(store, canvasId);
  const node = canvas.nodes.find((entry) => entry.id === nodeId);
  if (!node) {
    throw new Error(`Node not found: ${nodeId}`);
  }
  return { canvas, node };
}

function touchCanvas(canvas: Canvas, store: CanvasStore): void {
  canvas.updatedAt = Date.now();
  store.save(canvas);
}

type MaterializedAsset = {
  filePath: string;
  cleanupPath?: string;
  sourceUrl?: string;
};

function makeGenerateImage(deps: {
  adapterRegistry: AdapterRegistry;
  cas: CAS;
}): (prompt: string, providerId?: string) => Promise<{ assetHash: string }> {
  return async (prompt: string, providerId?: string) => {
    const candidates = providerId
      ? deps.adapterRegistry.list('image').filter((adapter) => adapter.id === providerId)
      : deps.adapterRegistry.list('image');

    for (const adapter of candidates) {
      if (!(await adapter.validate())) {
        continue;
      }

      const generated = await adapter.generate({
        type: 'image',
        providerId: providerId ?? adapter.id,
        prompt,
        width: 1024,
        height: 1024,
      });
      const materialized = await materializeAsset(generated);
      try {
        const { ref } = await deps.cas.importAsset(materialized.filePath, 'image');
        return { assetHash: ref.hash };
      } finally {
        if (materialized.cleanupPath) {
          fs.rmSync(materialized.cleanupPath, { recursive: true, force: true });
        }
      }
    }

    throw new Error(providerId ? `Image adapter not available: ${providerId}` : 'No configured image adapter available');
  };
}

async function materializeAsset(generated: {
  assetPath?: string;
  metadata?: Record<string, unknown>;
}): Promise<MaterializedAsset> {
  const assetPath = normalizeOptionalString(generated.assetPath);
  if (assetPath) {
    if (isRemoteUrl(assetPath)) {
      return downloadRemoteAsset(assetPath);
    }
    if (!fs.existsSync(assetPath)) {
      throw new Error(`Generated asset path not found: ${assetPath}`);
    }
    return { filePath: assetPath };
  }

  const metadataUrl = normalizeOptionalString(generated.metadata?.url as string | undefined);
  if (metadataUrl) {
    return downloadRemoteAsset(metadataUrl);
  }

  throw new Error('Generated asset did not include a usable file path or URL');
}

async function downloadRemoteAsset(url: string): Promise<MaterializedAsset> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download generated asset: ${response.status}`);
  }

  const ext = inferRemoteExtension(url, response.headers.get('content-type'));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lucid-commander-'));
  const filePath = path.join(dir, `generated-${Date.now()}.${ext}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  fs.writeFileSync(filePath, buffer);

  return {
    filePath,
    cleanupPath: dir,
    sourceUrl: url,
  };
}

function inferRemoteExtension(url: string, contentType: string | null): string {
  const byUrl = extensionFromUrl(url);
  if (byUrl) return byUrl;
  const normalized = contentType?.split(';')[0].trim().toLowerCase();
  switch (normalized) {
    case 'image/jpeg':
      return 'jpg';
    case 'image/webp':
      return 'webp';
    case 'image/png':
      return 'png';
    default:
      return 'bin';
  }
}

function extensionFromUrl(url: string): string | undefined {
  try {
    const pathname = new URL(url).pathname;
    const ext = path.extname(pathname).slice(1).toLowerCase();
    return ext.length > 0 ? ext : undefined;
  } catch {
    return undefined;
  }
}

function isRemoteUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

function normalizeOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function truncateContextText(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength - 3)}...`;
}

function requireCurrentProject(): { projectId: string; projectPath: string } {
  const projectId = getCurrentProjectId();
  const projectPath = getCurrentProjectPath();
  if (!projectId || !projectPath) {
    throw new Error('No project open');
  }
  return { projectId, projectPath };
}

function getCurrentProjectSnapshot(
  db: SqliteIndex,
  projectFS: ProjectFS,
): {
  projectId: string;
  projectPath: string;
  manifest: ProjectManifest;
  projectRow?: { id: string; title: string; path: string; updatedAt: number; thumbnail?: string };
} {
  const { projectId, projectPath } = requireCurrentProject();
  const manifest = projectFS.openProject(projectPath);
  const projectRow = db.listProjects().find((entry) => entry.id === projectId);
  return { projectId, projectPath, manifest, projectRow };
}

function persistProjectSeriesId(
  db: SqliteIndex,
  projectFS: ProjectFS,
  snapshot: ReturnType<typeof getCurrentProjectSnapshot>,
  seriesId: string,
): void {
  const now = Date.now();
  snapshot.manifest.seriesId = seriesId;
  snapshot.manifest.updatedAt = now;
  projectFS.saveProject(snapshot.projectPath, snapshot.manifest);
  db.upsertProject({
    id: snapshot.projectId,
    title: snapshot.manifest.title,
    path: snapshot.projectPath,
    seriesId,
    updatedAt: snapshot.manifest.updatedAt,
    thumbnail: snapshot.projectRow?.thumbnail,
  });
}

function normalizeScriptFormat(value: unknown): 'fountain' | 'fdx' | 'plaintext' {
  return value === 'fdx' || value === 'plaintext' || value === 'fountain' ? value : 'fountain';
}

function saveScriptDocument(
  db: SqliteIndex,
  projectId: string,
  content: string,
  format: 'fountain' | 'fdx' | 'plaintext',
): ScriptDocument {
  const parsedScenes = parseScript(content, format);
  const existing = db.getScript(projectId);
  const now = Date.now();
  const doc: ScriptDocument = {
    id: existing?.id ?? crypto.randomUUID(),
    projectId,
    content,
    format,
    parsedScenes,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  db.upsertScript(doc);
  return doc;
}

async function selectConfiguredAdapter(
  llmRegistry: LLMRegistry,
  keychain: import('@lucid-fin/storage').Keychain,
  customProvider?: { id: string; name: string; baseUrl: string; model: string },
) {
  // If a custom provider is specified, create an OpenAI-compatible adapter on the fly
  if (customProvider?.baseUrl && customProvider?.model) {
    const apiKey = await keychain.getKey(customProvider.id);
    if (apiKey) {
      const adapter = new OpenAICompatibleLLM({
        id: customProvider.id,
        name: customProvider.name,
        defaultBaseUrl: customProvider.baseUrl,
        defaultModel: customProvider.model,
      });
      adapter.configure(apiKey);
      if (await adapter.validate()) return adapter;
    }
  }
  // Fall back to registered adapters
  for (const adapter of llmRegistry.list()) {
    if (await adapter.validate()) {
      return adapter;
    }
  }
  throw new Error('No configured LLM adapter. Please configure an AI provider in Settings.');
}

export function buildContext(
  canvas: Canvas,
  presetLibrary: PresetDefinition[],
  selectedNodeIds: string[],
  db: SqliteIndex,
  promptGuides?: Array<{ id: string; name: string; content: string }>,
): AgentContext {
  const selectedNodes = selectedNodeIds
    .slice(0, MAX_CONTEXT_SELECTED_NODES)
    .map((nodeId) => canvas.nodes.find((node) => node.id === nodeId))
    .filter((node): node is CanvasNode => !!node)
    .map((node) => ({
      id: node.id,
      type: node.type,
      title: node.title,
    }));

  const extra: Record<string, unknown> = {
    canvasId: canvas.id,
    presetCount: presetLibrary.length,
    presetCategories: Array.from(new Set(presetLibrary.map((preset) => preset.category))),
    canvasSnapshot: {
      name: canvas.name,
      nodeCount: canvas.nodes.length,
      edgeCount: canvas.edges.length,
      selectedNodes,
    },
  };

  if (promptGuides && promptGuides.length > 0) {
    extra.promptGuides = promptGuides
      .slice(0, MAX_CONTEXT_PROMPT_GUIDES)
      .map((guide) => `### ${guide.name}\n\n${truncateContextText(guide.content, CONTEXT_PROMPT_GUIDE_CHAR_LIMIT)}`)
      .join('\n\n---\n\n');
  }

  const pid = getCurrentProjectId();
  if (pid) {
    const chars = db.listCharacters(pid);
    if (chars.length > 0) {
      extra.characters = chars.slice(0, MAX_CONTEXT_CHARACTERS).map((c) => ({
        id: c.id,
        name: c.name,
        role: c.role,
        description: truncateContextText(c.description, CONTEXT_DESCRIPTION_CHAR_LIMIT),
      }));
    }
    const locs = db.listLocations(pid);
    if (locs.length > 0) {
      extra.locations = locs.slice(0, MAX_CONTEXT_LOCATIONS).map((l) => ({
        id: l.id,
        name: l.name,
        type: l.type,
        description: truncateContextText(l.description, CONTEXT_DESCRIPTION_CHAR_LIMIT),
      }));
    }
  }

  return { page: 'canvas', extra };
}

function emitToWindow(
  getWindow: () => BrowserWindow | null,
  channel: 'commander:stream' | 'commander:canvas:updated' | 'commander:entities:updated',
  payload: CommanderStreamPayload | { canvasId: string; canvas: Canvas } | { toolName: string },
): void {
  const win = getWindow();
  if (!win || win.isDestroyed()) {
    return;
  }
  win.webContents.send(channel, payload);
}

function validateHistoryEntries(history: Array<{ role: 'user' | 'assistant'; content: string }>): void {
  for (const entry of history) {
    if (
      !entry ||
      (entry.role !== 'user' && entry.role !== 'assistant') ||
      typeof entry.content !== 'string'
    ) {
      throw new Error('history entries must contain a valid role and content');
    }
  }
}

export function registerCommanderHandlers(
  ipcMain: IpcMain,
  getWindow: () => BrowserWindow | null,
  deps: {
    adapterRegistry: AdapterRegistry;
    llmRegistry: LLMRegistry;
    canvasStore: CanvasStore;
    presetLibrary: PresetDefinition[];
    jobQueue: JobQueue;
    workflowEngine: WorkflowEngine;
    db: SqliteIndex;
    cas: CAS;
    projectFS: ProjectFS;
    keychain: import('@lucid-fin/storage').Keychain;
    resolvePrompt: (code: string) => string;
  },
): void {
  ipcMain.handle(
    'commander:chat',
    async (
      _event,
      args: {
        canvasId: string;
        message: string;
        history: Array<{ role: 'user' | 'assistant'; content: string }>;
        selectedNodeIds: string[];
        promptGuides?: Array<{ id: string; name: string; content: string }>;
        customLLMProvider?: { id: string; name: string; baseUrl: string; model: string };
        permissionMode?: 'auto' | 'normal' | 'strict';
      },
    ) => {
      if (!args || typeof args.canvasId !== 'string' || !args.canvasId.trim()) {
        throw new Error('canvasId is required');
      }
      if (!args.message || typeof args.message !== 'string' || !args.message.trim()) {
        throw new Error('message is required');
      }
      if (!Array.isArray(args.history)) {
        throw new Error('history must be an array');
      }
      if (!Array.isArray(args.selectedNodeIds)) {
        throw new Error('selectedNodeIds must be an array');
      }
      validateHistoryEntries(args.history);
      if (runningSessions.size > 0) {
        throw new Error('Commander already has an active session');
      }

      const canvas = requireCanvas(deps.canvasStore, args.canvasId);
      const llmAdapter = await selectConfiguredAdapter(deps.llmRegistry, deps.keychain, args.customLLMProvider);
      const registry = new AgentToolRegistry();
      const generateImage = makeGenerateImage(deps);
      const listCommanderPresets = async (category?: PresetCategory): Promise<PresetDefinition[]> => {
        return deps.presetLibrary.filter((preset) => !category || preset.category === category);
      };
      const persistCommanderPreset = async (preset: PresetDefinition): Promise<PresetDefinition> => {
        const existing = deps.presetLibrary.findIndex((entry) => entry.id === preset.id);
        if (existing >= 0) {
          deps.presetLibrary[existing] = preset;
        } else {
          deps.presetLibrary.push(preset);
        }

        const projectId = getCurrentProjectId();
        if (projectId) {
          deps.db.upsertPresetOverride({
            id: preset.id,
            projectId,
            presetId: preset.id,
            category: preset.category,
            name: preset.name,
            description: preset.description ?? '',
            prompt: preset.prompt ?? '',
            params: preset.params as unknown[],
            defaults: preset.defaults as Record<string, unknown>,
            isUser: true,
            createdAt: preset.createdAt ?? Date.now(),
            updatedAt: Date.now(),
          });
        }

        return preset;
      };
      const deleteCommanderPreset = async (presetId: string): Promise<void> => {
        const presetIndex = deps.presetLibrary.findIndex((entry) => entry.id === presetId);
        if (presetIndex === -1) {
          throw new Error(`Preset not found: ${presetId}`);
        }

        const preset = deps.presetLibrary[presetIndex];
        if (preset.builtIn) {
          throw new Error(`Only custom presets can be deleted: ${presetId}`);
        }

        deps.presetLibrary.splice(presetIndex, 1);
        deps.db.deletePresetOverride(presetId);
      };
      const canvasGenerationDeps = {
        adapterRegistry: deps.adapterRegistry,
        cas: deps.cas,
        db: deps.db,
        canvasStore: deps.canvasStore,
      };

      const canvasToolDeps = {
        getCanvas: async (canvasId: string) => requireCanvas(deps.canvasStore, canvasId),
        deleteCanvas: async (canvasId: string) => {
          requireCanvas(deps.canvasStore, canvasId);
          deps.canvasStore.delete(canvasId);
        },
        addNode: async (canvasId: string, node: CanvasNode) => {
          const current = requireCanvas(deps.canvasStore, canvasId);
          current.nodes.push(node);
          touchCanvas(current, deps.canvasStore);
        },
        moveNode: async (canvasId: string, nodeId: string, position: { x: number; y: number }) => {
          const { canvas: current, node } = requireNode(deps.canvasStore, canvasId, nodeId);
          node.position = position;
          node.updatedAt = Date.now();
          touchCanvas(current, deps.canvasStore);
        },
        renameNode: async (canvasId: string, nodeId: string, title: string) => {
          const { canvas: current, node } = requireNode(deps.canvasStore, canvasId, nodeId);
          node.title = title;
          node.updatedAt = Date.now();
          touchCanvas(current, deps.canvasStore);
        },
        renameCanvas: async (canvasId: string, name: string) => {
          const current = requireCanvas(deps.canvasStore, canvasId);
          current.name = name;
          touchCanvas(current, deps.canvasStore);
        },
        loadCanvas: async (canvasId: string) => {
          requireCanvas(deps.canvasStore, canvasId);
        },
        saveCanvas: async (canvasId: string) => {
          const current = requireCanvas(deps.canvasStore, canvasId);
          touchCanvas(current, deps.canvasStore);
        },
        connectNodes: async (canvasId: string, edge: CanvasEdge) => {
          const current = requireCanvas(deps.canvasStore, canvasId);
          current.edges.push(edge);
          touchCanvas(current, deps.canvasStore);
        },
        setNodePresets: async (canvasId: string, nodeId: string, presetTracks: PresetTrackSet) => {
          const { canvas: current, node } = requireNode(deps.canvasStore, canvasId, nodeId);
          if (node.type !== 'image' && node.type !== 'video') {
            throw new Error(`Node type "${node.type}" does not support presets`);
          }
          (
            node.data as {
              presetTracks?: PresetTrackSet;
            }
          ).presetTracks = presetTracks ?? createEmptyPresetTrackSet();
          node.updatedAt = Date.now();
          touchCanvas(current, deps.canvasStore);
        },
        getCanvasState: async (canvasId: string) => requireCanvas(deps.canvasStore, canvasId),
        layoutNodes: async () => undefined,
        triggerGeneration: async (
          canvasId: string,
          nodeId: string,
          providerId?: string,
          variantCount?: number,
        ) => {
          const win = getWindow();
          if (!win || win.isDestroyed()) {
            throw new Error('Main window is not available');
          }
          await startCanvasGeneration(
            win.webContents,
            {
              canvasId,
              nodeId,
              providerId,
              variantCount,
            },
            canvasGenerationDeps,
          );
        },
        cancelGeneration: async (canvasId: string, nodeId: string) => {
          const win = getWindow();
          if (!win || win.isDestroyed()) {
            throw new Error('Main window is not available');
          }
          await cancelCanvasGeneration(
            win.webContents,
            { canvasId, nodeId },
            canvasGenerationDeps,
          );
        },
        deleteNode: async (canvasId: string, nodeId: string) => {
          const current = requireCanvas(deps.canvasStore, canvasId);
          const idx = current.nodes.findIndex((n) => n.id === nodeId);
          if (idx === -1) throw new Error(`Node not found: ${nodeId}`);
          current.nodes.splice(idx, 1);
          current.edges = current.edges.filter(
            (e) => e.source !== nodeId && e.target !== nodeId,
          );
          touchCanvas(current, deps.canvasStore);
        },
        deleteEdge: async (canvasId: string, edgeId: string) => {
          const current = requireCanvas(deps.canvasStore, canvasId);
          const idx = current.edges.findIndex((e) => e.id === edgeId);
          if (idx === -1) throw new Error(`Edge not found: ${edgeId}`);
          current.edges.splice(idx, 1);
          touchCanvas(current, deps.canvasStore);
        },
        updateNodeData: async (canvasId: string, nodeId: string, data: Record<string, unknown>) => {
          const { canvas: current, node } = requireNode(deps.canvasStore, canvasId, nodeId);
          Object.assign(node.data, data);
          node.updatedAt = Date.now();
          touchCanvas(current, deps.canvasStore);
        },
        listPresets: listCommanderPresets,
        savePreset: persistCommanderPreset,
        listShotTemplates: async (): Promise<ShotTemplate[]> => {
          return [...BUILT_IN_SHOT_TEMPLATES];
        },
        removeCharacterRef: async (canvasId: string, nodeId: string, characterId: string) => {
          const { canvas: current, node } = requireNode(deps.canvasStore, canvasId, nodeId);
          if (node.type !== 'image' && node.type !== 'video') {
            throw new Error(`Node type "${node.type}" does not support character refs`);
          }
          const refs = ((node.data as { characterRefs?: Array<{ characterId: string }> }).characterRefs ?? [])
            .filter((entry) => entry.characterId !== characterId);
          (node.data as { characterRefs?: Array<{ characterId: string }> }).characterRefs = refs;
          node.updatedAt = Date.now();
          touchCanvas(current, deps.canvasStore);
        },
        removeEquipmentRef: async (canvasId: string, nodeId: string, equipmentId: string) => {
          const { canvas: current, node } = requireNode(deps.canvasStore, canvasId, nodeId);
          if (node.type !== 'image' && node.type !== 'video') {
            throw new Error(`Node type "${node.type}" does not support equipment refs`);
          }
          const refs = ((node.data as { equipmentRefs?: Array<{ equipmentId: string }> }).equipmentRefs ?? [])
            .filter((entry) => entry.equipmentId !== equipmentId);
          (node.data as { equipmentRefs?: Array<{ equipmentId: string }> }).equipmentRefs = refs;
          node.updatedAt = Date.now();
          touchCanvas(current, deps.canvasStore);
        },
        removeLocationRef: async (canvasId: string, nodeId: string, locationId: string) => {
          const { canvas: current, node } = requireNode(deps.canvasStore, canvasId, nodeId);
          if (node.type !== 'image' && node.type !== 'video') {
            throw new Error(`Node type "${node.type}" does not support location refs`);
          }
          const refs = ((node.data as { locationRefs?: Array<{ locationId: string }> }).locationRefs ?? [])
            .filter((entry) => entry.locationId !== locationId);
          (node.data as { locationRefs?: Array<{ locationId: string }> }).locationRefs = refs;
          node.updatedAt = Date.now();
          touchCanvas(current, deps.canvasStore);
        },
        listLLMProviders: async () => {
          const results = [];
          for (const a of deps.llmRegistry.list()) {
            const hasKey = await deps.keychain.isConfigured(a.id);
            results.push({
              id: a.id,
              name: a.name,
              model: (a as unknown as { defaultModel?: string }).defaultModel ?? '',
              hasKey,
            });
          }
          return results;
        },
        setActiveLLMProvider: async (providerId: string) => {
          const adapter = deps.llmRegistry.list().find((a) => a.id === providerId);
          if (!adapter) throw new Error(`LLM provider not found: ${providerId}`);
          const win = getWindow();
          if (win) {
            win.webContents.send('settings:setActiveLLM', { providerId });
          }
        },
        setLLMProviderApiKey: async (providerId: string, apiKey: string) => {
          const mediaAdapter = deps.adapterRegistry.get(providerId);
          if (mediaAdapter) mediaAdapter.configure(apiKey);
          const llmProvider = deps.llmRegistry.list().find((a) => a.id === providerId);
          if (llmProvider) llmProvider.configure(apiKey);
          await deps.keychain.setKey(providerId, apiKey);
          const win = getWindow();
          if (win) {
            win.webContents.send('settings:providerKeyUpdated', { group: 'provider', providerId, hasKey: true });
          }
        },
        deleteProviderKey: async (providerId: string) => {
          await deps.keychain.deleteKey(providerId);
          const mediaAdapter = deps.adapterRegistry.get(providerId);
          if (mediaAdapter) mediaAdapter.configure('');
          const llmProvider = deps.llmRegistry.list().find((a) => a.id === providerId);
          if (llmProvider) llmProvider.configure('');
          const win = getWindow();
          if (win) {
            win.webContents.send('settings:providerKeyUpdated', { group: 'provider', providerId, hasKey: false });
          }
        },
        clearSelection: async (_canvasId: string) => {},
        setNodeColorTag: async (canvasId: string, nodeId: string, color: string | undefined) => {
          const { canvas: cur, node } = requireNode(deps.canvasStore, canvasId, nodeId);
          node.colorTag = color;
          node.updatedAt = Date.now();
          touchCanvas(cur, deps.canvasStore);
        },
        toggleSeedLock: async (canvasId: string, nodeId: string) => {
          const { canvas: cur, node } = requireNode(deps.canvasStore, canvasId, nodeId);
          (node.data as { seedLocked?: boolean }).seedLocked = !(node.data as { seedLocked?: boolean }).seedLocked;
          node.updatedAt = Date.now();
          touchCanvas(cur, deps.canvasStore);
        },
        selectVariant: async (canvasId: string, nodeId: string, index: number) => {
          const { canvas: cur, node } = requireNode(deps.canvasStore, canvasId, nodeId);
          (node.data as { selectedVariantIndex?: number }).selectedVariantIndex = index;
          node.updatedAt = Date.now();
          touchCanvas(cur, deps.canvasStore);
        },
        estimateCost: async () => ({ totalEstimatedCost: 0, currency: 'USD', nodeCosts: [] }),
        addNote: async (_canvasId: string, content: string): Promise<CanvasNote> => {
          const now = Date.now();
          return { id: `note-${content.slice(0, 8)}-${now}`, content, createdAt: now, updatedAt: now };
        },
        getRecentLogs: async (level?: string, category?: string, limit?: number) => {
          let entries: MainLogEntry[] = [...mainLogBuffer];
          if (level) entries = entries.filter((e) => e.level === level);
          if (category) entries = entries.filter((e) => e.category === category);
          return entries.slice(-(limit ?? 50)) as unknown as Array<Record<string, unknown>>;
        },
        updateNote: async () => {},
        deleteNote: async () => {},
        undo: async () => {},
        redo: async () => {},
        importWorkflow: async (canvasId: string, _json: string): Promise<Canvas> => {
          return requireCanvas(deps.canvasStore, canvasId);
        },
        exportWorkflow: async (_canvasId: string) => '{}',
      };

      for (const tool of createCanvasTools(canvasToolDeps)) {
        registry.register(tool);
      }

      for (const tool of createScriptTools({
        loadScript: async (filePath?: string) => {
          if (!filePath) {
            const projectId = getCurrentProjectId();
            return projectId ? deps.db.getScript(projectId) : null;
          }
          const resolved = path.resolve(filePath);
          if (!fs.existsSync(resolved) || fs.statSync(resolved).isDirectory()) {
            throw new Error(`Script file not found: ${resolved}`);
          }
          const { projectId } = requireCurrentProject();
          const content = fs.readFileSync(resolved, 'utf-8');
          const ext = path.extname(resolved).toLowerCase();
          const format =
            ext === '.fountain' ? 'fountain' : ext === '.fdx' ? 'fdx' : 'plaintext';
          return saveScriptDocument(deps.db, projectId, content, format);
        },
        saveScript: async (content: string) => {
          const { projectId } = requireCurrentProject();
          saveScriptDocument(deps.db, projectId, content, 'fountain');
        },
        parseScript: (content: string) => parseScript(content, 'fountain'),
        importScript: async (content: string, format?: string) => {
          const { projectId } = requireCurrentProject();
          const normalizedFormat = normalizeScriptFormat(format);
          const doc = saveScriptDocument(deps.db, projectId, content, normalizedFormat);
          return {
            content: doc.content,
            parsedScenes: doc.parsedScenes,
            format: doc.format,
          };
        },
      })) {
        registry.register(tool);
      }
      for (const tool of createCharacterTools({
        listCharacters: async () => {
          const projectId = getCurrentProjectId();
          return projectId ? deps.db.listCharacters(projectId) : [];
        },
        saveCharacter: async (c) => deps.db.upsertCharacter(c),
        deleteCharacter: async (id) => deps.db.deleteCharacter(id),
        generateImage,
      })) {
        registry.register(tool);
      }
      for (const tool of createSceneTools({
        listScenes: async () => {
          const projectId = getCurrentProjectId();
          return projectId ? deps.db.listScenes(projectId) : [];
        },
        createScene: async (s) => deps.db.upsertScene(s),
        updateScene: async (s) => deps.db.upsertScene(s),
        deleteScene: async (id) => deps.db.deleteScene(id),
      })) {
        registry.register(tool);
      }
      for (const tool of createLocationTools({
        listLocations: async () => {
          const projectId = getCurrentProjectId();
          return projectId ? deps.db.listLocations(projectId) : [];
        },
        saveLocation: async (l) => deps.db.upsertLocation(l),
        deleteLocation: async (id) => deps.db.deleteLocation(id),
        generateImage,
      })) {
        registry.register(tool);
      }
      for (const tool of createEquipmentTools({
        listEquipment: async () => {
          const projectId = getCurrentProjectId();
          return projectId ? deps.db.listEquipment(projectId) : [];
        },
        saveEquipment: async (e) => deps.db.upsertEquipment(e),
        deleteEquipment: async (id) => deps.db.deleteEquipment(id),
        generateImage,
      })) {
        registry.register(tool);
      }
      for (const tool of createJobTools({
        listJobs: async () => {
          const projectId = getCurrentProjectId();
          return deps.db.listJobs(projectId ? { projectId } : undefined).map((job) => ({
            id: job.id,
            status: job.status,
            nodeId:
              job.params &&
              typeof job.params === 'object' &&
              typeof (job.params as { nodeId?: unknown }).nodeId === 'string'
                ? ((job.params as { nodeId: string }).nodeId)
                : undefined,
          }));
        },
        cancelJob: async (jobId: string) => {
          deps.jobQueue.cancel(jobId);
        },
        pauseJob: async (jobId: string) => {
          deps.jobQueue.pause(jobId);
        },
        resumeJob: async (jobId: string) => {
          deps.jobQueue.resume(jobId);
        },
      })) {
        registry.register(tool);
      }
      const ensureCommanderSeriesId = () => {
        const snapshot = getCurrentProjectSnapshot(deps.db, deps.projectFS);
        if (snapshot.manifest.seriesId) {
          return { snapshot, seriesId: snapshot.manifest.seriesId };
        }

        const now = Date.now();
        const seriesId = crypto.randomUUID();
        deps.db.upsertSeries({
          id: seriesId,
          title: snapshot.manifest.title,
          description: '',
          styleGuide: snapshot.manifest.styleGuide,
          episodeIds: [],
          createdAt: now,
          updatedAt: now,
        });
        persistProjectSeriesId(deps.db, deps.projectFS, snapshot, seriesId);
        return { snapshot, seriesId };
      };

      for (const tool of createSeriesTools({
        getSeries: async () => {
          const snapshot = getCurrentProjectSnapshot(deps.db, deps.projectFS);
          return snapshot.manifest.seriesId ? deps.db.getSeries(snapshot.manifest.seriesId) ?? null : null;
        },
        saveSeries: async (data: Record<string, unknown>) => {
          const snapshot = getCurrentProjectSnapshot(deps.db, deps.projectFS);
          const existingId =
            typeof data.id === 'string' && data.id.trim().length > 0
              ? data.id.trim()
              : snapshot.manifest.seriesId;
          const existingSeries = existingId ? deps.db.getSeries(existingId) : undefined;
          const now = Date.now();
          const seriesId = existingId ?? crypto.randomUUID();
          const episodeIds = Array.isArray(data.episodeIds)
            ? data.episodeIds.filter((entry): entry is string => typeof entry === 'string')
            : existingSeries?.episodeIds ?? deps.db.listEpisodes(seriesId).map((episode) => episode.id);

          deps.db.upsertSeries({
            id: seriesId,
            title:
              typeof data.title === 'string'
                ? data.title
                : existingSeries?.title ?? snapshot.manifest.title,
            description:
              typeof data.description === 'string'
                ? data.description
                : existingSeries?.description ?? '',
            styleGuide:
              data.styleGuide && typeof data.styleGuide === 'object' && !Array.isArray(data.styleGuide)
                ? data.styleGuide as ProjectManifest['styleGuide']
                : existingSeries?.styleGuide ?? snapshot.manifest.styleGuide,
            episodeIds,
            createdAt:
              typeof data.createdAt === 'number'
                ? data.createdAt
                : existingSeries?.createdAt ?? now,
            updatedAt: now,
          });

          if (snapshot.manifest.seriesId !== seriesId) {
            persistProjectSeriesId(deps.db, deps.projectFS, snapshot, seriesId);
          }

          return deps.db.getSeries(seriesId) ?? null;
        },
        listEpisodes: async () => {
          const snapshot = getCurrentProjectSnapshot(deps.db, deps.projectFS);
          if (!snapshot.manifest.seriesId) {
            return [];
          }
          return deps.db.listEpisodes(snapshot.manifest.seriesId).map((episode) => ({
            id: episode.id,
            title: episode.title,
            canvasId: episode.projectId ?? undefined,
          }));
        },
        addEpisode: async (title: string, canvasId?: string) => {
          const { seriesId } = ensureCommanderSeriesId();
          const existingEpisodes = deps.db.listEpisodes(seriesId);
          const now = Date.now();
          const episodeId = crypto.randomUUID();
          deps.db.upsertEpisode({
            id: episodeId,
            seriesId,
            title,
            order: existingEpisodes.length,
            projectId: canvasId,
            status: 'draft',
            createdAt: now,
            updatedAt: now,
          });

          const series = deps.db.getSeries(seriesId);
          if (series) {
            deps.db.upsertSeries({
              ...series,
              episodeIds: [...new Set([...series.episodeIds, episodeId])],
              updatedAt: now,
            });
          }

          return { id: episodeId };
        },
        removeEpisode: async (episodeId: string) => {
          const snapshot = getCurrentProjectSnapshot(deps.db, deps.projectFS);
          const series = snapshot.manifest.seriesId ? deps.db.getSeries(snapshot.manifest.seriesId) : undefined;
          deps.db.deleteEpisode(episodeId);
          if (series) {
            deps.db.upsertSeries({
              ...series,
              episodeIds: series.episodeIds.filter((id) => id !== episodeId),
              updatedAt: Date.now(),
            });
          }
        },
        reorderEpisodes: async (episodeIds: string[]) => {
          const snapshot = getCurrentProjectSnapshot(deps.db, deps.projectFS);
          if (!snapshot.manifest.seriesId) {
            return [];
          }
          const episodes = deps.db.listEpisodes(snapshot.manifest.seriesId);
          for (let index = 0; index < episodeIds.length; index += 1) {
            const episode = episodes.find((entry) => entry.id === episodeIds[index]);
            if (episode) {
              deps.db.upsertEpisode({
                ...episode,
                projectId: episode.projectId ?? undefined,
                order: index,
                updatedAt: Date.now(),
              });
            }
          }
          return deps.db.listEpisodes(snapshot.manifest.seriesId);
        },
      })) {
        registry.register(tool);
      }
      for (const tool of createColorStyleTools({
        listColorStyles: async () => deps.db.listColorStyles(),
        saveColorStyle: async (style: Record<string, unknown>) => {
          if (
            typeof style.id !== 'string' ||
            typeof style.name !== 'string' ||
            style.id.trim().length === 0 ||
            style.name.trim().length === 0
          ) {
            throw new Error('style.id and style.name are required');
          }
          deps.db.upsertColorStyle(style as unknown as Parameters<typeof deps.db.upsertColorStyle>[0]);
        },
        deleteColorStyle: async (id: string) => {
          deps.db.deleteColorStyle(id);
        },
      })) {
        registry.register(tool);
      }
      for (const tool of createProjectTools({
        listProjects: async () => {
          return deps.db.listProjects().map((p) => ({
            id: p.id,
            title: p.title,
            path: p.path,
            updatedAt: p.updatedAt,
          }));
        },
        createSnapshot: async (name: string) => {
          const now = Date.now();
          return { id: `snapshot-${now}`, name, createdAt: now };
        },
        listSnapshots: async () => {
          return [];
        },
        restoreSnapshot: async (_snapshotId: string) => {},
      })) {
        registry.register(tool);
      }
      for (const tool of createRenderTools({
        startRender: async () => {
          throw new Error('Not implemented yet');
        },
        cancelRender: async () => {
          throw new Error('Not implemented yet');
        },
        exportBundle: async () => {
          throw new Error('Not implemented yet');
        },
      })) {
        registry.register(tool);
      }
      for (const tool of createPresetTools({
        listPresets: listCommanderPresets,
        savePreset: persistCommanderPreset,
        deletePreset: deleteCommanderPreset,
        resetPreset: async (presetId: string) => {
          const original = deps.presetLibrary.find((p) => p.id === presetId);
          if (!original) throw new Error(`Preset not found: ${presetId}`);
          const idx = deps.presetLibrary.findIndex((p) => p.id === presetId);
          const reset: PresetDefinition = { ...original, modified: false, updatedAt: Date.now() };
          if (idx >= 0) deps.presetLibrary[idx] = reset;
          return reset;
        },
        getPreset: async (presetId: string) => {
          return deps.presetLibrary.find((p) => p.id === presetId) ?? null;
        },
      })) {
        registry.register(tool);
      }
      for (const tool of createWorkflowTools({
        pauseWorkflow: async (id: string) => {
          await deps.workflowEngine.pause(id);
        },
        resumeWorkflow: async (id: string) => {
          await deps.workflowEngine.resume(id);
        },
        cancelWorkflow: async (id: string) => {
          await deps.workflowEngine.cancel(id);
        },
        retryWorkflow: async (id: string) => {
          await deps.workflowEngine.retryWorkflow(id);
        },
      })) {
        registry.register(tool);
      }

      const orchestrator = new AgentOrchestrator(llmAdapter, registry, deps.resolvePrompt);
      const session: RunningCommanderSession = { aborted: false, canvasId: args.canvasId, orchestrator };
      runningSessions.set(args.canvasId, session);

      const context = buildContext(canvas, deps.presetLibrary, args.selectedNodeIds, deps.db, args.promptGuides);

      const emit = (event: AgentEvent) => {
        const payload: CommanderStreamPayload =
          event.type === 'stream_chunk'
            ? { type: 'chunk', content: event.content }
            : event.type === 'tool_call'
              ? {
                  type: 'tool_call',
                  toolName: event.toolName,
                  toolCallId: event.toolCallId,
                  arguments: event.arguments,
                  startedAt: event.startedAt,
                }
              : event.type === 'tool_result'
                ? {
                    type: 'tool_result',
                    toolName: event.toolName,
                    toolCallId: event.toolCallId,
                    result: event.result,
                    startedAt: event.startedAt,
                    completedAt: event.completedAt,
                  }
                : event.type === 'tool_confirm'
                  ? {
                      type: 'tool_confirm',
                      toolName: event.toolName,
                      toolCallId: event.toolCallId,
                      arguments: event.arguments,
                      tier: event.tier,
                    }
                  : event.type === 'tool_question'
                    ? {
                        type: 'tool_question',
                        toolName: event.toolName,
                        toolCallId: event.toolCallId,
                        question: event.question,
                        options: event.options,
                      }
                    : event.type === 'done'
                      ? { type: 'done', content: event.content }
                      : {
                          type: 'error',
                          toolCallId: event.toolCallId,
                          error: event.error,
                          startedAt: event.startedAt,
                          completedAt: event.completedAt,
                        };

        emitToWindow(getWindow, 'commander:stream', payload);

        // Mirror events to main-process log buffer for logger.read
        if (event.type === 'tool_call') {
          pushLog('debug', 'commander', `Tool: ${event.toolName}`, event.arguments ? JSON.stringify(event.arguments).slice(0, 500) : undefined);
        } else if (event.type === 'tool_result') {
          const resultStr = event.result != null ? JSON.stringify(event.result).slice(0, 500) : '';
          pushLog('debug', 'commander', `Result: ${event.toolName}`, resultStr);
        } else if (event.type === 'error') {
          pushLog('error', 'commander', event.error ?? 'Unknown error', event.toolCallId ? `Tool call: ${event.toolCallId}` : undefined);
        } else if (event.type === 'done') {
          pushLog('info', 'commander', 'Session complete');
        }

        if (event.type === 'tool_result' && event.toolName && mutatingToolNames.has(event.toolName)) {
          const updatedCanvas = deps.canvasStore.get(args.canvasId);
          if (updatedCanvas) {
            emitToWindow(getWindow, 'commander:canvas:updated', {
              canvasId: args.canvasId,
              canvas: updatedCanvas,
            });
          }
        }

        if (event.type === 'tool_result' && event.toolName && entityMutatingToolNames.has(event.toolName)) {
          emitToWindow(getWindow, 'commander:entities:updated', { toolName: event.toolName });
        }
      };

      try {
        await orchestrator.execute(args.message, context, emit, {
          history: args.history,
          isAborted: () => session.aborted,
          permissionMode: args.permissionMode ?? 'normal',
        });
      } catch (error) {
        log.error('Commander chat failed', error);
        emitToWindow(getWindow, 'commander:stream', {
          type: 'error',
          error: error instanceof Error ? error.message : String(error),
        });
      } finally {
        runningSessions.delete(args.canvasId);
      }
    },
  );

  ipcMain.handle('commander:cancel', async (_event, args: { canvasId: string }) => {
    if (!args || typeof args.canvasId !== 'string' || !args.canvasId.trim()) {
      throw new Error('canvasId is required');
    }
    const session = runningSessions.get(args.canvasId);
    if (session) {
      session.aborted = true;
    }
  });

  ipcMain.handle(
    'commander:inject-message',
    async (_event, args: { canvasId: string; message: string }) => {
      if (!args || typeof args.canvasId !== 'string' || !args.canvasId.trim()) {
        throw new Error('canvasId is required');
      }
      if (typeof args.message !== 'string' || !args.message.trim()) {
        throw new Error('message is required');
      }
      const session = runningSessions.get(args.canvasId);
      if (!session?.orchestrator) {
        throw new Error('Commander has no active session');
      }
      session.orchestrator.injectMessage(args.message);
    },
  );

  ipcMain.handle(
    'commander:tool:decision',
    async (_event, args: { canvasId: string; toolCallId: string; approved: boolean }) => {
      if (!args || typeof args.canvasId !== 'string' || !args.canvasId.trim()) {
        throw new Error('canvasId is required');
      }
      if (typeof args.toolCallId !== 'string' || !args.toolCallId.trim()) {
        throw new Error('toolCallId is required');
      }
      const session = runningSessions.get(args.canvasId);
      if (session?.orchestrator) {
        session.orchestrator.confirmTool(args.toolCallId, !!args.approved);
      }
    },
  );

  ipcMain.handle(
    'commander:tool:answer',
    async (_event, args: { canvasId: string; toolCallId: string; answer: string }) => {
      if (!args || typeof args.canvasId !== 'string' || !args.canvasId.trim()) {
        throw new Error('canvasId is required');
      }
      if (typeof args.toolCallId !== 'string' || !args.toolCallId.trim()) {
        throw new Error('toolCallId is required');
      }
      if (typeof args.answer !== 'string') {
        throw new Error('answer is required');
      }
      const session = runningSessions.get(args.canvasId);
      if (session?.orchestrator) {
        session.orchestrator.answerQuestion(args.toolCallId, args.answer);
      }
    },
  );
}
