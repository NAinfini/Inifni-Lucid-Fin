/**
 * Pure type shapes for Batch 3 (location:* + style:* + entity:* + colorStyle:*).
 *
 * No zod, no runtime. Complex DTO payloads (Location, StyleGuide, ColorStyle,
 * ReferenceImage) are left as `unknown` — Phase C will promote them to the
 * real DTO types once the DTOs themselves are contract-owned.
 */

// ── location:list ────────────────────────────────────────────
export interface LocationListRequest {
  type?: string;
}
export type LocationListResponse = unknown[];

// ── location:get ─────────────────────────────────────────────
export interface LocationGetRequest {
  id: string;
}
export type LocationGetResponse = unknown;

// ── location:save ────────────────────────────────────────────
export type LocationSaveRequest = unknown;
export type LocationSaveResponse = unknown;

// ── location:delete ──────────────────────────────────────────
export interface LocationDeleteRequest {
  id: string;
}
export type LocationDeleteResponse = void;

// ── location:setRefImage ─────────────────────────────────────
export interface LocationSetRefImageRequest {
  locationId: string;
  slot: string;
  assetHash: string;
  isStandard: boolean;
}
export type LocationSetRefImageResponse = unknown;

// ── location:removeRefImage ──────────────────────────────────
export interface LocationRemoveRefImageRequest {
  locationId: string;
  slot: string;
}
export type LocationRemoveRefImageResponse = void;

// ── style:save ───────────────────────────────────────────────
export type StyleSaveRequest = unknown;
export type StyleSaveResponse = void;

// ── style:load ───────────────────────────────────────────────
export type StyleLoadRequest = Record<string, never>;
export type StyleLoadResponse = unknown;

// ── entity:generateReferenceImage ────────────────────────────
export interface EntityGenerateReferenceImageRequest {
  entityType: 'character' | 'equipment' | 'location';
  entityId: string;
  description: string;
  provider: string;
  variantCount?: number;
  seed?: number;
}
export interface EntityGenerateReferenceImageResponse {
  variants: string[];
}

// ── colorStyle:list ──────────────────────────────────────────
export type ColorStyleListRequest = Record<string, never>;
export type ColorStyleListResponse = unknown[];

// ── colorStyle:save ──────────────────────────────────────────
export type ColorStyleSaveRequest = unknown;
export type ColorStyleSaveResponse = unknown;

// ── colorStyle:delete ────────────────────────────────────────
export interface ColorStyleDeleteRequest {
  id: string;
}
export type ColorStyleDeleteResponse = void;

// ── colorStyle:extract ───────────────────────────────────────
export interface ColorStyleExtractRequest {
  assetHash: string;
  assetType: 'image' | 'video';
}
export interface ColorStyleExtractResponse {
  workflowRunId: string;
}
