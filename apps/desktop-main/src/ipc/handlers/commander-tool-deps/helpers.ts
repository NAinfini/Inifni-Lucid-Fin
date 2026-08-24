import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { AdapterRegistry, LLMRegistry } from '@lucid-fin/adapters-ai';
import { buildRuntimeLLMAdapter } from '@lucid-fin/adapters-ai';
import {
  ToolRegistry,
  createAssetTools,
  createCanvasTools,
  createEntityTools,
  createPresetTools,
  createPromptTools,
  createProviderTools,
  createScriptTools,
  createMetaTools,
  createTaskListTools,
  createTextAnalyzeTools,
  createSnapshotTools,
  registerToolModule,
  registerFiltered,
  EXCLUDED_TOOLS,
  colorStyleToolModule,
  createRunChecklistTools,
  type TaskExecutionEngine,
  type TaskListCommanderContinuationConfig,
} from '@lucid-fin/application';
import { parseScript } from '@lucid-fin/domain';
import {
  settingsProviderKeyUpdatedChannel,
  commanderSettingsDispatchChannel,
  parseSessionId,
  parseSnapshotId,
  parseShotTemplateId,
  parseCharacterId,
  parseEquipmentId,
  parseLocationId,
  parseCanvasId,
} from '@lucid-fin/contracts-parse';
import {
  BUILT_IN_SHOT_TEMPLATES,
  NODE_KINDS,
  createEmptyPresetTrackSet,
  type Canvas,
  type CanvasEdge,
  type CanvasNode,
  type CanvasNote,
  type CanvasSettings,
  type CommanderPromptGuide,
  type PresetCategory,
  type PresetDefinition,
  type PresetTrackSet,
  type ShotTemplate,
  type StyleGuide,
  type LLMAdapter,
  normalizeLLMProviderRuntimeConfig,
  getBuiltinVisionProviderPreset,
} from '@lucid-fin/contracts';
import type { CAS, SqliteIndex, PromptStore } from '@lucid-fin/storage';
import type { CanvasStore } from '../canvas.handlers.js';
import {
  buildGenerationEstimateContext,
  resolveGenerationResolutionMediaType,
} from '../generation-context.js';
import { getCachedProviders } from '../../settings-cache.js';
import { getBufferedLogs } from '../../../logger.js';
import {
  createRendererPushGateway,
  type RendererPushGateway,
} from '../../../features/ipc/push-gateway.js';
import type { BrowserWindow } from 'electron';
import type { VisualAnalyzer } from '../../../services/visual-analyzer.service.js';
import type { ProjectPresetCatalog } from '../preset.handlers.js';

export {
  fs,
  path,
  randomUUID,
  buildRuntimeLLMAdapter,
  ToolRegistry,
  createAssetTools,
  createCanvasTools,
  createEntityTools,
  createPresetTools,
  createPromptTools,
  createProviderTools,
  createScriptTools,
  createMetaTools,
  createTaskListTools,
  createTextAnalyzeTools,
  createSnapshotTools,
  registerToolModule,
  registerFiltered,
  EXCLUDED_TOOLS,
  colorStyleToolModule,
  createRunChecklistTools,
  parseScript,
  settingsProviderKeyUpdatedChannel,
  commanderSettingsDispatchChannel,
  parseSessionId,
  parseSnapshotId,
  parseShotTemplateId,
  parseCharacterId,
  parseEquipmentId,
  parseLocationId,
  parseCanvasId,
  BUILT_IN_SHOT_TEMPLATES,
  NODE_KINDS,
  createEmptyPresetTrackSet,
  normalizeLLMProviderRuntimeConfig,
  getBuiltinVisionProviderPreset,
  buildGenerationEstimateContext,
  resolveGenerationResolutionMediaType,
  getCachedProviders,
  getBufferedLogs,
  createRendererPushGateway,
};

export type {
  AdapterRegistry,
  LLMRegistry,
  TaskExecutionEngine,
  Canvas,
  CanvasEdge,
  CanvasNode,
  CanvasNote,
  CanvasSettings,
  PresetCategory,
  PresetDefinition,
  PresetTrackSet,
  ShotTemplate,
  StyleGuide,
  CAS,
  SqliteIndex,
  PromptStore,
  CanvasStore,
  RendererPushGateway,
  BrowserWindow,
};

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

