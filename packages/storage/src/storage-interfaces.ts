import type {
  ScriptDocument,
  ColorStyle,
} from '@lucid-fin/contracts';

import type { SessionRepository } from './repositories/session-repository.js';
import type { JobRepository } from './repositories/job-repository.js';
import type { AssetRepository } from './repositories/asset-repository.js';
import type { CanvasRepository } from './repositories/canvas-repository.js';
import type { EntityRepository } from './repositories/entity-repository.js';
import type { SeriesRepository } from './repositories/series-repository.js';
import type { PresetRepository } from './repositories/preset-repository.js';
import type { ShotTemplateRepository } from './repositories/shot-template-repository.js';
import type { SnapshotRepository } from './repositories/snapshot-repository.js';
import type { WorkflowRepository } from './repositories/workflow-repository.js';

/**
 * Repository bundle exposed by `SqliteIndex.repos`. Represents the strangler
 * surface during G1-4.x: consumers migrate from `db.xxx()` facade methods to
 * `db.repos.xxx.yyy()` direct-to-repository calls.
 */
export interface RepoBundle {
  sessions: SessionRepository;
  jobs: JobRepository;
  assets: AssetRepository;
  canvases: CanvasRepository;
  entities: EntityRepository;
  series: SeriesRepository;
  presets: PresetRepository;
  shotTemplates: ShotTemplateRepository;
  snapshots: SnapshotRepository;
  workflows: WorkflowRepository;
}

// ---------------------------------------------------------------------------
// Domain store interfaces
// ---------------------------------------------------------------------------

/** Asset storage operations — migrated to SqliteIndex.repos.assets (G1-4.8).
 *  Interface kept as an empty marker for callers that still reference the
 *  type alias; can be deleted in a later cleanup. */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface IAssetStore {}

/** Embedding / semantic search operations — migrated to SqliteIndex.repos.assets
 *  (G1-4.8). Interface kept as an empty marker for callers that still reference
 *  the type alias; can be deleted in a later cleanup. */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface IEmbeddingStore {}

/** Job queue persistence — migrated to SqliteIndex.repos.jobs (G1-4.5).
 *  `JobQueue` now takes `JobRepository` directly. Interface kept as an empty
 *  marker for callers that still reference the type alias; can be deleted in
 *  a later cleanup. */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface IJobStore {}

/** Canvas persistence — migrated to SqliteIndex.repos.canvases (G1-4.6).
 *  Interface kept as an empty marker for callers that still reference the
 *  type alias; can be deleted in a later cleanup. */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface ICanvasStore {}

/** Entity CRUD — scripts, color styles, dependencies.
 *  Characters / equipment / locations migrated to SqliteIndex.repos.entities
 *  (G1-4.7); those methods no longer live on this interface. */
export interface IEntityStore {
  // Scripts
  upsertScript(doc: ScriptDocument): void;
  getScript(): ScriptDocument | null;
  deleteScript(id: string): void;

  // Color Styles
  upsertColorStyle(cs: ColorStyle): void;
  listColorStyles(): ColorStyle[];
  deleteColorStyle(id: string): void;

  // Dependencies
  addDependency(sourceType: string, sourceId: string, targetType: string, targetId: string): void;
  getDependents(sourceType: string, sourceId: string): Array<{ targetType: string; targetId: string }>;
}

/** Series and episodes — migrated to SqliteIndex.repos.series (G1-4.4).
 *  Interface kept as an empty marker for callers that still reference the
 *  type alias; can be deleted in a later cleanup. */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface ISeriesStore {}

/** Preset overrides and custom shot templates */
/** Preset overrides and custom shot templates — migrated to
 *  SqliteIndex.repos.presets / SqliteIndex.repos.shotTemplates (G1-4.3).
 *  Interface kept as an empty marker for callers that still reference the
 *  type alias; can be deleted in a later cleanup. */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface IPresetStore {}

/** Commander sessions — migrated to SqliteIndex.repos.sessions (G1-4.2).
 *  Interface kept as an empty marker for callers that still reference the
 *  type alias; can be deleted in a later cleanup. */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface ISessionStore {}

/** Snapshots (capture / restore) — migrated to SqliteIndex.repos.snapshots
 *  (G1-4.2). Interface kept as an empty marker for callers that still
 *  reference the type alias; can be deleted in a later cleanup. */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface ISnapshotStore {}

/** Workflow persistence — migrated to SqliteIndex.repos.workflows (G1-4.9).
 *  Interface kept as an empty marker for callers that still reference the
 *  type alias; can be deleted in a later cleanup. */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface IWorkflowStore {}

// ---------------------------------------------------------------------------
// Composite interface
// ---------------------------------------------------------------------------

/** Complete storage layer -- union of all domain stores */
export interface IStorageLayer extends
  IEntityStore,
  ISeriesStore,
  IPresetStore,
  IWorkflowStore {
  /** Repository bundle (strangler surface — G1-4.x). */
  readonly repos: RepoBundle;
  /** Close the database connection */
  close(): void;
  /** Run integrity check -- throws if DB is corrupted */
  healthCheck(): void;
  /** Attempt to repair by exporting to SQL and reimporting into a fresh DB */
  repair(): void;
  /** Vacuum the database */
  vacuum(): void;
}
