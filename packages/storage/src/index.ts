export { CAS } from './cas.js';
export {
  ensureExpectedMediaType,
  inspectBufferMedia,
  inspectFileMedia,
} from './media-inspector.js';
export { SqliteIndex } from './sqlite-index.js';
export type {
  IStorageLayer,
  RepoBundle,
} from './storage-interfaces.js';
export { Keychain } from './keychain.js';
export type { KeychainOptions } from './keychain.js';
export { PromptStore } from './prompt-store.js';
export type { PromptRecord } from './prompt-store.js';
export { ProcessPromptStore, PROCESS_PROMPT_DEFAULTS } from './process-prompt-store.js';
export type { ProcessPromptRecord, ProcessPromptDefault } from './process-prompt-store.js';
export type { StoredSession, StoredSnapshot, SnapshotData } from './repositories/snapshot-repository.js';
export { withTx } from './transactions.js';
export type { Tx } from './transactions.js';

// ── Phase G1-2.1: SessionRepository ────────────────────────────
export { SessionRepository } from './repositories/session-repository.js';
export type {
  StoredSession as RepoStoredSession,
  ListResult as RepoListResult,
} from './repositories/session-repository.js';

// ── v2cut Phase 5: CommanderEventRepository ────────────────────
export { CommanderEventRepository } from './repositories/commander-event-repository.js';
export type { StoredCommanderEvent } from './repositories/commander-event-repository.js';

// ── Phase G1-2.2: ProcessPromptRepository ──────────────────────
export { ProcessPromptRepository } from './repositories/process-prompt-repository.js';
export type {
  ProcessPromptRecord as RepoProcessPromptRecord,
} from './repositories/process-prompt-repository.js';

// ── Phase G1-2.3: JobRepository ────────────────────────────────
export { JobRepository } from './repositories/job-repository.js';
export type { JobUpdates } from './repositories/job-repository.js';

// ── Phase G1-2.4: AssetRepository ──────────────────────────────
export { AssetRepository } from './repositories/asset-repository.js';

// ── Phase G1-2.5: CanvasRepository ─────────────────────────────
export { CanvasRepository } from './repositories/canvas-repository.js';
export type { CanvasSummary } from './repositories/canvas-repository.js';

// ── Phase G1-2.6: EntityRepository ─────────────────────────────
export { EntityRepository } from './repositories/entity-repository.js';
export type {
  CharacterUpsertInput,
  EquipmentUpsertInput,
  LocationUpsertInput,
} from './repositories/entity-repository.js';

// ── Folder feature (04-18): FolderRepository ───────────────────
export {
  FolderRepository,
  FolderCycleError,
  FolderNotFoundError,
} from './repositories/folder-repository.js';

// ── Phase G1-2.7: SeriesRepository ─────────────────────────────
export { SeriesRepository } from './repositories/series-repository.js';
export type {
  EpisodeRecord,
  EpisodeUpsertInput,
} from './repositories/series-repository.js';

// ── Phase G1-2.8: PresetRepository ─────────────────────────────
export { PresetRepository } from './repositories/preset-repository.js';
export type {
  PresetOverrideRecord,
  PresetOverrideUpsertInput,
} from './repositories/preset-repository.js';

// ── Phase G1-2.9: ShotTemplateRepository ───────────────────────
export { ShotTemplateRepository } from './repositories/shot-template-repository.js';

// ── Phase G1-2.10: SnapshotRepository ──────────────────────────
export { SnapshotRepository } from './repositories/snapshot-repository.js';

// ── Phase G1-2.11: WorkflowRepository ──────────────────────────
export { WorkflowRepository } from './repositories/workflow-repository.js';

// ── Phase G1-4.10: Script / ColorStyle / Dependency repos ──────
export { ScriptRepository } from './repositories/script-repository.js';
export { ColorStyleRepository } from './repositories/color-style-repository.js';
export { DependencyRepository } from './repositories/dependency-repository.js';
export type { Dependent } from './repositories/dependency-repository.js';

// ── Project settings KV store ─────────────────────────────────
export { ProjectSettingsRepository } from './repositories/project-settings-repository.js';
