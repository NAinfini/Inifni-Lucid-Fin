/**
 * canvas generation + preset:* channels — Batch 8.
 *
 * Covers:
 *  - `canvas:generate`, `canvas:cancelGeneration` from
 *    `apps/desktop-main/src/ipc/handlers/canvas-generation.handlers.ts`
 *  - `canvas:generation:progress`, `canvas:generation:complete`,
 *    `canvas:generation:failed` push channels
 *  - `preset:list`, `preset:save`, `preset:delete`, `preset:reset`,
 *    `preset:import`, `preset:export` from
 *    `apps/desktop-main/src/ipc/handlers/preset.handlers.ts`
 *
 * Preset DTOs live in `@lucid-fin/contracts` (`dto/presets/core.ts`) and
 * stay strongly typed at compile time. The zod shapes declared here validate
 * only the outer envelope — deep shape validation (e.g. `PresetParamDefinition`
 * subtypes) stays loose via `z.unknown()` / `z.record(...)`, mirroring how
 * Batch 4 treated storage responses.
 */
import { z } from 'zod';
import { defineInvokeChannel, definePushChannel } from '../../channels.js';

// ── Shared preset primitives ─────────────────────────────────
// Keep field-level shapes loose — compile-time DTOs in @lucid-fin/contracts
// remain the canonical source of truth.
const PresetCategoryEnum = z.enum([
  'camera',
  'lens',
  'look',
  'scene',
  'composition',
  'emotion',
  'flow',
  'technical',
]);

const PresetDefinitionShape = z
  .object({
    id: z.string().min(1),
    category: PresetCategoryEnum,
    name: z.string(),
    description: z.string(),
    prompt: z.string(),
    builtIn: z.boolean(),
    modified: z.boolean(),
    params: z.array(z.unknown()),
    defaults: z.record(z.string(), z.unknown()),
  })
  .passthrough();

const PresetLibraryExportRequestShape = z
  .object({
    includeBuiltIn: z.boolean().optional(),
    categories: z.array(PresetCategoryEnum).optional(),
  })
  .passthrough();

const PresetLibraryExportPayloadShape = z
  .object({
    version: z.literal(1),
    exportedAt: z.number(),
    presets: z.array(PresetDefinitionShape),
  })
  .passthrough();

const PresetLibraryImportPayloadShape = z
  .object({
    presets: z.array(PresetDefinitionShape),
    includeBuiltIn: z.boolean().optional(),
    source: z.enum(['file', 'clipboard', 'api']).optional(),
  })
  .passthrough();

const PresetResetRequestShape = z
  .object({
    id: z.string().min(1),
    scope: z.enum(['prompt', 'params', 'all']).optional(),
  })
  .passthrough();

// ── canvas:generate (invoke) ────────────────────────────────
const CanvasGenerateRequest = z.object({
  canvasId: z.string().min(1),
  nodeId: z.string().min(1),
  providerId: z.string().optional(),
  providerConfig: z
    .object({
      baseUrl: z.string(),
      model: z.string(),
      apiKey: z.string().optional(),
    })
    .optional(),
  variantCount: z.number().int().positive().optional(),
  seed: z.number().optional(),
});
const CanvasGenerateResponse = z.void();
export const canvasGenerateChannel = defineInvokeChannel({
  channel: 'canvas:generate',
  request: CanvasGenerateRequest,
  response: CanvasGenerateResponse,
});
export type CanvasGenerateRequest = z.infer<typeof CanvasGenerateRequest>;
export type CanvasGenerateResponse = z.infer<typeof CanvasGenerateResponse>;

// ── canvas:cancelGeneration (invoke) ────────────────────────
const CanvasCancelGenerationRequest = z.object({
  canvasId: z.string().min(1),
  nodeId: z.string().min(1),
});
const CanvasCancelGenerationResponse = z.void();
export const canvasCancelGenerationChannel = defineInvokeChannel({
  channel: 'canvas:cancelGeneration',
  request: CanvasCancelGenerationRequest,
  response: CanvasCancelGenerationResponse,
});
export type CanvasCancelGenerationRequest = z.infer<typeof CanvasCancelGenerationRequest>;
export type CanvasCancelGenerationResponse = z.infer<typeof CanvasCancelGenerationResponse>;

// ── preset:list (invoke) ────────────────────────────────────
const PresetListRequest = z
  .object({
    includeBuiltIn: z.boolean().optional(),
    category: PresetCategoryEnum.optional(),
  })
  .passthrough();
const PresetListResponse = z.array(PresetDefinitionShape);
export const presetListChannel = defineInvokeChannel({
  channel: 'preset:list',
  request: PresetListRequest,
  response: PresetListResponse,
});
export type PresetListRequest = z.infer<typeof PresetListRequest>;
export type PresetListResponse = z.infer<typeof PresetListResponse>;

// ── preset:save (invoke) ────────────────────────────────────
const PresetSaveRequest = PresetDefinitionShape;
const PresetSaveResponse = PresetDefinitionShape;
export const presetSaveChannel = defineInvokeChannel({
  channel: 'preset:save',
  request: PresetSaveRequest,
  response: PresetSaveResponse,
});
export type PresetSaveRequest = z.infer<typeof PresetSaveRequest>;
export type PresetSaveResponse = z.infer<typeof PresetSaveResponse>;

