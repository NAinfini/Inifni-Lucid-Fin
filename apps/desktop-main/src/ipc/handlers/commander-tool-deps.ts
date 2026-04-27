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
  createAssetTools,
  createCanvasTools,
  createCharacterTools,
  createEquipmentTools,
  createLocationTools,
  createPresetTools,
  createPromptTools,
  createProviderTools,
  createRenderTools,
  createScriptTools,
  createMetaTools,
  createWorkflowTools,
  createCopywritingTools,
  createVisionTools,
  createSnapshotTools,
  registerToolModule,
  jobToolModule,
  colorStyleToolModule,
  seriesToolModule,
  type JobQueue,
  type WorkflowEngine,
} from '@lucid-fin/application';
import { parseScript } from '@lucid-fin/domain';
import {
  settingsProviderKeyUpdatedChannel,
  refimageStartChannel,
  refimageCompleteChannel,
  refimageFailedChannel,
  commanderSettingsDispatchChannel,
  commanderUndoDispatchChannel,
  parseSessionId,
  parseSnapshotId,
  parsePresetId,
  parseShotTemplateId,
  parseSeriesId,
  parseEpisodeId,
  parseCharacterId,
  parseEquipmentId,
  parseLocationId,
  parseCanvasId,
} from '@lucid-fin/contracts-parse';
import {
  BUILT_IN_SHOT_TEMPLATES,
  createEmptyPresetTrackSet,
  type Canvas,
  type CanvasEdge,
  type CanvasNode,
  type CanvasNote,
  type CanvasSettings,
  type PresetCategory,
  type PresetDefinition,
  type PresetTrackSet,
  type ShotTemplate,
  type StyleGuide,
  normalizeLLMProviderRuntimeConfig,
  getBuiltinVisionProviderPreset,
} from '@lucid-fin/contracts';
import type { CAS, SqliteIndex, PromptStore } from '@lucid-fin/storage';
import type { CanvasStore } from './canvas.handlers.js';
import { startCanvasGeneration, cancelCanvasGeneration } from './canvas-generation.handlers.js';
import { buildGenerationContext } from './generation-context.js';
import { getCachedProviders } from '../settings-cache.js';
import { getBufferedLogs } from '../../logger.js';
import { makeGenerateImage } from './commander-image-gen.js';
import {
  createRendererPushGateway,
  type RendererPushGateway,
} from '../../features/ipc/push-gateway.js';
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

function normalizeScriptFormat(value: unknown): 'fountain' | 'fdx' | 'plaintext' {
  return value === 'fdx' || value === 'plaintext' || value === 'fountain' ? value : 'fountain';
}

