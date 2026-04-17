/**
 * Pure type shapes for Batch 7 (canvas:* core, non-generation).
 *
 * No zod, no runtime. Canvas DTOs (`Canvas`, `CanvasNode`, `CanvasEdge`,
 * `CanvasPatch`) remain `unknown` — Phase C will promote them once the DTOs
 * themselves are contract-owned.
 *
 * `canvas:generation:*` push channels and `canvas:generate` /
 * `canvas:cancelGeneration` invoke channels are covered by Batch 8.
 */

// ── canvas:list (invoke) ─────────────────────────────────────
export type CanvasListRequest = Record<string, never>;
export type CanvasListResponse = Array<{
  id: string;
  name: string;
  updatedAt: number;
}>;

// ── canvas:load (invoke) ─────────────────────────────────────
export interface CanvasLoadRequest {
  id: string;
}
export type CanvasLoadResponse = unknown;

// ── canvas:save (invoke) ─────────────────────────────────────
export type CanvasSaveRequest = unknown;
export type CanvasSaveResponse = void;

// ── canvas:create (invoke) ───────────────────────────────────
export interface CanvasCreateRequest {
  name: string;
}
export type CanvasCreateResponse = unknown;

// ── canvas:delete (invoke) ───────────────────────────────────
export interface CanvasDeleteRequest {
  id: string;
}
export type CanvasDeleteResponse = void;

// ── canvas:rename (invoke) ───────────────────────────────────
export interface CanvasRenameRequest {
  id: string;
  name: string;
}
export type CanvasRenameResponse = void;

// ── canvas:patch (invoke) ────────────────────────────────────
export interface CanvasPatchRequest {
  canvasId: string;
  patch: unknown;
}
export type CanvasPatchResponse = void;

// ── canvas:estimateCost (invoke) ─────────────────────────────
export interface CanvasEstimateCostRequest {
  canvasId: string;
  nodeId: string;
  providerId: string;
  providerConfig?: {
    baseUrl: string;
    model: string;
    apiKey?: string;
  };
}
export type CanvasEstimateCostResponse = unknown;