// ── preset:delete (invoke) ──────────────────────────────────
const PresetDeleteRequest = z.object({ id: z.string().min(1) });
const PresetDeleteResponse = z.void();
export const presetDeleteChannel = defineInvokeChannel({
  channel: 'preset:delete',
  request: PresetDeleteRequest,
  response: PresetDeleteResponse,
});
export type PresetDeleteRequest = z.infer<typeof PresetDeleteRequest>;
export type PresetDeleteResponse = z.infer<typeof PresetDeleteResponse>;

// ── preset:reset (invoke) ───────────────────────────────────
const PresetResetRequest = PresetResetRequestShape;
const PresetResetResponse = PresetDefinitionShape;
export const presetResetChannel = defineInvokeChannel({
  channel: 'preset:reset',
  request: PresetResetRequest,
  response: PresetResetResponse,
});
export type PresetResetRequest = z.infer<typeof PresetResetRequest>;
export type PresetResetResponse = z.infer<typeof PresetResetResponse>;

// ── preset:import (invoke) ──────────────────────────────────
const PresetImportRequest = PresetLibraryImportPayloadShape;
const PresetImportResponse = PresetLibraryExportPayloadShape;
export const presetImportChannel = defineInvokeChannel({
  channel: 'preset:import',
  request: PresetImportRequest,
  response: PresetImportResponse,
});
export type PresetImportRequest = z.infer<typeof PresetImportRequest>;
export type PresetImportResponse = z.infer<typeof PresetImportResponse>;

// ── preset:export (invoke) ──────────────────────────────────
// Handler accepts an optional request (`ensureExportRequest` defaults to
// `{ includeBuiltIn: true }`). All fields on the DTO are already optional,
// so the schema itself is the DTO shape — a missing arg parses as `{}`.
const PresetExportRequest = PresetLibraryExportRequestShape;
const PresetExportResponse = PresetLibraryExportPayloadShape;
export const presetExportChannel = defineInvokeChannel({
  channel: 'preset:export',
  request: PresetExportRequest,
  response: PresetExportResponse,
});
export type PresetExportRequest = z.infer<typeof PresetExportRequest>;
export type PresetExportResponse = z.infer<typeof PresetExportResponse>;

// ── canvas:generation:progress (push) ──────────────────────
const CanvasGenerationProgressPayload = z.object({
  canvasId: z.string(),
  nodeId: z.string(),
  progress: z.number(),
  currentStep: z.string().optional(),
});
export const canvasGenerationProgressChannel = definePushChannel({
  channel: 'canvas:generation:progress',
  payload: CanvasGenerationProgressPayload,
});
export type CanvasGenerationProgressPayload = z.infer<typeof CanvasGenerationProgressPayload>;

// ── canvas:generation:complete (push) ──────────────────────
const CanvasGenerationCompletePayload = z.object({
  canvasId: z.string(),
  nodeId: z.string(),
  variants: z.array(z.string()),
  primaryAssetHash: z.string(),
  cost: z.number().optional(),
  generationTimeMs: z.number(),
  characterRefs: z.array(z.object({ entityId: z.string(), imageHashes: z.array(z.string()) })).optional(),
  equipmentRefs: z.array(z.object({ entityId: z.string(), imageHashes: z.array(z.string()) })).optional(),
  locationRefs: z.array(z.object({ entityId: z.string(), imageHashes: z.array(z.string()) })).optional(),
  frameReferenceHashes: z.object({ first: z.string().optional(), last: z.string().optional() }).optional(),
  sourceImageHash: z.string().optional(),
  model: z.string().optional(),
});
export const canvasGenerationCompleteChannel = definePushChannel({
  channel: 'canvas:generation:complete',
  payload: CanvasGenerationCompletePayload,
});
export type CanvasGenerationCompletePayload = z.infer<typeof CanvasGenerationCompletePayload>;

// ── canvas:generation:failed (push) ────────────────────────
const CanvasGenerationFailedPayload = z.object({
  canvasId: z.string(),
  nodeId: z.string(),
  error: z.string(),
});
export const canvasGenerationFailedChannel = definePushChannel({
  channel: 'canvas:generation:failed',
  payload: CanvasGenerationFailedPayload,
});
export type CanvasGenerationFailedPayload = z.infer<typeof CanvasGenerationFailedPayload>;

// ── Channel tuples ──────────────────────────────────────────
export const canvasGenerationChannels = [
  canvasGenerateChannel,
  canvasCancelGenerationChannel,
] as const;

export const canvasGenerationPushChannels = [
  canvasGenerationProgressChannel,
  canvasGenerationCompleteChannel,
  canvasGenerationFailedChannel,
] as const;

export const presetChannels = [
  presetListChannel,
  presetSaveChannel,
  presetDeleteChannel,
  presetResetChannel,
  presetImportChannel,
  presetExportChannel,
] as const;
