/**
 * asset + storage channels — Batch 4.
 *
 * Covers the Asset entry/content and storage invoke channels registered in
 * `apps/desktop-main/src/ipc/handlers/asset.handlers.ts` and
 * `storage.handlers.ts`.
 *
 * Entry creation and queries return the canonical joined AssetEntry DTO.
 * Picker and export cancellation paths are explicitly nullable.
 */
import { z } from 'zod';
import { defineInvokeChannel } from '../../channels.js';
import { AssetEntrySchema, AssetMetaSchema } from '../../dto/asset.js';

// ── Shared primitives ────────────────────────────────────────
const AssetType = z.enum(['image', 'video', 'audio']);
// ── assetEntry:import ────────────────────────────────────────
const AssetEntryImportRequest = z.object({
  filePath: z.string().min(1),
  type: AssetType,
});
const AssetEntryImportResponse = AssetEntrySchema;
export const assetEntryImportChannel = defineInvokeChannel({
  channel: 'assetEntry:import',
  request: AssetEntryImportRequest,
  response: AssetEntryImportResponse,
});
export type AssetEntryImportRequest = z.infer<typeof AssetEntryImportRequest>;
export type AssetEntryImportResponse = z.infer<typeof AssetEntryImportResponse>;

// ── assetEntry:importBuffer ──────────────────────────────────
const AssetEntryImportBufferRequest = z.object({
  buffer: z.unknown(),
  fileName: z.string().min(1),
  type: AssetType,
});
const AssetEntryImportBufferResponse = AssetEntrySchema;
export const assetEntryImportBufferChannel = defineInvokeChannel({
  channel: 'assetEntry:importBuffer',
  request: AssetEntryImportBufferRequest,
  response: AssetEntryImportBufferResponse,
});
export type AssetEntryImportBufferRequest = z.infer<typeof AssetEntryImportBufferRequest>;
export type AssetEntryImportBufferResponse = z.infer<typeof AssetEntryImportBufferResponse>;

// ── assetEntry:pickFile ──────────────────────────────────────
const AssetEntryPickFileRequest = z.object({ type: AssetType });
const AssetEntryPickFileResponse = AssetEntrySchema.nullable();
export const assetEntryPickFileChannel = defineInvokeChannel({
  channel: 'assetEntry:pickFile',
  request: AssetEntryPickFileRequest,
  response: AssetEntryPickFileResponse,
});
export type AssetEntryPickFileRequest = z.infer<typeof AssetEntryPickFileRequest>;
export type AssetEntryPickFileResponse = z.infer<typeof AssetEntryPickFileResponse>;

// ── assetEntry:query ─────────────────────────────────────────
const AssetEntryQueryRequest = z
  .object({
    type: z.string().optional(),
    tags: z.array(z.string()).optional(),
    search: z.string().optional(),
    limit: z.number().optional(),
    offset: z.number().optional(),
  })
  .strict();
const AssetEntryQueryResponse = z.array(AssetEntrySchema);
export const assetEntryQueryChannel = defineInvokeChannel({
  channel: 'assetEntry:query',
  request: AssetEntryQueryRequest,
  response: AssetEntryQueryResponse,
});
export type AssetEntryQueryRequest = z.infer<typeof AssetEntryQueryRequest>;
export type AssetEntryQueryResponse = z.infer<typeof AssetEntryQueryResponse>;

// ── assetEntry:copy / move / rename / delete ─────────────────
const AssetEntryCopyRequest = z
  .object({
    entryIds: z.array(z.string().trim().min(1)).min(1),
    targetFolderId: z.string().trim().min(1).nullable(),
  })
  .strict();
const AssetEntryCopyResponse = z.array(AssetEntrySchema);
export const assetEntryCopyChannel = defineInvokeChannel({
  channel: 'assetEntry:copy',
  request: AssetEntryCopyRequest,
  response: AssetEntryCopyResponse,
});
export type AssetEntryCopyRequest = z.infer<typeof AssetEntryCopyRequest>;
export type AssetEntryCopyResponse = z.infer<typeof AssetEntryCopyResponse>;

const AssetEntryMoveRequest = z
  .object({
    entryIds: z.array(z.string().trim().min(1)).min(1),
    folderId: z.string().trim().min(1).nullable(),
  })
  .strict();
const AssetEntryMoveResponse = z.object({ movedEntryIds: z.array(z.string()) }).strict();
export const assetEntryMoveChannel = defineInvokeChannel({
  channel: 'assetEntry:move',
  request: AssetEntryMoveRequest,
  response: AssetEntryMoveResponse,
});
export type AssetEntryMoveRequest = z.infer<typeof AssetEntryMoveRequest>;
export type AssetEntryMoveResponse = z.infer<typeof AssetEntryMoveResponse>;

const AssetEntryRenameRequest = z
  .object({
    entryId: z.string().trim().min(1),
    displayName: z.string().trim().min(1).max(255),
  })
  .strict();
