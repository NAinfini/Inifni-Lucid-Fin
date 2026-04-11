/**
 * Commander tool dependency wiring.
 *
 * Builds all the tool-dep objects and registers tools with the AgentToolRegistry.
 * Extracted from commander.handlers.ts for maintainability.
 */
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import os from 'node:os';
import type { AdapterRegistry, LLMRegistry } from '@lucid-fin/adapters-ai';
import { buildRuntimeLLMAdapter } from '@lucid-fin/adapters-ai';
import {
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
  createProviderTools,
  createScriptTools,
  createSeriesTools,
  createMetaTools,
  createWorkflowTools,
  createUtilityWorkflowTools,
  createCopywritingTools,
  createVisionTools,
  type JobQueue,
  type WorkflowEngine,
} from '@lucid-fin/application';
import { parseScript } from '@lucid-fin/domain';
import {
  BUILT_IN_SHOT_TEMPLATES,
  createEmptyPresetTrackSet,
  type Canvas,
  type CanvasEdge,
  type CanvasNode,
  type CanvasNote,
  type ProjectManifest,
  type PresetCategory,
  type PresetDefinition,
  type PresetTrackSet,
  type ShotTemplate,
  normalizeLLMProviderRuntimeConfig,
  getBuiltinVisionProviderPreset,
} from '@lucid-fin/contracts';
import type { CAS, SqliteIndex, ProjectFS } from '@lucid-fin/storage';
import type { CanvasStore } from './canvas.handlers.js';
import { startCanvasGeneration, cancelCanvasGeneration } from './canvas-generation.handlers.js';
import { getCurrentProjectId, getCurrentProjectPath } from '../project-context.js';
import { getCachedProviders } from '../settings-cache.js';
import { getBufferedLogs } from '../../logger.js';
import { makeGenerateImage } from './commander-image-gen.js';
import { emitToWindow } from './commander-emit.js';
import type { BrowserWindow } from 'electron';
import { createVideoTools } from './video-tools.js';
import { detectScenes, extractFrameAtTime } from '@lucid-fin/media-engine';

// ---------------------------------------------------------------------------
// Shared helpers (also used directly by registerCommanderHandlers)
// ---------------------------------------------------------------------------

export function requireCanvas(store: CanvasStore, canvasId: string): Canvas {
  const canvas = store.get(canvasId);
  if (!canvas) {
    throw new Error(`Canvas not found: ${canvasId}`);
  }
  return canvas;
}

export function requireNode(
  store: CanvasStore,
  canvasId: string,
  nodeId: string,
): { canvas: Canvas; node: CanvasNode } {
  const canvas = requireCanvas(store, canvasId);
  const node = canvas.nodes.find((entry) => entry.id === nodeId);
  if (!node) {
    throw new Error(`Node not found: ${nodeId}`);
  }
  return { canvas, node };
}

export function touchCanvas(canvas: Canvas, store: CanvasStore): void {
  canvas.updatedAt = Date.now();
  store.save(canvas);
}

export function requireCurrentProject(): { projectId: string; projectPath: string } {
  const projectId = getCurrentProjectId();
  const projectPath = getCurrentProjectPath();
  if (!projectId || !projectPath) {
    throw new Error('No project open');
  }
  return { projectId, projectPath };
}

