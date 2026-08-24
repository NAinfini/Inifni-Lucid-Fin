export { CAS } from './cas.js';
export {
  ensureExpectedMediaType,
  inspectBufferMedia,
  inspectFileMedia,
} from './media-inspector.js';
export { SqliteIndex } from './sqlite-index.js';
export type { IStorageLayer, RepoBundle } from './storage-interfaces.js';
export { Keychain } from './keychain.js';
export type { KeychainOptions } from './keychain.js';
export { PromptStore } from './prompt-store.js';
export type { PromptRecord } from './prompt-store.js';
export { ProcessPromptStore, PROCESS_PROMPT_DEFAULTS } from './process-prompt-store.js';
export type { ProcessPromptRecord, ProcessPromptDefault } from './process-prompt-store.js';
export type {
  StoredSession,
  StoredSnapshot,
  SnapshotData,
} from './repositories/snapshot-repository.js';
export { withTx } from './transactions.js';
export type { Tx } from './transactions.js';

// Session persistence
export { SessionRepository } from './repositories/session-repository.js';
export type {
  StoredSession as RepoStoredSession,
  ListResult as RepoListResult,
} from './repositories/session-repository.js';

// Commander run and event persistence
export { CommanderRunRepository } from './repositories/commander-run-repository.js';
export type {
  CommanderRunStatus,
  CommanderRunAppendEvent,
  StoredCommanderRun,
  StoredCommanderRunEvent,
  StoredCommanderRunRecoveryEvent,
} from './repositories/commander-run-repository.js';

// Process prompt persistence
export { ProcessPromptRepository } from './repositories/process-prompt-repository.js';
export type { ProcessPromptRecord as RepoProcessPromptRecord } from './repositories/process-prompt-repository.js';

// Media persistence
export { AssetRepository } from './repositories/asset-repository.js';

// Canvas persistence
export { CanvasRepository } from './repositories/canvas-repository.js';
export { CanvasNodeRepository } from './repositories/canvas-node-repository.js';
export { CanvasEdgeRepository } from './repositories/canvas-edge-repository.js';
export type { CanvasSummary } from './repositories/canvas-repository.js';

// Production entity persistence
export { EntityRepository } from './repositories/entity-repository.js';
export type {
  CharacterUpsertInput,
  EquipmentUpsertInput,
  LocationUpsertInput,
} from './repositories/entity-repository.js';

// Folder persistence
export {
  FolderRepository,
  FolderCycleError,
  FolderNotFoundError,
} from './repositories/folder-repository.js';

// Preset persistence
export { PresetRepository } from './repositories/preset-repository.js';
export type {
  PresetOverrideRecord,
  PresetOverrideUpsertInput,
} from './repositories/preset-repository.js';

// Shot template persistence
export { ShotTemplateRepository } from './repositories/shot-template-repository.js';

// Snapshot persistence
export { SnapshotRepository } from './repositories/snapshot-repository.js';

// ── Durable task execution ─────────────────────────────────────
export { TaskListRepository } from './repositories/task-list-repository.js';
export type { TaskListLease } from './repositories/task-list-repository.js';

// Script, color style, and dependency persistence
export { ScriptRepository } from './repositories/script-repository.js';
export { ColorStyleRepository } from './repositories/color-style-repository.js';
export { DependencyRepository } from './repositories/dependency-repository.js';
export type { Dependent } from './repositories/dependency-repository.js';

// ── Project settings KV store ─────────────────────────────────
export { ProjectSettingsRepository } from './repositories/project-settings-repository.js';

// ── Durable Commander prompt assemblies ────────────────────────
export { PromptAssemblyRepository } from './repositories/prompt-assembly-repository.js';
export type {
  AssemblePromptAssemblyInput,
  PromptAssemblyTransitionInput,
  FailPromptAssemblyInput,
  CancelPromptAssemblyInput,
} from './repositories/prompt-assembly-repository.js';

// Backup and restore helpers
export { createBackup, listBackups, restoreBackup, purgeAllBackups } from './backup.js';
export type { BackupManifestEntry, BackupManifest, BackupResult, BackupFailure } from './backup.js';

export {
  assertCanonicalSchema,
  CanonicalSchemaError,
  getCanonicalSchemaDifferences,
} from './schema-validation.js';

// ── Soft-delete GC ─────────────────────────────────────────────
export { purgeSoftDeleted } from './gc.js';
export type { GcResult } from './gc.js';
