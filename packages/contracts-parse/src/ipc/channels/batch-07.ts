/**
 * canvas:* core channels — Batch 7 (non-generation).
 *
 * Covers the core invoke handlers in
 * `apps/desktop-main/src/ipc/handlers/canvas.handlers.ts`
 * (`canvas:list`, `canvas:load`, `canvas:save`, `canvas:create`,
 * `canvas:delete`, `canvas:rename`, `canvas:patch`).
 *
 */
import { z } from 'zod';
import { defineInvokeChannel } from '../../channels.js';
import { CanvasPatchSchema, StrictCanvasSchema } from '../../schemas/canvas.js';
import { OrderedDeliverySequenceSchema } from '../../dto/ordered-delivery.js';

// ── Shared primitives ────────────────────────────────────────
// ── canvas:list (invoke) ─────────────────────────────────────
const CanvasListRequest = z.object({}).strict();
const CanvasListResponse = z.array(
  z.object({
    id: z.string(),
    name: z.string(),
    updatedAt: z.number(),
    archivedAt: z.number().int().nonnegative().optional(),
  }),
);
export const canvasListChannel = defineInvokeChannel({
  channel: 'canvas:list',
  request: CanvasListRequest,
  response: CanvasListResponse,
});
export type CanvasListRequest = z.infer<typeof CanvasListRequest>;
export type CanvasListResponse = z.infer<typeof CanvasListResponse>;

// ── canvas:loadAll (invoke) ──────────────────────────────────
const CanvasLoadAllRequest = z.object({}).strict();
const CanvasLoadAllResponse = z.array(StrictCanvasSchema);
export const canvasLoadAllChannel = defineInvokeChannel({
  channel: 'canvas:loadAll',
  request: CanvasLoadAllRequest,
  response: CanvasLoadAllResponse,
});
export type CanvasLoadAllRequest = z.infer<typeof CanvasLoadAllRequest>;
export type CanvasLoadAllResponse = z.infer<typeof CanvasLoadAllResponse>;

// ── canvas:load (invoke) ─────────────────────────────────────
const CanvasLoadRequest = z.object({ id: z.string().min(1) });
const CanvasLoadResponse = StrictCanvasSchema;
export const canvasLoadChannel = defineInvokeChannel({
  channel: 'canvas:load',
  request: CanvasLoadRequest,
  response: CanvasLoadResponse,
});
export type CanvasLoadRequest = z.infer<typeof CanvasLoadRequest>;
export type CanvasLoadResponse = z.infer<typeof CanvasLoadResponse>;

// ── canvas:save (invoke) ─────────────────────────────────────
const CanvasSaveRequest = StrictCanvasSchema;
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
const CanvasCreateResponse = StrictCanvasSchema;
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

// ── canvas:restore (invoke) ──────────────────────────────────
const CanvasRestoreRequest = z.object({ id: z.string().min(1) });
const CanvasRestoreResponse = z.void();
export const canvasRestoreChannel = defineInvokeChannel({
  channel: 'canvas:restore',
  request: CanvasRestoreRequest,
  response: CanvasRestoreResponse,
});
export type CanvasRestoreRequest = z.infer<typeof CanvasRestoreRequest>;
export type CanvasRestoreResponse = z.infer<typeof CanvasRestoreResponse>;

// ── canvas:deletePermanent (invoke) ──────────────────────────
const CanvasDeletePermanentRequest = z.object({ id: z.string().min(1) });
const CanvasDeletePermanentResponse = z.void();
export const canvasDeletePermanentChannel = defineInvokeChannel({
  channel: 'canvas:deletePermanent',
  request: CanvasDeletePermanentRequest,
  response: CanvasDeletePermanentResponse,
});
export type CanvasDeletePermanentRequest = z.infer<typeof CanvasDeletePermanentRequest>;
export type CanvasDeletePermanentResponse = z.infer<typeof CanvasDeletePermanentResponse>;

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
const CanvasPatchRequest = z.object({
  canvasId: z.string().min(1),
  patch: CanvasPatchSchema,
});
const CanvasPatchResponse = z.void();
export const canvasPatchChannel = defineInvokeChannel({
  channel: 'canvas:patch',
  request: CanvasPatchRequest,
  response: CanvasPatchResponse,
});
export type CanvasPatchRequest = z.infer<typeof CanvasPatchRequest>;
export type CanvasPatchResponse = z.infer<typeof CanvasPatchResponse>;

// ── canvasDelivery:update (invoke) ─────────────────────────────
const CanvasDeliveryUpdateRequest = z
  .object({
    canvasId: z.string().min(1),
    expectedRevision: z.number().int().nonnegative(),
    deliverySequence: OrderedDeliverySequenceSchema,
  })
  .strict()
  .superRefine((request, ctx) => {
    if (request.deliverySequence.revision !== request.expectedRevision + 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['deliverySequence', 'revision'],
        message: 'deliverySequence.revision must equal expectedRevision + 1',
      });
    }
  });
const CanvasDeliveryUpdateResponse = z
  .object({ deliverySequence: OrderedDeliverySequenceSchema })
  .strict();
export const canvasDeliveryUpdateChannel = defineInvokeChannel({
  channel: 'canvasDelivery:update',
  request: CanvasDeliveryUpdateRequest,
  response: CanvasDeliveryUpdateResponse,
});
export type CanvasDeliveryUpdateRequest = z.infer<typeof CanvasDeliveryUpdateRequest>;
export type CanvasDeliveryUpdateResponse = z.infer<typeof CanvasDeliveryUpdateResponse>;

export const canvasChannels = [
  canvasListChannel,
  canvasLoadAllChannel,
  canvasLoadChannel,
  canvasSaveChannel,
  canvasCreateChannel,
  canvasDeleteChannel,
  canvasRestoreChannel,
  canvasDeletePermanentChannel,
  canvasRenameChannel,
  canvasPatchChannel,
  canvasDeliveryUpdateChannel,
] as const;