export function requireAuthorizedCanvas(
  deps: Pick<ToolRegistrationDeps, 'authorizedCanvasIds' | 'canvasStore'>,
  canvasId: string,
): Canvas {
  if (!deps.authorizedCanvasIds.includes(canvasId)) {
    throw new Error(`Canvas is not authorized for this Commander run: ${canvasId}`);
  }
  return requireCanvas(deps.canvasStore, canvasId);
}

export function requireAuthorizedNode(
  deps: Pick<ToolRegistrationDeps, 'authorizedCanvasIds' | 'canvasStore'>,
  canvasId: string,
  nodeId: string,
): { canvas: Canvas; node: CanvasNode } {
  const canvas = requireAuthorizedCanvas(deps, canvasId);
  const node = canvas.nodes.find((entry) => entry.id === nodeId);
  if (!node) throw new Error(`Node not found: ${nodeId}`);
  return { canvas, node };
}

export function requireDefaultCanvasId(
  deps: Pick<ToolRegistrationDeps, 'defaultCanvasId' | 'authorizedCanvasIds' | 'canvasStore'>,
): string {
  if (!deps.defaultCanvasId) {
    throw new Error('This Commander operation requires a default Canvas');
  }
  requireAuthorizedCanvas(deps, deps.defaultCanvasId);
  return deps.defaultCanvasId;
}

export function touchCanvas(canvas: Canvas, store: CanvasStore): void {
  canvas.updatedAt = Date.now();
  store.save(canvas);
}

export function normalizeScriptFormat(value: unknown): 'fountain' | 'fdx' | 'plaintext' {
  return value === 'fdx' || value === 'plaintext' || value === 'fountain' ? value : 'fountain';
}

export function saveScriptDocument(
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

export interface ToolRegistrationDeps {
  adapterRegistry: AdapterRegistry;
  llmRegistry: LLMRegistry;
  /** Configured LLM for this Commander run; reused for image analysis when visual-capable. */
  activeLLMAdapter?: LLMAdapter;
  defaultCanvasId?: string;
  authorizedCanvasIds: string[];
  visualAnalyzer: VisualAnalyzer;
  canvasStore: CanvasStore;
  presetCatalog: ProjectPresetCatalog;
  taskExecutionEngine: TaskExecutionEngine;
  db: SqliteIndex;
  cas: CAS;
  keychain: import('@lucid-fin/storage').Keychain;
  promptStore: PromptStore;
  productionMediaService: import('../../../services/production-media.service.js').ProductionMediaService;
  mediaGenerationService: import('../../../services/media-generation.service.js').MediaGenerationService;
  promptAssemblyService: import('../../../services/prompt-assembly.service.js').PromptAssemblyService;
  audioTaskService: import('../../../services/audio-task.service.js').AudioTaskService;
  mediaTaskService: import('../../../services/media-task.service.js').MediaTaskService;
  resolveProcessPrompt: (processKey: string) => string | null;
  /** Resolve one model-selected gate decision against host-owned, freshly read SQLite state. */
  decidePendingGate: (decision: 'approve' | 'request_changes') => Promise<unknown>;
  /** Host-built, keyless binding persisted atomically with a new production Task List. */
  commanderContinuation?: TaskListCommanderContinuationConfig;
}

export function mergePromptGuidesWithBuiltIns(
  promptGuides: CommanderPromptGuide[],
  processPromptGuides?: CommanderPromptGuide[],
): CommanderPromptGuide[] {
  const merged: CommanderPromptGuide[] = [];
  const seen = new Set<string>();

  if (processPromptGuides) {
    for (const guide of processPromptGuides) {
      if (seen.has(guide.id)) continue;
      seen.add(guide.id);
      merged.push(guide);
    }
  }

  for (const guide of promptGuides) {
    if (seen.has(guide.id)) continue;
    seen.add(guide.id);
    merged.push(guide);
  }

  return merged;
}
