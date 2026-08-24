/**
 * Pure type shapes for Asset entry/content and storage IPC.
 *
 * No zod, no runtime. Complex DTO payloads (AssetRef, AssetMeta) and the
 * storage:getOverview summary object are left as `unknown` — Phase C will
 * promote them to the real DTO types once the DTOs themselves are
 * contract-owned.
 */

import type { AssetEntry, AssetMeta } from '../../dto/asset.js';

// ── Shared ───────────────────────────────────────────────────
export type AssetType = 'image' | 'video' | 'audio';

// ── assetEntry:import ────────────────────────────────────────
export interface AssetEntryImportRequest {
  filePath: string;
  type: AssetType;
}
export type AssetEntryImportResponse = AssetEntry;

// ── assetEntry:importBuffer ──────────────────────────────────
export interface AssetEntryImportBufferRequest {
  buffer: unknown;
  fileName: string;
  type: AssetType;
}
export type AssetEntryImportBufferResponse = AssetEntry;

// ── assetEntry:pickFile ──────────────────────────────────────
export interface AssetEntryPickFileRequest {
  type: AssetType;
}
export type AssetEntryPickFileResponse = AssetEntry | null;

// ── assetEntry:query ─────────────────────────────────────────
export interface AssetEntryQueryRequest {
  type?: string;
  tags?: string[];
  search?: string;
  limit?: number;
  offset?: number;
}
export type AssetEntryQueryResponse = AssetEntry[];

// ── assetEntry:copy / move / rename / delete ─────────────────
export interface AssetEntryCopyRequest {
  entryIds: string[];
  targetFolderId: string | null;
}
export type AssetEntryCopyResponse = AssetEntry[];

export interface AssetEntryMoveRequest {
  entryIds: string[];
  folderId: string | null;
}
export interface AssetEntryMoveResponse {
  movedEntryIds: string[];
}

export interface AssetEntryRenameRequest {
  entryId: string;
  displayName: string;
}
export type AssetEntryRenameResponse = AssetEntry;

export interface AssetEntryDeleteRequest {
  entryIds: string[];
}
export interface AssetEntryDeleteResponse {
  deletedEntryIds: string[];
}

// ── assetContent:getPath / export ────────────────────────────
export interface AssetContentGetPathRequest {
  hash: string;
  type: AssetType;
  ext: string;
}
export type AssetContentGetPathResponse = string;

export interface AssetContentInspectRequest {
  hash: string;
}
export type AssetContentInspectResponse = AssetMeta;

export interface AssetContentExportRequest {
  hash: string;
  type: AssetType;
  format: string;
  name?: string;
}
export type AssetContentExportResponse = { success: true; path: string } | null;

// ── storage:getOverview ──────────────────────────────────────
export type StorageGetOverviewRequest = Record<string, never>;
export type StorageGetOverviewResponse = unknown;

// ── storage:openFolder ───────────────────────────────────────
export interface StorageOpenFolderRequest {
  path: string;
}
export type StorageOpenFolderResponse = void;

// storage:openPath
export interface StorageOpenPathRequest {
  path: string;
}
export type StorageOpenPathResponse = void;

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