function saveScriptDocument(
  db: SqliteIndex,
  content: string,
  format: 'fountain' | 'fdx' | 'plaintext',
) {
  const parsedScenes = parseScript(content, format);
  const existing = db.repos.scripts.get();
  const now = Date.now();
  const doc = {
    id: existing?.id ?? crypto.randomUUID(),
    content,
    format,
    parsedScenes,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  db.repos.scripts.upsert(doc);
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
  keychain: import('@lucid-fin/storage').Keychain;
  promptStore: PromptStore;
}

type PromptGuide = { id: string; name: string; content: string };

/**
 * Deduplicate prompt guides by id. Since the renderer now owns the full set
 * of built-in and user-authored guides (via the `skillDefinitions` slice),
 * this is a pure passthrough with dedupe — no main-side constants to merge.
 */
export function mergePromptGuidesWithBuiltIns(promptGuides: PromptGuide[]): PromptGuide[] {
  const merged: PromptGuide[] = [];
  const seen = new Set<string>();

  for (const guide of promptGuides) {
    if (seen.has(guide.id)) continue;
    seen.add(guide.id);
    merged.push(guide);
  }

  return merged;
}

export function registerAllTools(
  registry: AgentToolRegistry,
  deps: ToolRegistrationDeps,
  getWindow: () => BrowserWindow | null,
  promptGuides: Array<{ id: string; name: string; content: string; autoInject?: boolean }>,
  compactRef?: { compact?: (instructions?: string) => Promise<{ freedChars: number; messageCount: number; toolCount: number }> },
  sessionId?: string,
  defaultProviders?: Record<string, string>,
  pushGateway?: RendererPushGateway,
  resolveProcessPrompt?: (processKey: string) => string | null,
): void {
  const mergedPromptGuides = mergePromptGuidesWithBuiltIns(promptGuides);
  // `settings:providerKeyUpdated` is a typed push channel — route it through
  // the gateway so payload drift surfaces loudly in main instead of silently
  // in the renderer. Fall back to a locally-constructed gateway when callers
  // predate Phase F-split-4.
  const gateway =
    pushGateway ?? createRendererPushGateway({ getWindow });
  const generateImage = makeGenerateImage({
    ...deps,
    onStart: (jobId, provider, width, height) => {
      gateway.emit(refimageStartChannel, { jobId, provider, width, height });
    },
    onComplete: (jobId, assetHash) => {
      gateway.emit(refimageCompleteChannel, { jobId, assetHash });
    },
    onFailed: (jobId, error) => {
      gateway.emit(refimageFailedChannel, { jobId, error });
    },
  });

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
    deps.db.repos.presets.upsertOverride({
      id: preset.id,
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
    deps.db.repos.presets.deleteOverride(parsePresetId(presetId));
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
      const custom = deps.db.repos.shotTemplates.list().rows;
      return [...BUILT_IN_SHOT_TEMPLATES, ...custom];
    },
    saveShotTemplate: async (template: ShotTemplate): Promise<ShotTemplate> => {
      deps.db.repos.shotTemplates.upsert(template);
      return template;
    },
    deleteShotTemplate: async (templateId: string): Promise<void> => {
      deps.db.repos.shotTemplates.delete(parseShotTemplateId(templateId));
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
        gateway.emit(commanderSettingsDispatchChannel, {
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
      gateway.emit(settingsProviderKeyUpdatedChannel, {
        group: 'provider',
        providerId,
        hasKey: true,
      });
    },
    deleteProviderKey: async (providerId: string) => {
      await deps.keychain.deleteKey(providerId);
      const mediaAdapter = deps.adapterRegistry.get(providerId);
      if (mediaAdapter) mediaAdapter.configure('');
      const llmProvider = deps.llmRegistry.list().find((a) => a.id === providerId);
      if (llmProvider) llmProvider.configure('');
      gateway.emit(settingsProviderKeyUpdatedChannel, {
        group: 'provider',
        providerId,
        hasKey: false,
      });
    },
    isProviderKeyConfigured: async (providerId: string) => {
      try {
        const key = await deps.keychain.getKey(providerId);
        return key != null && key.length > 0;
      } catch { /* keychain read failed — report key as absent */
        return false;
      }
    },
    getDefaultProviderId: (group: 'image' | 'video' | 'audio') => defaultProviders?.[group],
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
    estimateCost: async (canvasId: string, nodeIds?: string[]) => {
      // Real per-node cost estimation via each node's configured adapter.
      // Any node that cannot be estimated (missing provider, text node, etc.)
      // contributes 0 but is still listed so the caller sees which nodes were
      // evaluated. Currency of the first successful estimate wins; defaults
      // to USD. Upstream failures are logged, never swallowed silently.
      const canvas = requireCanvas(deps.canvasStore, canvasId);
      const targets = Array.isArray(nodeIds) && nodeIds.length > 0
        ? canvas.nodes.filter((n) => nodeIds.includes(n.id))
        : canvas.nodes.filter((n) => n.type === 'image' || n.type === 'video' || n.type === 'audio' || n.type === 'backdrop');
      let total = 0;
      let currency = 'USD';
      const nodeCosts: Array<{ nodeId: string; estimatedCost: number }> = [];
      const generationDeps = {
        adapterRegistry: deps.adapterRegistry,
        cas: deps.cas,
        db: deps.db,
        canvasStore: deps.canvasStore,
        keychain: deps.keychain,
      };
      for (const node of targets) {
        try {
          const context = await buildGenerationContext(generationDeps, {
            canvasId,
            nodeId: node.id,
            requestedProviderId: undefined,
            requestedProviderConfig: undefined,
            requestedVariantCount: undefined,
            requestedSeed: undefined,
          });
          const estimate = context.adapter.estimateCost(context.requestBase);
          total += estimate.estimatedCost;
          currency = estimate.currency || currency;
          nodeCosts.push({ nodeId: node.id, estimatedCost: estimate.estimatedCost });
        } catch {
          nodeCosts.push({ nodeId: node.id, estimatedCost: 0 });
        }
      }
      return { totalEstimatedCost: total, currency, nodeCosts };
    },
    previewPrompt: async (canvasId: string, nodeId: string) => {
      // Compile the same prompt the generation pipeline would send, without
      // triggering a job. Returns segments/diagnostics/budget so Commander
      // can surface the compiled text for user review.
      const context = await buildGenerationContext({
        adapterRegistry: deps.adapterRegistry,
        cas: deps.cas,
        db: deps.db,
        canvasStore: deps.canvasStore,
        keychain: deps.keychain,
      }, {
        canvasId,
        nodeId,
        requestedProviderId: undefined,
        requestedProviderConfig: undefined,
        requestedVariantCount: undefined,
        requestedSeed: undefined,
      });
      return {
        prompt: context.compiled.prompt,
        negativePrompt: context.compiled.negativePrompt,
        segments: context.compiled.segments.map((s) => ({
          source: s.source,
          text: s.text,
          trimmed: s.trimmed,
        })),
        wordCount: context.compiled.wordCount,
        budget: context.compiled.budget,
        diagnostics: context.compiled.diagnostics.map((d) => ({
          type: d.type,
          severity: d.severity,
          message: d.message,
        })),
        providerId: context.adapter.id,
        mode: context.mode,
      };
    },
    addNote: async (canvasId: string, content: string): Promise<CanvasNote> => {
      const canvas = requireCanvas(deps.canvasStore, canvasId);
      const now = Date.now();
      const note: CanvasNote = {
        id: randomUUID(),
        content,
        createdAt: now,
        updatedAt: now,
      };
      canvas.notes = [...(canvas.notes ?? []), note];
      touchCanvas(canvas, deps.canvasStore);
      return note;
    },
    getRecentLogs: async (level?: string, category?: string, limit?: number) => {
      let entries = getBufferedLogs();
      if (level) entries = entries.filter((e) => e.level === level);
      if (category) entries = entries.filter((e) => e.category === category);
      return entries.slice(-(limit ?? 50)) as unknown as Array<Record<string, unknown>>;
    },
    updateNote: async (canvasId: string, noteId: string, content: string) => {
      const canvas = requireCanvas(deps.canvasStore, canvasId);
      const note = (canvas.notes ?? []).find((n) => n.id === noteId);
      if (!note) throw new Error(`Note not found: ${noteId}`);
      note.content = content;
      note.updatedAt = Date.now();
      touchCanvas(canvas, deps.canvasStore);
    },
    deleteNote: async (canvasId: string, noteId: string) => {
      const canvas = requireCanvas(deps.canvasStore, canvasId);
      const before = (canvas.notes ?? []).length;
      canvas.notes = (canvas.notes ?? []).filter((n) => n.id !== noteId);
      if (canvas.notes.length === before) throw new Error(`Note not found: ${noteId}`);
      touchCanvas(canvas, deps.canvasStore);
    },
    undo: async () => {
      gateway.emit(commanderUndoDispatchChannel, { action: 'undo' });
    },
    redo: async () => {
      gateway.emit(commanderUndoDispatchChannel, { action: 'redo' });
    },
    importWorkflow: async (canvasId: string, json: string): Promise<Canvas> => {
      // Parses a previously-exported JSON payload and replaces nodes/edges/
      // viewport/notes on the target canvas. Canvas id/name/timestamps are
      // preserved so callers can re-import into any canvas container.
      let parsed: unknown;
      try {
        parsed = JSON.parse(json);
      } catch (err) {
        throw new Error(`importWorkflow: invalid JSON — ${(err as Error).message}`, { cause: err });
      }
      if (!parsed || typeof parsed !== 'object') {
        throw new Error('importWorkflow: payload must be a JSON object');
      }
      const incoming = parsed as Partial<Canvas>;
      if (!Array.isArray(incoming.nodes) || !Array.isArray(incoming.edges)) {
        throw new Error('importWorkflow: payload must contain nodes and edges arrays');
      }
      const canvas = requireCanvas(deps.canvasStore, canvasId);
      canvas.nodes = incoming.nodes as CanvasNode[];
      canvas.edges = incoming.edges as CanvasEdge[];
      if (incoming.viewport) canvas.viewport = incoming.viewport;
      if (Array.isArray(incoming.notes)) canvas.notes = incoming.notes as CanvasNote[];
      touchCanvas(canvas, deps.canvasStore);
      return canvas;
    },
    exportWorkflow: async (canvasId: string) => {
      const canvas = requireCanvas(deps.canvasStore, canvasId);
      return JSON.stringify({
        nodes: canvas.nodes,
        edges: canvas.edges,
        viewport: canvas.viewport,
        notes: canvas.notes ?? [],
      });
    },
    getCanvasSettings: async (canvasId: string): Promise<CanvasSettings> => {
      // Read through the cached canvas store so we stay consistent with
      // subsequent mutations that flow through canvasStore.save().
      const canvas = requireCanvas(deps.canvasStore, canvasId);
      return canvas.settings ?? {};
    },
    patchCanvasSettings: async (canvasId: string, patch: CanvasSettings): Promise<CanvasSettings> => {
      // Re-read through the store so we preserve cache coherence, then delegate
      // column-level updates to the repo (which also bumps updated_at). After
      // the repo write, refresh the cached canvas with the merged settings so
      // subsequent reads reflect the new state without re-hitting SQLite.
      const canvas = requireCanvas(deps.canvasStore, canvasId);
      const brandedId = parseCanvasId(canvasId);
      deps.db.repos.canvases.patchSettings(brandedId, patch);
      const current = canvas.settings ?? {};
      const merged: CanvasSettings = { ...current };
      for (const [rawKey, value] of Object.entries(patch)) {
        const key = rawKey as keyof CanvasSettings;
        if (value === null || value === undefined) {
          delete merged[key];
        } else {
          (merged as Record<string, unknown>)[key] = value;
        }
      }
      if (Object.keys(merged).length === 0) {
        delete canvas.settings;
      } else {
        canvas.settings = merged;
      }
      canvas.updatedAt = Date.now();
      deps.canvasStore.save(canvas);
      return canvas.settings ?? {};
    },
  };

  for (const tool of createCanvasTools(canvasToolDeps)) {
    registry.register(tool);
  }

  // ---- Script tools ----
  for (const tool of createScriptTools({
    loadScript: async (filePath?: string) => {
      if (!filePath) {
        return deps.db.repos.scripts.get();
      }
      const resolved = path.resolve(filePath);
      if (!fs.existsSync(resolved) || fs.statSync(resolved).isDirectory()) {
        throw new Error(`Script file not found: ${resolved}`);
      }
      const content = fs.readFileSync(resolved, 'utf-8');
      const ext = path.extname(resolved).toLowerCase();
      const format =
        ext === '.fountain' ? 'fountain' : ext === '.fdx' ? 'fdx' : 'plaintext';
      return saveScriptDocument(deps.db, content, format);
    },
    saveScript: async (content: string) => {
      saveScriptDocument(deps.db, content, 'fountain');
    },
    parseScript: (content: string) => parseScript(content, 'fountain'),
    importScript: async (content: string, format?: string) => {
      const normalizedFormat = normalizeScriptFormat(format);
      const doc = saveScriptDocument(deps.db, content, normalizedFormat);
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
      return deps.db.repos.entities.listCharacters().rows;
    },
    saveCharacter: async (c) => {
      deps.db.repos.entities.upsertCharacter({ ...c });
    },
    deleteCharacter: async (id) => deps.db.repos.entities.deleteCharacter(parseCharacterId(id)),
    generateImage,
    getCanvas: async (canvasId: string) => requireCanvas(deps.canvasStore, canvasId),
  })) {
    registry.register(tool);
  }
  for (const tool of createLocationTools({
    listLocations: async () => {
      return deps.db.repos.entities.listLocations().rows;
    },
    saveLocation: async (l) => {
      deps.db.repos.entities.upsertLocation({ ...l });
    },
    deleteLocation: async (id) => deps.db.repos.entities.deleteLocation(parseLocationId(id)),
    generateImage,
  })) {
    registry.register(tool);
  }
  for (const tool of createEquipmentTools({
    listEquipment: async () => {
      return deps.db.repos.entities.listEquipment().rows;
    },
    saveEquipment: async (e) => {
      deps.db.repos.entities.upsertEquipment({ ...e });
    },
    deleteEquipment: async (id) => deps.db.repos.entities.deleteEquipment(parseEquipmentId(id)),
    generateImage,
    getCanvas: async (canvasId: string) => requireCanvas(deps.canvasStore, canvasId),
  })) {
    registry.register(tool);
  }

  // ---- Job tools ----
  registerToolModule(registry, jobToolModule, {
    listJobs: async () => {
      return deps.db.repos.jobs.list().rows.map((job) => ({
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
  });

  // ---- Series tools ----
  // Track the active series ID in memory (no longer persisted per-project)
  let activeSeriesId: string | undefined;

  const ensureCommanderSeriesId = () => {
    if (activeSeriesId) {
      const existing = deps.db.repos.series.getSeries(parseSeriesId(activeSeriesId));
      if (existing) return { seriesId: activeSeriesId };
    }
    const now = Date.now();
    const seriesId = crypto.randomUUID();
    deps.db.repos.series.upsertSeries({
      id: seriesId,
      title: 'Untitled Series',
      description: '',
      styleGuide: { global: { artStyle: '', colorPalette: { primary: '', secondary: '', forbidden: [] }, lighting: 'natural', texture: '', referenceImages: [], freeformDescription: '' }, sceneOverrides: {} } as StyleGuide,
      episodeIds: [],
      createdAt: now,
      updatedAt: now,
    });
    activeSeriesId = seriesId;
    return { seriesId };
  };

  registerToolModule(registry, seriesToolModule, {
    getSeries: async () => {
      if (!activeSeriesId) return null;
      return deps.db.repos.series.getSeries(parseSeriesId(activeSeriesId)) ?? null;
    },
    saveSeries: async (data: Record<string, unknown>) => {
      const existingId =
        typeof data.id === 'string' && data.id.trim().length > 0
          ? data.id.trim()
          : activeSeriesId;
      const existingSeries = existingId ? deps.db.repos.series.getSeries(parseSeriesId(existingId)) : undefined;
      const now = Date.now();
      const seriesId = existingId ?? crypto.randomUUID();
      const episodeIds = Array.isArray(data.episodeIds)
        ? data.episodeIds.filter((entry): entry is string => typeof entry === 'string')
        : existingSeries?.episodeIds ?? deps.db.repos.series.listEpisodes(parseSeriesId(seriesId)).rows.map((episode) => episode.id);

      deps.db.repos.series.upsertSeries({
        id: seriesId,
        title:
          typeof data.title === 'string'
            ? data.title
            : existingSeries?.title ?? 'Untitled Series',
        description:
          typeof data.description === 'string'
            ? data.description
            : existingSeries?.description ?? '',
        styleGuide:
          data.styleGuide && typeof data.styleGuide === 'object' && !Array.isArray(data.styleGuide)
            ? data.styleGuide as StyleGuide
            : existingSeries?.styleGuide ?? { global: { artStyle: '', colorPalette: { primary: '', secondary: '', forbidden: [] }, lighting: 'natural', texture: '', referenceImages: [], freeformDescription: '' }, sceneOverrides: {} } as StyleGuide,
        episodeIds,
        createdAt:
          typeof data.createdAt === 'number'
            ? data.createdAt
            : existingSeries?.createdAt ?? now,
        updatedAt: now,
      });

      activeSeriesId = seriesId;
      return deps.db.repos.series.getSeries(parseSeriesId(seriesId)) ?? null;
    },
    listEpisodes: async () => {
      if (!activeSeriesId) return [];
      return deps.db.repos.series.listEpisodes(parseSeriesId(activeSeriesId)).rows.map((episode) => ({
        id: episode.id,
        title: episode.title,
        canvasId: undefined,
      }));
    },
    addEpisode: async (title: string, _canvasId?: string) => {
      const { seriesId } = ensureCommanderSeriesId();
      const existingEpisodes = deps.db.repos.series.listEpisodes(parseSeriesId(seriesId)).rows;
      const now = Date.now();
      const episodeId = crypto.randomUUID();
      deps.db.repos.series.upsertEpisode({
        id: episodeId,
        seriesId,
        title,
        order: existingEpisodes.length,
        status: 'draft',
        createdAt: now,
        updatedAt: now,
      });

      const series = deps.db.repos.series.getSeries(parseSeriesId(seriesId));
      if (series) {
        deps.db.repos.series.upsertSeries({
          ...series,
          episodeIds: [...new Set([...series.episodeIds, episodeId])],
          updatedAt: now,
        });
      }

      return { id: episodeId };
    },
    removeEpisode: async (episodeId: string) => {
      const series = activeSeriesId ? deps.db.repos.series.getSeries(parseSeriesId(activeSeriesId)) : undefined;
      deps.db.repos.series.deleteEpisode(parseEpisodeId(episodeId));
      if (series) {
        deps.db.repos.series.upsertSeries({
          ...series,
          episodeIds: series.episodeIds.filter((id) => id !== episodeId),
          updatedAt: Date.now(),
        });
      }
    },
    reorderEpisodes: async (episodeIds: string[]) => {
      if (!activeSeriesId) return [];
      const episodes = deps.db.repos.series.listEpisodes(parseSeriesId(activeSeriesId)).rows;
      for (let index = 0; index < episodeIds.length; index += 1) {
        const episode = episodes.find((entry) => entry.id === episodeIds[index]);
        if (episode) {
          deps.db.repos.series.upsertEpisode({
            ...episode,
            order: index,
            updatedAt: Date.now(),
          });
        }
      }
      return deps.db.repos.series.listEpisodes(parseSeriesId(activeSeriesId)).rows;
    },
  });

  // ---- Color style tools ----
  registerToolModule(registry, colorStyleToolModule, {
    listColorStyles: async () => deps.db.repos.colorStyles.list(),
    saveColorStyle: async (style: Record<string, unknown>) => {
      if (
        typeof style.id !== 'string' ||
        typeof style.name !== 'string' ||
        style.id.trim().length === 0 ||
        style.name.trim().length === 0
      ) {
        throw new Error('style.id and style.name are required');
      }
      deps.db.repos.colorStyles.upsert(
        style as unknown as Parameters<typeof deps.db.repos.colorStyles.upsert>[0],
      );
    },
    deleteColorStyle: async (id: string) => {
      deps.db.repos.colorStyles.delete(id);
    },
  });

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
      if (group === 'llm') {
        gateway.emit(commanderSettingsDispatchChannel, {
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
      gateway.emit(commanderSettingsDispatchChannel, { action: 'setProviderBaseUrl', payload: { group, provider: providerId, baseUrl } });
    },
    setProviderModel: async (group: string, providerId: string, model: string) => {
      gateway.emit(commanderSettingsDispatchChannel, { action: 'setProviderModel', payload: { group, provider: providerId, model } });
    },
    setProviderName: async (group: string, providerId: string, name: string) => {
      gateway.emit(commanderSettingsDispatchChannel, { action: 'setProviderName', payload: { group, provider: providerId, name } });
    },
    addCustomProvider: async (group: string, id: string, name: string, baseUrl?: string, model?: string) => {
      gateway.emit(commanderSettingsDispatchChannel, { action: 'addCustomProvider', payload: { group, id, name, baseUrl, model } });
    },
    removeCustomProvider: async (group: string, providerId: string) => {
      gateway.emit(commanderSettingsDispatchChannel, { action: 'removeCustomProvider', payload: { group, provider: providerId } });
    },
    setProviderApiKey: async (providerId: string, apiKey: string) => {
      const mediaAdapter = deps.adapterRegistry.get(providerId);
      if (mediaAdapter) mediaAdapter.configure(apiKey);
      const llmProvider = deps.llmRegistry.list().find((a) => a.id === providerId);
      if (llmProvider) llmProvider.configure(apiKey);
      await deps.keychain.setKey(providerId, apiKey);
      gateway.emit(settingsProviderKeyUpdatedChannel, {
        group: 'provider',
        providerId,
        hasKey: true,
      });
    },
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
    promptGuides: mergedPromptGuides,
    context: 'canvas',
    compactContext: compactRef
      ? async (instructions?: string) => {
          if (!compactRef.compact) return { freedChars: 0, messageCount: 0, toolCount: 0 };
          return compactRef.compact(instructions);
        }
      : undefined,
    // Inject process guides inline with tool.get responses. `resolveProcessPrompt`
    // is threaded from the orchestrator deps — without it, tool.get falls
    // back to schema-only output and the pre-flight defer mechanism in the
    // orchestrator is the sole guide-injection path.
    resolveProcessPrompt: resolveProcessPrompt
      ? (processKey) => resolveProcessPrompt(processKey)
      : undefined,
  })) {
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
      const canvasList = deps.canvasStore.list();
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
      const canvasList = deps.canvasStore.list();
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
  })) {
    registry.register(tool);
  }

  for (const tool of createVideoTools({
    cloneVideo: async (filePath, threshold) => {
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
          } catch { /* keyframe extraction failed for this scene — use empty placeholder */
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
        } catch { /* temp dir cleanup failed — not fatal, OS will reclaim on reboot */
          // ignore
        }
      }
    },
  })) {
    registry.register(tool);
  }

  // ---- Asset tools ----
  for (const tool of createAssetTools({
    importAsset: async (filePath, type) => {
      const { ref, meta } = await deps.cas.importAsset(filePath, type);
      // Index the asset so listAssets / folder queries can see it.
      const now = Date.now();
      deps.db.repos.assets.insert({
        hash: ref.hash,
        type,
        format: meta.format,
        originalName: meta.originalName,
        fileSize: meta.fileSize,
        tags: meta.tags ?? [],
        folderId: null,
        createdAt: meta.createdAt ?? now,
      });
      return ref;
    },
    listAssets: async (type, limit) => {
      const result = deps.db.repos.assets.query({ type, limit: limit ?? 100 });
      return result.rows;
    },
  })) {
    registry.register(tool);
  }

  // ---- Prompt tools ----
  for (const tool of createPromptTools({
    listPrompts: async () => {
      return deps.promptStore.list().map((row) => ({
        code: row.code,
        name: row.name,
        type: row.type,
        hasCustom: row.customValue !== null,
      }));
    },
    getPrompt: async (code) => {
      const row = deps.promptStore.get(code);
      if (!row) return null;
      return {
        code: row.code,
        name: row.name,
        defaultValue: row.defaultValue,
        customValue: row.customValue,
      };
    },
    setCustomPrompt: async (code, value) => {
      deps.promptStore.setCustom(code, value);
    },
    clearCustomPrompt: async (code) => {
      deps.promptStore.clearCustom(code);
    },
  })) {
    registry.register(tool);
  }

  // ---- Render tools ----
  //
  // `startRender` builds a concat-style RenderSegment[] from the canvas's
  // video nodes (in edge order when possible, falling back to spatial order
  // along the X axis). Each selected variant hash is resolved into a CAS file
  // path. This is intentionally simple: no transitions, no audio mixdown,
  // no fps normalization. Enough to produce a single-pass preview cut so the
  // Commander-driven story-to-video loop actually terminates with a file on
  // disk instead of silently succeeding with zero output.
  //
  // exportBundle is not yet wired because the NLE export pipeline takes an
  // editorial `Project` object, not a canvas — building that requires a
  // separate canvas→project compiler. Rather than fake success (Debug First
  // rule), we return a typed validation failure with a clear message.
  for (const tool of createRenderTools({
    startRender: async (canvasId, format, outputPath) => {
      const canvas = requireCanvas(deps.canvasStore, canvasId);
      const videoNodes = canvas.nodes
        .filter((node) => node.type === 'video' && !node.bypassed)
        .sort((a, b) => a.position.x - b.position.x);

      const segments: Array<{ inputPath: string; startTime: number; duration: number; speed: number }> = [];
      for (const node of videoNodes) {
        const data = node.data as { variants?: string[]; selectedVariantIndex?: number; duration?: number };
        const variants = Array.isArray(data.variants) ? data.variants : [];
        const idx = typeof data.selectedVariantIndex === 'number' ? data.selectedVariantIndex : 0;
        const hash = variants[idx];
        if (!hash) continue;
        const candidateExts = ['mp4', 'mov', 'webm'];
        let resolvedPath: string | null = null;
        for (const ext of candidateExts) {
          const p = deps.cas.getAssetPath(hash, 'video', ext);
          if (fs.existsSync(p)) {
            resolvedPath = p;
            break;
          }
        }
        if (!resolvedPath) continue;
        segments.push({
          inputPath: resolvedPath,
          startTime: 0,
          duration: typeof data.duration === 'number' && data.duration > 0 ? data.duration : 0,
          speed: 1,
        });
      }

      if (segments.length === 0) {
        throw new Error('No rendered video variants available for this canvas — generate videos first.');
      }

      const codec = format === 'mov' ? 'prores' : 'h264';
      const ext = codec === 'prores' ? 'mov' : 'mp4';
      const finalOut = outputPath ?? path.join(os.tmpdir(), `lucid-render-${Date.now()}.${ext}`);

      const { renderTimeline } = await import('@lucid-fin/media-engine');
      await renderTimeline(segments, finalOut, {
        codec: codec as 'h264' | 'prores',
        preset: 'standard',
        width: 1920,
        height: 1080,
        fps: 24,
      });
      return { renderId: finalOut };
    },
    cancelRender: async () => {
      // renderTimeline currently runs synchronously-to-completion inside the
      // main IPC handler — there is no per-canvas cancellation token yet. We
      // intentionally do not fabricate cancel success here.
      throw new Error('Render cancellation is not yet wired to the media engine — render jobs complete uninterrupted.');
    },
    exportBundle: async () => {
      throw new Error('Canvas→NLE bundle export is not yet wired. Use export:nle IPC with an editorial Project payload from the renderer.');
    },
  })) {
    registry.register(tool);
  }

  // ---- Snapshot tools ----
  if (sessionId) {
    for (const tool of createSnapshotTools({
      captureSnapshot: (sid, label, trigger) => deps.db.repos.snapshots.capture(parseSessionId(sid), label, trigger),
      listSnapshots: (sid) => deps.db.repos.snapshots.list(parseSessionId(sid)).rows.map(({ data: _d, ...meta }) => meta),
      restoreSnapshot: (snapshotId) => deps.db.repos.snapshots.restore(parseSnapshotId(snapshotId)),
      getSessionId: () => sessionId,
    })) {
      registry.register(tool);
    }
  }
}