export function getCurrentProjectSnapshot(
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

export function persistProjectSeriesId(
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
) {
  const parsedScenes = parseScript(content, format);
  const existing = db.getScript(projectId);
  const now = Date.now();
  const doc = {
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

// ---------------------------------------------------------------------------
// Main registration
// ---------------------------------------------------------------------------

export interface ToolRegistrationDeps {
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
}

export function registerAllTools(
  registry: AgentToolRegistry,
  deps: ToolRegistrationDeps,
  getWindow: () => BrowserWindow | null,
  promptGuides: Array<{ id: string; name: string; content: string }>,
): void {
  const generateImage = makeGenerateImage(deps);

  // ---- Preset helpers (shared by canvas + preset tools) ----
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

  // ---- Canvas generation deps ----
  const canvasGenerationDeps = {
    adapterRegistry: deps.adapterRegistry,
    cas: deps.cas,
    db: deps.db,
    canvasStore: deps.canvasStore,
    keychain: deps.keychain,
  };

  // ---- Canvas tool deps ----
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
          appliedShotTemplateId?: string;
          appliedShotTemplateName?: string;
        }
      ).presetTracks = presetTracks ?? createEmptyPresetTrackSet();
      delete (node.data as { appliedShotTemplateId?: string }).appliedShotTemplateId;
      delete (node.data as { appliedShotTemplateName?: string }).appliedShotTemplateName;
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
        { canvasId, nodeId, providerId, variantCount },
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
        emitToWindow(getWindow, 'commander:settings:dispatch', {
          action: 'setProviderId',
          payload: { providerId },
        });
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
      let entries = getBufferedLogs();
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

  // ---- Script tools ----
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

  // ---- Entity tools ----
  for (const tool of createCharacterTools({
    listCharacters: async () => {
      const projectId = getCurrentProjectId();
      return projectId ? deps.db.listCharacters(projectId) : [];
    },
    saveCharacter: async (c) => {
      const projectId = getCurrentProjectId() ?? '';
      deps.db.upsertCharacter({ ...c, projectId });
    },
    deleteCharacter: async (id) => deps.db.deleteCharacter(id),
    generateImage,
    getCanvas: async (canvasId: string) => requireCanvas(deps.canvasStore, canvasId),
  })) {
    registry.register(tool);
  }
  for (const tool of createSceneTools({
    listScenes: async () => {
      const projectId = getCurrentProjectId();
      return projectId ? deps.db.listScenes(projectId) : [];
    },
    createScene: async (s) => {
      const projectId = getCurrentProjectId() ?? '';
      deps.db.upsertScene({ ...s, projectId });
    },
    updateScene: async (s) => {
      const projectId = getCurrentProjectId() ?? '';
      deps.db.upsertScene({ ...s, projectId });
    },
    deleteScene: async (id) => deps.db.deleteScene(id),
    getCanvas: async (canvasId: string) => requireCanvas(deps.canvasStore, canvasId),
  })) {
    registry.register(tool);
  }
  for (const tool of createLocationTools({
    listLocations: async () => {
      const projectId = getCurrentProjectId();
      return projectId ? deps.db.listLocations(projectId) : [];
    },
    saveLocation: async (l) => {
      const projectId = getCurrentProjectId() ?? '';
      deps.db.upsertLocation({ ...l, projectId });
    },
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
    saveEquipment: async (e) => {
      const projectId = getCurrentProjectId() ?? '';
      deps.db.upsertEquipment({ ...e, projectId });
    },
    deleteEquipment: async (id) => deps.db.deleteEquipment(id),
    generateImage,
    getCanvas: async (canvasId: string) => requireCanvas(deps.canvasStore, canvasId),
  })) {
    registry.register(tool);
  }

  // ---- Job tools ----
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
    cancelJob: async (jobId: string) => { deps.jobQueue.cancel(jobId); },
    pauseJob: async (jobId: string) => { deps.jobQueue.pause(jobId); },
    resumeJob: async (jobId: string) => { deps.jobQueue.resume(jobId); },
  })) {
    registry.register(tool);
  }

  // ---- Series tools ----
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

  // ---- Color style tools ----
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

  // ---- Provider tools ----
  for (const tool of createProviderTools({
    listProviders: async (group: string) => {
      return getCachedProviders(group).map(p => ({
        id: p.id,
        name: p.name,
        baseUrl: p.baseUrl,
        model: p.model,
        isCustom: p.isCustom,
        hasKey: p.hasKey,
      }));
    },
    getActiveProvider: async (group: string) => {
      const providers = getCachedProviders(group);
      return providers[0]?.id ?? null;
    },
    setActiveProvider: async (group: string, providerId: string) => {
      const win = getWindow();
      if (!win) return;
      if (group === 'llm') {
        emitToWindow(getWindow, 'commander:settings:dispatch', {
          action: 'setProviderId',
          payload: { providerId },
        });
        return;
      }
      throw new Error(
        `Global active provider is no longer supported for ${group}; select the provider in the generation UI instead.`,
      );
    },
    setProviderBaseUrl: async (group: string, providerId: string, baseUrl: string) => {
      const win = getWindow();
      if (!win) return;
      emitToWindow(getWindow, 'commander:settings:dispatch', { action: 'setProviderBaseUrl', payload: { group, provider: providerId, baseUrl } });
    },
    setProviderModel: async (group: string, providerId: string, model: string) => {
      const win = getWindow();
      if (!win) return;
      emitToWindow(getWindow, 'commander:settings:dispatch', { action: 'setProviderModel', payload: { group, provider: providerId, model } });
    },
    setProviderName: async (group: string, providerId: string, name: string) => {
      const win = getWindow();
      if (!win) return;
      emitToWindow(getWindow, 'commander:settings:dispatch', { action: 'setProviderName', payload: { group, provider: providerId, name } });
    },
    addCustomProvider: async (group: string, id: string, name: string, baseUrl?: string, model?: string) => {
      emitToWindow(getWindow, 'commander:settings:dispatch', { action: 'addCustomProvider', payload: { group, id, name, baseUrl, model } });
    },
    removeCustomProvider: async (group: string, providerId: string) => {
      emitToWindow(getWindow, 'commander:settings:dispatch', { action: 'removeCustomProvider', payload: { group, provider: providerId } });
    },
  })) {
    registry.register(tool);
  }

  // ---- Project tools ----
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

  // ---- Preset tools ----
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

  // ---- Workflow tools ----
  for (const tool of createWorkflowTools({
    pauseWorkflow: async (id: string) => { await deps.workflowEngine.pause(id); },
    resumeWorkflow: async (id: string) => { await deps.workflowEngine.resume(id); },
    cancelWorkflow: async (id: string) => { await deps.workflowEngine.cancel(id); },
    retryWorkflow: async (id: string) => { await deps.workflowEngine.retryWorkflow(id); },
  })) {
    registry.register(tool);
  }

  // ---- Meta + utility tools ----
  for (const tool of createMetaTools(registry, {
    promptGuides: promptGuides,
    context: 'canvas',
  })) {
    registry.register(tool);
  }
  for (const tool of createUtilityWorkflowTools()) {
    registry.register(tool);
  }

  // ---- Copywriting tools ----
  for (const tool of createCopywritingTools({
    callLLM: async (systemPrompt: string, userText: string) => {
      const adapters = deps.llmRegistry.list();
      for (const adapter of adapters) {
        if (!(await adapter.validate())) continue;
        return await adapter.complete([
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userText },
        ]);
      }
      throw new Error('No configured LLM adapter available for copywriting tools.');
    },
  })) {
    registry.register(tool);
  }

  // ---- Vision tools ----
  const IMAGE_EXTENSIONS_VISION = ['png', 'jpg', 'jpeg', 'webp'] as const;
  const MIME_MAP_VISION: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    webp: 'image/webp',
  };
  const VISION_PROMPT_DEFAULT =
    'You are an expert at describing images for AI generation. Analyze this image and write a detailed prompt that could be used to recreate it with an AI image generator.\n\nInclude: subject/scene description, art style, lighting quality and direction, color palette, mood/atmosphere, camera angle/lens, composition, texture/material details, and any notable cinematic or photographic techniques.\n\nOutput ONLY the prompt text, no explanations or labels. Write in English.';
  const VISION_PROMPT_STYLE_ANALYSIS =
    'You are a visual style analyst for AI filmmaking. Analyze this image and extract its visual style characteristics.\n\nReport in this exact format:\nArt Style: [style name]\nLighting: [lighting description]\nColor Palette: [primary colors and mood]\nMood: [emotional atmosphere]\nComposition: [framing and arrangement]\nCamera: [angle, lens, movement if applicable]\nTexture: [surface quality, grain, post-processing]\nReference: [closest cinematic/artistic reference]\n\nBe specific and technical. Output ONLY the analysis, no explanations.';

  for (const tool of createVisionTools({
    describeImage: async (assetHash, _assetType, style, providerId) => {
      const visionProviders = getCachedProviders('vision');
      const providerInfo = providerId
        ? visionProviders.find((p) => p.id === providerId) ?? visionProviders[0]
        : visionProviders[0];
      if (!providerInfo?.id) {
        throw new Error('Vision provider not configured. Go to Settings → Vision.');
      }
      const apiKey = await deps.keychain.getKey(providerInfo.id);
      const preset = getBuiltinVisionProviderPreset(providerInfo.id);
      const runtimeConfig = normalizeLLMProviderRuntimeConfig({
        id: providerInfo.id,
        name: providerInfo.name || preset?.name || providerInfo.id,
        baseUrl: providerInfo.baseUrl || preset?.baseUrl || '',
        model: providerInfo.model || preset?.model || '',
        protocol: providerInfo.protocol ?? preset?.protocol,
        authStyle: providerInfo.authStyle ?? preset?.authStyle,
      });
      const adapter = buildRuntimeLLMAdapter(runtimeConfig);
      adapter.configure(apiKey ?? '', {
        baseUrl: runtimeConfig.baseUrl,
        model: runtimeConfig.model,
      });
      let resolvedPath: string | null = null;
      let resolvedExt = 'jpg';
      for (const ext of IMAGE_EXTENSIONS_VISION) {
        const p = deps.cas.getAssetPath(assetHash, 'image', ext);
        if (fs.existsSync(p)) {
          resolvedPath = p;
          resolvedExt = ext;
          break;
        }
      }
      if (!resolvedPath) {
        throw new Error(`Asset file not found for hash: ${assetHash}`);
      }
      const imageBuffer = fs.readFileSync(resolvedPath);
      const base64Data = imageBuffer.toString('base64');
      const mimeType = MIME_MAP_VISION[resolvedExt] ?? 'image/jpeg';
      const systemPrompt = style === 'style-analysis'
        ? VISION_PROMPT_STYLE_ANALYSIS
        : VISION_PROMPT_DEFAULT;
      const result = await adapter.complete([
        { role: 'system', content: systemPrompt },
        { role: 'user', content: 'Describe this image.', images: [{ data: base64Data, mimeType }] },
      ]);
      return { prompt: result };
    },
    getNodeAssetHash: async (nodeId: string) => {
      const projectId = getCurrentProjectId();
      if (!projectId) return null;
      const canvasList = deps.canvasStore.listForProject(projectId);
      for (const entry of canvasList) {
        const canvas = deps.canvasStore.get(entry.id);
        if (!canvas) continue;
        const node = canvas.nodes.find((n) => n.id === nodeId);
        if (node) {
          const data = node.data as { assetHash?: string };
          return data.assetHash ?? null;
        }
      }
      return null;
    },
    writeNodeField: async (nodeId: string, field: string, value: string) => {
      const projectId = getCurrentProjectId();
      if (!projectId) return;
      const canvasList = deps.canvasStore.listForProject(projectId);
      for (const entry of canvasList) {
        const canvas = deps.canvasStore.get(entry.id);
        if (!canvas) continue;
        const node = canvas.nodes.find((n) => n.id === nodeId);
        if (node) {
          const data = node.data as Record<string, unknown>;
          data[field] = value;
          node.updatedAt = Date.now();
          touchCanvas(canvas, deps.canvasStore);
          return;
        }
      }
    },
    listVisionProviders: async () => {
      const visionProviders = getCachedProviders('vision');
      const results = [];
      for (const p of visionProviders) {
        const hasKey = p.id ? Boolean(await deps.keychain.getKey(p.id)) : false;
        const preset = getBuiltinVisionProviderPreset(p.id);
        results.push({
          id: p.id,
          name: p.name || preset?.name || p.id,
          model: p.model || preset?.model || '',
          hasKey,
        });
      }
      return results;
    },
  })) {
    registry.register(tool);
  }

  for (const tool of createVideoTools({
    cloneVideo: async (filePath, projectId, threshold) => {
      const scenes = await detectScenes(filePath, threshold ?? 0.4);
      if (scenes.length === 0) {
        return { canvasId: '', nodeCount: 0 };
      }
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lucid-video-clone-'));
      try {
        const keyframeHashes: string[] = [];
        for (let i = 0; i < scenes.length; i++) {
          const framePath = path.join(tmpDir, `frame-${i}.png`);
          try {
            await extractFrameAtTime(filePath, scenes[i].time, framePath);
            const { ref } = await deps.cas.importAsset(framePath, 'image');
            keyframeHashes.push(ref.hash);
          } catch {
            keyframeHashes.push('');
          }
        }
        const now = Date.now();
        const canvasId = randomUUID();
        const nodes: CanvasNode[] = [];
        const edges: CanvasEdge[] = [];
        for (let i = 0; i < scenes.length; i++) {
          const nodeId = randomUUID();
          const hash = keyframeHashes[i];
          const prevHash = i > 0 ? keyframeHashes[i - 1] : undefined;
          nodes.push({
            id: nodeId,
            type: 'video',
            position: { x: i * 300, y: 0 },
            title: `Scene ${i + 1}`,
            status: 'idle',
            bypassed: false,
            locked: false,
            data: {
              status: 'empty',
              prompt: '',
              sourceImageHash: hash || undefined,
              firstFrameAssetHash: prevHash || undefined,
              variants: [],
              selectedVariantIndex: 0,
            },
            createdAt: now,
            updatedAt: now,
          } as CanvasNode);
          if (i > 0) {
            edges.push({
              id: randomUUID(),
              source: nodes[i - 1].id,
              target: nodeId,
              data: { status: 'idle' },
            } as CanvasEdge);
          }
        }
        const canvas: Canvas = {
          id: canvasId,
          projectId,
          name: `Video Clone ${new Date().toLocaleDateString()}`,
          nodes,
          edges,
          viewport: { x: 0, y: 0, zoom: 1 },
          notes: [],
          createdAt: now,
          updatedAt: now,
        };
        deps.canvasStore.save(canvas);
        return { canvasId, nodeCount: nodes.length };
      } finally {
        try {
          fs.rmSync(tmpDir, { recursive: true, force: true });
        } catch {
          // ignore
        }
      }
    },
  })) {
    registry.register(tool);
  }
}
