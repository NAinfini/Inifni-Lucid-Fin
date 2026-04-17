/**
 * canvas:* core channels — Batch 7 (non-generation).
 *
 * Covers the 7 invoke handlers in
 * `apps/desktop-main/src/ipc/handlers/canvas.handlers.ts`
 * (`canvas:list`, `canvas:load`, `canvas:save`, `canvas:create`,
 * `canvas:delete`, `canvas:rename`, `canvas:patch`) plus the
 * `canvas:estimateCost` invoke handler that physically lives in
 * `canvas-generation.handlers.ts` but does not emit generation progress and
 * is treated as a canvas core channel (its name has no `generation:` segment).
 *
 * Canvas DTOs (`Canvas`, `CanvasNode`, `CanvasEdge`, `CanvasPatch`) remain
 * `z.unknown()` per Phase B-1 precedent — Phase C will zodify them once the
 * DTOs move into contract ownership.
 *
 * `canvas:generation:*` push channels and `canvas:generate` /
 * `canvas:cancelGeneration` invoke channels are covered by Batch 8.
 *
 * No `webContents.send('canvas:…')` push channels exist outside the
 * `canvas:generation:*` namespace.
 */
import { z } from 'zod';
import { defineInvokeChannel } from '../../channels.js';

// ── Shared primitives ────────────────────────────────────────
// Canvas / CanvasPatch / CanvasNode / CanvasEdge stay opaque (`unknown`) at
// this stage — Phase C will zodify the DTOs.
const CanvasShape = z.unknown();
const CanvasPatchShape = z.unknown();

// ── canvas:list (invoke) ─────────────────────────────────────
const CanvasListRequest = z.object({}).strict();
const CanvasListResponse = z.array(
  z.object({
    id: z.string(),
    name: z.string(),
    updatedAt: z.number(),
  }),
);
export const canvasListChannel = defineInvokeChannel({
  channel: 'canvas:list',
  request: CanvasListRequest,
  response: CanvasListResponse,
});
export type CanvasListRequest = z.infer<typeof CanvasListRequest>;
export type CanvasListResponse = z.infer<typeof CanvasListResponse>;

// ── canvas:load (invoke) ─────────────────────────────────────
const CanvasLoadRequest = z.object({ id: z.string().min(1) });
const CanvasLoadResponse = CanvasShape;
export const canvasLoadChannel = defineInvokeChannel({
  channel: 'canvas:load',
  request: CanvasLoadRequest,
  response: CanvasLoadResponse,
});
export type CanvasLoadRequest = z.infer<typeof CanvasLoadRequest>;
export type CanvasLoadResponse = z.infer<typeof CanvasLoadResponse>;

// ── canvas:save (invoke) ─────────────────────────────────────
// Request is the full Canvas DTO — kept opaque at this stage.
const CanvasSaveRequest = CanvasShape;
const CanvasSaveResponse = z.void();
export const canvasSaveChannel = defineInvokeChannel({
  channel: 'canvas:save',
  request: CanvasSaveRequest,
  response: CanvasSaveResponse,
});
export type CanvasSaveRequest = z.infer<typeof CanvasSaveRequest>;
export type CanvasSaveResponse = z.infer<typeof CanvasSaveResponse>;

// ── canvas:create (invoke) ───────────────────────────────────
const CanvasCreateRequest = z.object({ name: z.string().min(1) });
const CanvasCreateResponse = CanvasShape;
export const canvasCreateChannel = defineInvokeChannel({
  channel: 'canvas:create',
  request: CanvasCreateRequest,
  response: CanvasCreateResponse,
});
export type CanvasCreateRequest = z.infer<typeof CanvasCreateRequest>;
export type CanvasCreateResponse = z.infer<typeof CanvasCreateResponse>;

// ── canvas:delete (invoke) ───────────────────────────────────
const CanvasDeleteRequest = z.object({ id: z.string().min(1) });
const CanvasDeleteResponse = z.void();
export const canvasDeleteChannel = defineInvokeChannel({
  channel: 'canvas:delete',
  request: CanvasDeleteRequest,
  response: CanvasDeleteResponse,
});
export type CanvasDeleteRequest = z.infer<typeof CanvasDeleteRequest>;
export type CanvasDeleteResponse = z.infer<typeof CanvasDeleteResponse>;

// ── canvas:rename (invoke) ───────────────────────────────────
const CanvasRenameRequest = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
});
const CanvasRenameResponse = z.void();
export const canvasRenameChannel = defineInvokeChannel({
  channel: 'canvas:rename',
  request: CanvasRenameRequest,
  response: CanvasRenameResponse,
});
export type CanvasRenameRequest = z.infer<typeof CanvasRenameRequest>;
export type CanvasRenameResponse = z.infer<typeof CanvasRenameResponse>;

// ── canvas:patch (invoke) ────────────────────────────────────
// `patch` carries the full CanvasPatch DTO (name/node/edge deltas) — kept
// opaque until Phase C zodifies CanvasNode / CanvasEdge.
const CanvasPatchRequest = z.object({
  canvasId: z.string().min(1),
  patch: CanvasPatchShape,
});
const CanvasPatchResponse = z.void();
export const canvasPatchChannel = defineInvokeChannel({
  channel: 'canvas:patch',
  request: CanvasPatchRequest,
  response: CanvasPatchResponse,
});
export type CanvasPatchRequest = z.infer<typeof CanvasPatchRequest>;
export type CanvasPatchResponse = z.infer<typeof CanvasPatchResponse>;

// ── canvas:estimateCost (invoke) ─────────────────────────────
// Non-generation canvas channel — lives in canvas-generation.handlers.ts for
// implementation convenience but belongs to the canvas core namespace.
// The cost-breakdown response is currently `{ estimatedCost, currency }`
// in ipc.ts; kept opaque here per precedent until Phase C zodifies the shape.
const CanvasEstimateCostRequest = z.object({
  canvasId: z.string().min(1),
  nodeId: z.string().min(1),
  providerId: z.string().min(1),
  providerConfig: z
    .object({
      baseUrl: z.string(),
      model: z.string(),
      apiKey: z.string().optional(),
    })
    .optional(),
});
const CanvasEstimateCostResponse = z.unknown();
export const canvasEstimateCostChannel = defineInvokeChannel({
  channel: 'canvas:estimateCost',
  request: CanvasEstimateCostRequest,
  response: CanvasEstimateCostResponse,
});
export type CanvasEstimateCostRequest = z.infer<typeof CanvasEstimateCostRequest>;
export type CanvasEstimateCostResponse = z.infer<typeof CanvasEstimateCostResponse>;

export const canvasChannels = [
  canvasListChannel,
  canvasLoadChannel,
  canvasSaveChannel,
  canvasCreateChannel,
  canvasDeleteChannel,
  canvasRenameChannel,
  canvasPatchChannel,
  canvasEstimateCostChannel,
] as const;
