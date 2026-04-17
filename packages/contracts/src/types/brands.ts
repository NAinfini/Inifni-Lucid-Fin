/**
 * Intersection-brand nominal types.
 *
 * Each branded ID is `BaseType & { readonly __brand: 'Name' }`. The brand
 * field is never present at runtime — it exists solely to prevent the
 * compiler from unifying structurally identical strings (e.g. CanvasId vs
 * NodeId). Construction happens ONLY through:
 *   - `unsafeBrand<T>()` in `@lucid-fin/contracts-parse` (lint-restricted)
 *   - `parseX()` / `tryX()` brand parsers in `@lucid-fin/contracts-parse`
 *   - zod `.transform(v => unsafeBrand<T>(v))` at IPC / DB boundaries
 *
 * This file is purely types — zero runtime, zero zod. It lives in
 * `@lucid-fin/contracts` so every package (including the renderer) can
 * reference these types without pulling in zod.
 */

// ── Canvas & Node ──────────────────────────────────────────────
export type CanvasId = string & { readonly __brand: 'CanvasId' };
export type NodeId = string & { readonly __brand: 'NodeId' };

// ── Entity ─────────────────────────────────────────────────────
export type CharacterId = string & { readonly __brand: 'CharacterId' };
export type EquipmentId = string & { readonly __brand: 'EquipmentId' };
export type LocationId = string & { readonly __brand: 'LocationId' };

// ── Provider & Adapter ─────────────────────────────────────────
export type ProviderId = string & { readonly __brand: 'ProviderId' };
export type AdapterId = string & { readonly __brand: 'AdapterId' };

// ── Job & Session ──────────────────────────────────────────────
export type JobId = string & { readonly __brand: 'JobId' };
export type SessionId = string & { readonly __brand: 'SessionId' };

// ── Workflow ───────────────────────────────────────────────────
export type WorkflowRunId = string & { readonly __brand: 'WorkflowRunId' };
export type WorkflowStageId = string & { readonly __brand: 'WorkflowStageId' };
export type WorkflowTaskId = string & { readonly __brand: 'WorkflowTaskId' };

// ── Storage ────────────────────────────────────────────────────
export type SnapshotId = string & { readonly __brand: 'SnapshotId' };
export type AssetHash = string & { readonly __brand: 'AssetHash' };

// ── Content ────────────────────────────────────────────────────
export type PresetId = string & { readonly __brand: 'PresetId' };
export type ShotTemplateId = string & { readonly __brand: 'ShotTemplateId' };
export type ProcessPromptKey = string & { readonly __brand: 'ProcessPromptKey' };
export type PromptCode = string & { readonly __brand: 'PromptCode' };

// ── IPC (Phase B will replace the existing IpcChannel type alias) ───
// These brands are declared here but NOT re-exported from the barrel
// until Phase B deletes IpcChannelMap and the old IpcChannel type alias.
export type IpcChannelBrand = string & { readonly __brand: 'IpcChannel' };
export type IpcInvocationId = string & { readonly __brand: 'IpcInvocationId' };

// ── Tool ───────────────────────────────────────────────────────
export type ToolKey = string & { readonly __brand: 'ToolKey' };
