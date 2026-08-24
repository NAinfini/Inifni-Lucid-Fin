/**
 * Pure type shapes for Batch 7 (canvas:* core, non-generation).
 *
 * No zod, no runtime.
 */

import type { Canvas, CanvasPatch } from '../../dto/canvas.js';
import type { OrderedDeliverySequence } from '../../dto/ordered-delivery.js';

// ── canvas:list (invoke) ─────────────────────────────────────
export type CanvasListRequest = Record<string, never>;
export type CanvasListResponse = Array<{
  id: string;
  name: string;
  updatedAt: number;
  archivedAt?: number;
}>;

// ── canvas:loadAll (invoke) ──────────────────────────────────
export type CanvasLoadAllRequest = Record<string, never>;
export type CanvasLoadAllResponse = Canvas[];

// ── canvas:load (invoke) ─────────────────────────────────────
export interface CanvasLoadRequest {
  id: string;
}
export type CanvasLoadResponse = Canvas;

// ── canvas:save (invoke) ─────────────────────────────────────
export type CanvasSaveRequest = Canvas;
export type CanvasSaveResponse = void;

// ── canvas:create (invoke) ───────────────────────────────────
export interface CanvasCreateRequest {
  name: string;
}
export type CanvasCreateResponse = Canvas;

// ── canvas:delete (invoke) ───────────────────────────────────
export interface CanvasDeleteRequest {
  id: string;
}
export type CanvasDeleteResponse = void;

// ── canvas:restore (invoke) ──────────────────────────────────
export interface CanvasRestoreRequest {
  id: string;
}
export type CanvasRestoreResponse = void;

// ── canvas:deletePermanent (invoke) ──────────────────────────
export interface CanvasDeletePermanentRequest {
  id: string;
}
export type CanvasDeletePermanentResponse = void;

// ── canvas:rename (invoke) ───────────────────────────────────
export interface CanvasRenameRequest {
  id: string;
  name: string;
}
export type CanvasRenameResponse = void;

// ── canvas:patch (invoke) ────────────────────────────────────
export interface CanvasPatchRequest {
  canvasId: string;
  patch: CanvasPatch;
}
export type CanvasPatchResponse = void;

// ── canvasDelivery:update (invoke) ─────────────────────────────
export interface CanvasDeliveryUpdateRequest {
  canvasId: string;
  expectedRevision: number;
  deliverySequence: OrderedDeliverySequence;
}
export interface CanvasDeliveryUpdateResponse {
  deliverySequence: OrderedDeliverySequence;
}
