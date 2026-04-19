/**
 * Pure type shapes for Batch 4 (asset:* + storage:*).
 *
 * No zod, no runtime. Complex DTO payloads (AssetRef, AssetMeta) and the
 * storage:getOverview summary object are left as `unknown` — Phase C will
 * promote them to the real DTO types once the DTOs themselves are
 * contract-owned.
 */

// ── Shared ───────────────────────────────────────────────────
export type AssetType = 'image' | 'video' | 'audio';

// ── asset:import ─────────────────────────────────────────────
export interface AssetImportRequest {
  filePath: string;
  type: AssetType;
}
export type AssetImportResponse = unknown;

// ── asset:importBuffer ───────────────────────────────────────
export interface AssetImportBufferRequest {
  buffer: unknown;
  fileName: string;
  type: AssetType;
}
export type AssetImportBufferResponse = unknown;

// ── asset:pickFile ───────────────────────────────────────────
export interface AssetPickFileRequest {
  type: AssetType;
}
export type AssetPickFileResponse = unknown | null;

// ── asset:query ──────────────────────────────────────────────
export interface AssetQueryRequest {
  type?: string;
  tags?: string[];
  search?: string;
  limit?: number;
  offset?: number;
}
export type AssetQueryResponse = unknown[];

// ── asset:getPath ────────────────────────────────────────────
export interface AssetGetPathRequest {
  hash: string;
  type: AssetType;
  ext: string;
}
export type AssetGetPathResponse = string;

// ── asset:delete ─────────────────────────────────────────────
export interface AssetDeleteRequest {
  hash: string;
}
export interface AssetDeleteResponse {
  success: boolean;
}

// ── asset:export ─────────────────────────────────────────────
export interface AssetExportRequest {
  hash: string;
  type: AssetType;
  format: string;
  name?: string;
}
export type AssetExportResponse = { success: true; path: string } | null;

// ── asset:exportBatch ────────────────────────────────────────
export interface AssetExportBatchItem {
  hash: string;
  type: AssetType;
  name?: string;
}
export interface AssetExportBatchRequest {
  items: AssetExportBatchItem[];
}
export type AssetExportBatchResponse =
  | { success: true; count: number; directory: string }
  | null;

// ── storage:getOverview ──────────────────────────────────────
export type StorageGetOverviewRequest = Record<string, never>;
export type StorageGetOverviewResponse = unknown;

// ── storage:openFolder ───────────────────────────────────────
export interface StorageOpenFolderRequest {
  path: string;
}
export type StorageOpenFolderResponse = void;

// ── storage:showInFolder ─────────────────────────────────────
export interface StorageShowInFolderRequest {
  path: string;
}
export type StorageShowInFolderResponse = void;

// ── storage:clearLogs ────────────────────────────────────────
export type StorageClearLogsRequest = Record<string, never>;
export interface StorageClearLogsResponse {
  cleared: number;
}

// ── storage:clearEmbeddings ──────────────────────────────────
export type StorageClearEmbeddingsRequest = Record<string, never>;
export interface StorageClearEmbeddingsResponse {
  success: boolean;
  error?: string;
}

// ── storage:vacuumDatabase ───────────────────────────────────
export type StorageVacuumDatabaseRequest = Record<string, never>;
export interface StorageVacuumDatabaseResponse {
  success: boolean;
  error?: string;
}

// ── storage:backupDatabase ───────────────────────────────────
export interface StorageBackupDatabaseRequest {
  destPath: string;
}
export interface StorageBackupDatabaseResponse {
  success: boolean;
  error?: string;
}

// ── storage:restoreDatabase ──────────────────────────────────
export interface StorageRestoreDatabaseRequest {
  sourcePath: string;
}
export interface StorageRestoreDatabaseResponse {
  success: boolean;
  backupCreated?: string;
  error?: string;
}

// ── storage:pickFolder ───────────────────────────────────────
export type StoragePickFolderRequest = Record<string, never>;
export type StoragePickFolderResponse = string | null;

// ── storage:pickSaveFile ─────────────────────────────────────
export interface StoragePickSaveFileRequest {
  defaultName: string;
}
export type StoragePickSaveFileResponse = string | null;

// ── storage:pickOpenFile ─────────────────────────────────────
export interface StoragePickOpenFileRequest {
  extensions: string[];
}
export type StoragePickOpenFileResponse = string | null;