export const assetEntryRenameChannel = defineInvokeChannel({
  channel: 'assetEntry:rename',
  request: AssetEntryRenameRequest,
  response: AssetEntrySchema,
});
export type AssetEntryRenameRequest = z.infer<typeof AssetEntryRenameRequest>;
export type AssetEntryRenameResponse = z.infer<typeof AssetEntrySchema>;

const AssetEntryDeleteRequest = z
  .object({ entryIds: z.array(z.string().trim().min(1)).min(1) })
  .strict();
const AssetEntryDeleteResponse = z.object({ deletedEntryIds: z.array(z.string()) }).strict();
export const assetEntryDeleteChannel = defineInvokeChannel({
  channel: 'assetEntry:delete',
  request: AssetEntryDeleteRequest,
  response: AssetEntryDeleteResponse,
});
export type AssetEntryDeleteRequest = z.infer<typeof AssetEntryDeleteRequest>;
export type AssetEntryDeleteResponse = z.infer<typeof AssetEntryDeleteResponse>;

// ── assetContent:getPath ─────────────────────────────────────
const AssetContentGetPathRequest = z.object({
  hash: z.string().min(1),
  type: AssetType,
  ext: z.string(),
});
const AssetContentGetPathResponse = z.string();
export const assetContentGetPathChannel = defineInvokeChannel({
  channel: 'assetContent:getPath',
  request: AssetContentGetPathRequest,
  response: AssetContentGetPathResponse,
});
export type AssetContentGetPathRequest = z.infer<typeof AssetContentGetPathRequest>;
export type AssetContentGetPathResponse = z.infer<typeof AssetContentGetPathResponse>;

// ── assetContent:inspect ─────────────────────────────────────
const AssetContentInspectRequest = z.object({ hash: z.string().min(1) }).strict();
export const assetContentInspectChannel = defineInvokeChannel({
  channel: 'assetContent:inspect',
  request: AssetContentInspectRequest,
  response: AssetMetaSchema,
});
export type AssetContentInspectRequest = z.infer<typeof AssetContentInspectRequest>;
export type AssetContentInspectResponse = z.infer<typeof AssetMetaSchema>;

// ── assetContent:export ──────────────────────────────────────
const AssetContentExportRequest = z.object({
  hash: z.string().min(1),
  type: AssetType,
  format: z.string(),
  name: z.string().optional(),
});
const AssetContentExportResponse = z
  .object({ success: z.literal(true), path: z.string() })
  .nullable();
export const assetContentExportChannel = defineInvokeChannel({
  channel: 'assetContent:export',
  request: AssetContentExportRequest,
  response: AssetContentExportResponse,
});
export type AssetContentExportRequest = z.infer<typeof AssetContentExportRequest>;
export type AssetContentExportResponse = z.infer<typeof AssetContentExportResponse>;

// ── storage:getOverview ──────────────────────────────────────
// Response is a large summary object; kept as `z.unknown()` per precedent.
const StorageGetOverviewRequest = z.object({}).strict();
const StorageGetOverviewResponse = z.unknown();
export const storageGetOverviewChannel = defineInvokeChannel({
  channel: 'storage:getOverview',
  request: StorageGetOverviewRequest,
  response: StorageGetOverviewResponse,
});
export type StorageGetOverviewRequest = z.infer<typeof StorageGetOverviewRequest>;
export type StorageGetOverviewResponse = z.infer<typeof StorageGetOverviewResponse>;

// ── storage:openFolder ───────────────────────────────────────
const StorageOpenFolderRequest = z.object({ path: z.string() });
const StorageOpenFolderResponse = z.void();
export const storageOpenFolderChannel = defineInvokeChannel({
  channel: 'storage:openFolder',
  request: StorageOpenFolderRequest,
  response: StorageOpenFolderResponse,
});
export type StorageOpenFolderRequest = z.infer<typeof StorageOpenFolderRequest>;
export type StorageOpenFolderResponse = z.infer<typeof StorageOpenFolderResponse>;

// storage:openPath
const StorageOpenPathRequest = z.object({ path: z.string() });
const StorageOpenPathResponse = z.void();
export const storageOpenPathChannel = defineInvokeChannel({
  channel: 'storage:openPath',
  request: StorageOpenPathRequest,
  response: StorageOpenPathResponse,
});
export type StorageOpenPathRequest = z.infer<typeof StorageOpenPathRequest>;
export type StorageOpenPathResponse = z.infer<typeof StorageOpenPathResponse>;

// ── storage:showInFolder ─────────────────────────────────────
const StorageShowInFolderRequest = z.object({ path: z.string() });
const StorageShowInFolderResponse = z.void();
export const storageShowInFolderChannel = defineInvokeChannel({
  channel: 'storage:showInFolder',
  request: StorageShowInFolderRequest,
  response: StorageShowInFolderResponse,
});
export type StorageShowInFolderRequest = z.infer<typeof StorageShowInFolderRequest>;
export type StorageShowInFolderResponse = z.infer<typeof StorageShowInFolderResponse>;

