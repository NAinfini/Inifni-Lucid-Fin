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
  createEntityTools,
  createPresetTools,
  createPromptTools,
  createProviderTools,
  createRenderTools,
  createScriptTools,
  createMetaTools,
  createWorkflowTools,
  createTextAnalyzeTools,
  createSnapshotTools,
  registerToolModule,
  registerFiltered,
  EXCLUDED_TOOLS,
  jobToolModule,
  colorStyleToolModule,
  seriesToolModule,
  createTodoTools,
  type JobQueue,
  type WorkflowEngine,
  type WorkflowCommanderContinuationConfig,
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
import { startCanvasGeneration, cancelCanvasGeneration } from '../canvas-generation.handlers.js';
import { buildGenerationContext } from '../generation-context.js';
import { getCachedProviders } from '../../settings-cache.js';
import { getBufferedLogs } from '../../../logger.js';
import { makeGenerateImage } from '../commander-image-gen.js';
import {
  createRendererPushGateway,
  type RendererPushGateway,
} from '../../../features/ipc/push-gateway.js';
import type { BrowserWindow } from 'electron';
import { createVideoTools } from '../video-tools.js';
import { detectScenes, extractFrameAtTime } from '@lucid-fin/media-engine';
import type { VisualAnalyzer } from '../../../services/visual-analyzer.service.js';

export {
  fs,
  path,
  randomUUID,
  os,
  buildRuntimeLLMAdapter,
  AgentToolRegistry,
  createAssetTools,
  createCanvasTools,
  createEntityTools,
  createPresetTools,
  createPromptTools,
  createProviderTools,
  createRenderTools,
  createScriptTools,
  createMetaTools,
  createWorkflowTools,
  createTextAnalyzeTools,
  createSnapshotTools,
  registerToolModule,
  registerFiltered,
  EXCLUDED_TOOLS,
  jobToolModule,
  colorStyleToolModule,
  seriesToolModule,
  createTodoTools,
  parseScript,
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
  BUILT_IN_SHOT_TEMPLATES,
  NODE_KINDS,
  createEmptyPresetTrackSet,
  normalizeLLMProviderRuntimeConfig,
  getBuiltinVisionProviderPreset,
  startCanvasGeneration,
  cancelCanvasGeneration,
  buildGenerationContext,
  getCachedProviders,
  getBufferedLogs,
  makeGenerateImage,
  createRendererPushGateway,
  createVideoTools,
  detectScenes,
  extractFrameAtTime,
};

export type {
  AdapterRegistry,
  LLMRegistry,
  JobQueue,
  WorkflowEngine,
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
  visualAnalyzer: VisualAnalyzer;
  canvasStore: CanvasStore;
  presetLibrary: PresetDefinition[];
  jobQueue: JobQueue;
  workflowEngine: WorkflowEngine;
  db: SqliteIndex;
  cas: CAS;
  keychain: import('@lucid-fin/storage').Keychain;
  promptStore: PromptStore;
  finalExportService: import('../../../services/final-export.service.js').FinalExportService;
  productionMediaService: import('../../../services/production-media.service.js').ProductionMediaService;
  /** Host-built, keyless binding persisted atomically with a new production workflow. */
  commanderContinuation?: WorkflowCommanderContinuationConfig;
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
