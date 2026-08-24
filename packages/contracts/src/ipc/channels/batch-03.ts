/**
 * Pure type shapes for Batch 3 (location:* + style:* + entity:* + colorStyle:*).
 *
 * No zod, no runtime. Complex DTO payloads (Location, StyleGuide, ColorStyle,
 * ReferenceImage) are left as `unknown` — Phase C will promote them to the
 * real DTO types once the DTOs themselves are contract-owned.
 */

import type { Location } from '../../dto/location.js';

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
export interface LocationCopyRequest {
  ids: string[];
  targetFolderId: string | null;
}
export interface LocationCopyResponse {
  created: Location[];
}

export interface LocationDeleteRequest {
  ids: string[];
}
export interface LocationDeleteResponse {
  deletedIds: string[];
}

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
  taskListId: string;
}