// ── storage:clearLogs ────────────────────────────────────────
const StorageClearLogsRequest = z.object({}).strict();
const StorageClearLogsResponse = z.object({ cleared: z.number() });
export const storageClearLogsChannel = defineInvokeChannel({
  channel: 'storage:clearLogs',
  request: StorageClearLogsRequest,
  response: StorageClearLogsResponse,
});
export type StorageClearLogsRequest = z.infer<typeof StorageClearLogsRequest>;
export type StorageClearLogsResponse = z.infer<typeof StorageClearLogsResponse>;

// ── storage:vacuumDatabase ───────────────────────────────────
const StorageVacuumDatabaseRequest = z.object({}).strict();
const StorageVacuumDatabaseResponse = z.object({
  success: z.boolean(),
  error: z.string().optional(),
});
export const storageVacuumDatabaseChannel = defineInvokeChannel({
  channel: 'storage:vacuumDatabase',
  request: StorageVacuumDatabaseRequest,
  response: StorageVacuumDatabaseResponse,
});
export type StorageVacuumDatabaseRequest = z.infer<typeof StorageVacuumDatabaseRequest>;
export type StorageVacuumDatabaseResponse = z.infer<typeof StorageVacuumDatabaseResponse>;

// ── storage:backupDatabase ───────────────────────────────────
const StorageBackupDatabaseRequest = z.object({ destPath: z.string().min(1) });
const StorageBackupDatabaseResponse = z.object({
  success: z.boolean(),
  error: z.string().optional(),
});
export const storageBackupDatabaseChannel = defineInvokeChannel({
  channel: 'storage:backupDatabase',
  request: StorageBackupDatabaseRequest,
  response: StorageBackupDatabaseResponse,
});
export type StorageBackupDatabaseRequest = z.infer<typeof StorageBackupDatabaseRequest>;
export type StorageBackupDatabaseResponse = z.infer<typeof StorageBackupDatabaseResponse>;

// ── storage:restoreDatabase ──────────────────────────────────
const StorageRestoreDatabaseRequest = z.object({ sourcePath: z.string().min(1) });
const StorageRestoreDatabaseResponse = z.object({
  success: z.boolean(),
  backupCreated: z.string().optional(),
  error: z.string().optional(),
});
export const storageRestoreDatabaseChannel = defineInvokeChannel({
  channel: 'storage:restoreDatabase',
  request: StorageRestoreDatabaseRequest,
  response: StorageRestoreDatabaseResponse,
});
export type StorageRestoreDatabaseRequest = z.infer<typeof StorageRestoreDatabaseRequest>;
export type StorageRestoreDatabaseResponse = z.infer<typeof StorageRestoreDatabaseResponse>;

// ── storage:pickFolder ───────────────────────────────────────
const StoragePickFolderRequest = z.object({}).strict();
const StoragePickFolderResponse = z.string().nullable();
export const storagePickFolderChannel = defineInvokeChannel({
  channel: 'storage:pickFolder',
  request: StoragePickFolderRequest,
  response: StoragePickFolderResponse,
});
export type StoragePickFolderRequest = z.infer<typeof StoragePickFolderRequest>;
export type StoragePickFolderResponse = z.infer<typeof StoragePickFolderResponse>;

// ── storage:pickSaveFile ─────────────────────────────────────
const StoragePickSaveFileRequest = z.object({ defaultName: z.string() });
const StoragePickSaveFileResponse = z.string().nullable();
export const storagePickSaveFileChannel = defineInvokeChannel({
  channel: 'storage:pickSaveFile',
  request: StoragePickSaveFileRequest,
  response: StoragePickSaveFileResponse,
});
export type StoragePickSaveFileRequest = z.infer<typeof StoragePickSaveFileRequest>;
export type StoragePickSaveFileResponse = z.infer<typeof StoragePickSaveFileResponse>;

// ── storage:pickOpenFile ─────────────────────────────────────
const StoragePickOpenFileRequest = z.object({
  extensions: z.array(z.string()),
});
const StoragePickOpenFileResponse = z.string().nullable();
export const storagePickOpenFileChannel = defineInvokeChannel({
  channel: 'storage:pickOpenFile',
  request: StoragePickOpenFileRequest,
  response: StoragePickOpenFileResponse,
});
export type StoragePickOpenFileRequest = z.infer<typeof StoragePickOpenFileRequest>;
export type StoragePickOpenFileResponse = z.infer<typeof StoragePickOpenFileResponse>;

export const assetEntryChannels = [
  assetEntryImportChannel,
  assetEntryImportBufferChannel,
  assetEntryPickFileChannel,
  assetEntryQueryChannel,
  assetEntryCopyChannel,
  assetEntryMoveChannel,
  assetEntryRenameChannel,
  assetEntryDeleteChannel,
] as const;

export const assetContentChannels = [
  assetContentGetPathChannel,
  assetContentInspectChannel,
  assetContentExportChannel,
] as const;

export const storageChannels = [
  storageGetOverviewChannel,
  storageOpenFolderChannel,
  storageOpenPathChannel,
  storageShowInFolderChannel,
  storageClearLogsChannel,
  storageVacuumDatabaseChannel,
  storageBackupDatabaseChannel,
  storageRestoreDatabaseChannel,
  storagePickFolderChannel,
  storagePickSaveFileChannel,
  storagePickOpenFileChannel,
] as const;
