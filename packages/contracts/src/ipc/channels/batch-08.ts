/**
 * Pure type shapes for Batch 8 — preset.
 *
 * No zod, no runtime. Re-uses the canonical preset DTOs from
 * `../../dto/presets/core.ts` as the single source of truth, rather than
 * redefining the shapes here.
 *
 * Scope (6 invoke channels):
 *  - preset:list, preset:save, preset:delete, preset:reset,
 *    preset:import, preset:export
 */
import type {
  PresetCategory,
  PresetDefinition,
  PresetLibraryExportPayload,
  PresetLibraryExportRequest,
  PresetLibraryImportPayload,
} from '../../dto/presets/core.js';

// Re-export the canonical reset-request DTO so callers can import
// `PresetResetRequest` from the channel barrel alongside the request/response
// aliases defined below.
export type { PresetResetRequest } from '../../dto/presets/core.js';

// ── preset:list (invoke) ────────────────────────────────────
export interface PresetListRequest {
  includeBuiltIn?: boolean;
  category?: PresetCategory;
}
export type PresetListResponse = PresetDefinition[];

// ── preset:save (invoke) ────────────────────────────────────
export type PresetSaveRequest = PresetDefinition;
export type PresetSaveResponse = PresetDefinition;

// ── preset:delete (invoke) ──────────────────────────────────
export interface PresetDeleteRequest {
  id: string;
}
export type PresetDeleteResponse = void;

// ── preset:reset (invoke) ───────────────────────────────────
// Request type is `PresetResetRequest` re-exported above; response is the
// updated `PresetDefinition`.
export type PresetResetResponse = PresetDefinition;

// ── preset:import (invoke) ──────────────────────────────────
export type PresetImportRequest = PresetLibraryImportPayload;
export type PresetImportResponse = PresetLibraryExportPayload;

// ── preset:export (invoke) ──────────────────────────────────
// Handler accepts the request as optional — `ensureExportRequest` defaults
// to `{ includeBuiltIn: true }` when absent. All fields on the DTO are
// already optional, so the request shape itself is the DTO.
export type PresetExportRequest = PresetLibraryExportRequest;
export type PresetExportResponse = PresetLibraryExportPayload;
