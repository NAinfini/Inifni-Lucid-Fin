/**
 * asset + storage channels — Batch 4.
 *
 * Covers the 8 asset:* and 13 storage:* invoke channels registered in
 * `apps/desktop-main/src/ipc/handlers/asset.handlers.ts` and
 * `storage.handlers.ts`.
 *
 * Complex DTO payloads (AssetRef, AssetMeta) and the storage:getOverview
 * summary object stay as `z.unknown()` at this stage — Phase C will
 * zodify the DTOs once they move out of `packages/contracts/src/dto/`.
 *
 * `asset:import`, `asset:importBuffer`, and `asset:pickFile` can return
 * `null` when the user cancels the picker; modelled as `.nullable()`.
 * `asset:exportBatch` also has a cancel path returning `null`.
 */
import { z } from 'zod';
import { defineInvokeChannel } from '../../channels.js';

// ── Shared primitives ────────────────────────────────────────
const AssetType = z.enum(['image', 'video', 'audio']);
const AssetRefShape = z.unknown();
const AssetMetaShape = z.unknown();

// ── asset:import ─────────────────────────────────────────────
const AssetImportRequest = z.object({
  filePath: z.string().min(1),
  type: AssetType,
});
const AssetImportResponse = AssetRefShape;
export const assetImportChannel = defineInvokeChannel({
  channel: 'asset:import',
  request: AssetImportRequest,
  response: AssetImportResponse,
});
export type AssetImportRequest = z.infer<typeof AssetImportRequest>;
export type AssetImportResponse = z.infer<typeof AssetImportResponse>;

// ── asset:importBuffer ───────────────────────────────────────
const AssetImportBufferRequest = z.object({
  buffer: z.unknown(),
  fileName: z.string().min(1),
  type: AssetType,
});
const AssetImportBufferResponse = AssetRefShape;
export const assetImportBufferChannel = defineInvokeChannel({
  channel: 'asset:importBuffer',
  request: AssetImportBufferRequest,
  response: AssetImportBufferResponse,
});
export type AssetImportBufferRequest = z.infer<typeof AssetImportBufferRequest>;
export type AssetImportBufferResponse = z.infer<typeof AssetImportBufferResponse>;

// ── asset:pickFile ───────────────────────────────────────────
const AssetPickFileRequest = z.object({ type: AssetType });
const AssetPickFileResponse = AssetRefShape.nullable();
export const assetPickFileChannel = defineInvokeChannel({
  channel: 'asset:pickFile',
  request: AssetPickFileRequest,
  response: AssetPickFileResponse,
});
export type AssetPickFileRequest = z.infer<typeof AssetPickFileRequest>;
export type AssetPickFileResponse = z.infer<typeof AssetPickFileResponse>;

// ── asset:query ──────────────────────────────────────────────
const AssetQueryRequest = z
  .object({
    type: z.string().optional(),
    tags: z.array(z.string()).optional(),
    search: z.string().optional(),
    limit: z.number().optional(),
    offset: z.number().optional(),
  })
  .strict();
const AssetQueryResponse = z.array(AssetMetaShape);
export const assetQueryChannel = defineInvokeChannel({
  channel: 'asset:query',
  request: AssetQueryRequest,
  response: AssetQueryResponse,
});
export type AssetQueryRequest = z.infer<typeof AssetQueryRequest>;
export type AssetQueryResponse = z.infer<typeof AssetQueryResponse>;

// ── asset:getPath ────────────────────────────────────────────
const AssetGetPathRequest = z.object({
  hash: z.string().min(1),
  type: AssetType,
  ext: z.string(),
});
const AssetGetPathResponse = z.string();
export const assetGetPathChannel = defineInvokeChannel({
  channel: 'asset:getPath',
  request: AssetGetPathRequest,
  response: AssetGetPathResponse,
});
export type AssetGetPathRequest = z.infer<typeof AssetGetPathRequest>;
export type AssetGetPathResponse = z.infer<typeof AssetGetPathResponse>;

// ── asset:delete ─────────────────────────────────────────────
const AssetDeleteRequest = z.object({ hash: z.string().min(1) });
const AssetDeleteResponse = z.object({ success: z.boolean() });
export const assetDeleteChannel = defineInvokeChannel({
  channel: 'asset:delete',
  request: AssetDeleteRequest,
  response: AssetDeleteResponse,
});
export type AssetDeleteRequest = z.infer<typeof AssetDeleteRequest>;
export type AssetDeleteResponse = z.infer<typeof AssetDeleteResponse>;

// ── asset:export ─────────────────────────────────────────────
const AssetExportRequest = z.object({
  hash: z.string().min(1),
  type: AssetType,
  format: z.string(),
  name: z.string().optional(),
});
const AssetExportResponse = z.object({ success: z.literal(true), path: z.string() }).nullable();
export const assetExportChannel = defineInvokeChannel({
  channel: 'asset:export',
  request: AssetExportRequest,
  response: AssetExportResponse,
});
export type AssetExportRequest = z.infer<typeof AssetExportRequest>;
export type AssetExportResponse = z.infer<typeof AssetExportResponse>;

// ── asset:exportBatch ────────────────────────────────────────
const AssetExportBatchRequest = z.object({
  items: z
    .array(
      z.object({
        hash: z.string().min(1),
        type: AssetType,
        name: z.string().optional(),
      }),
    )
    .min(1),
});
const AssetExportBatchResponse = z
  .object({
    success: z.literal(true),
    count: z.number(),
    directory: z.string(),
  })
  .nullable();
export const assetExportBatchChannel = defineInvokeChannel({
  channel: 'asset:exportBatch',
  request: AssetExportBatchRequest,
  response: AssetExportBatchResponse,
});
export type AssetExportBatchRequest = z.infer<typeof AssetExportBatchRequest>;
export type AssetExportBatchResponse = z.infer<typeof AssetExportBatchResponse>;

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

// ── storage:clearEmbeddings ──────────────────────────────────
const StorageClearEmbeddingsRequest = z.object({}).strict();
const StorageClearEmbeddingsResponse = z.object({
  success: z.boolean(),
  error: z.string().optional(),
});
export const storageClearEmbeddingsChannel = defineInvokeChannel({
  channel: 'storage:clearEmbeddings',
  request: StorageClearEmbeddingsRequest,
  response: StorageClearEmbeddingsResponse,
});
export type StorageClearEmbeddingsRequest = z.infer<typeof StorageClearEmbeddingsRequest>;
export type StorageClearEmbeddingsResponse = z.infer<typeof StorageClearEmbeddingsResponse>;

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

export const assetChannels = [
  assetImportChannel,
  assetImportBufferChannel,
  assetPickFileChannel,
  assetQueryChannel,
  assetGetPathChannel,
  assetDeleteChannel,
  assetExportChannel,
  assetExportBatchChannel,
] as const;

export const storageChannels = [
  storageGetOverviewChannel,
  storageOpenFolderChannel,
  storageShowInFolderChannel,
  storageClearLogsChannel,
  storageClearEmbeddingsChannel,
  storageVacuumDatabaseChannel,
  storageBackupDatabaseChannel,
  storageRestoreDatabaseChannel,
  storagePickFolderChannel,
  storagePickSaveFileChannel,
  storagePickOpenFileChannel,
] as const;
