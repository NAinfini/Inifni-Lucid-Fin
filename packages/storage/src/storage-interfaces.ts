import type {
  AssetMeta,
  Character,
  Equipment,
  Location,
  ScriptDocument,
  ColorStyle,
  WorkflowRun,
  WorkflowStageRun,
  WorkflowTaskRun,
  WorkflowArtifact,
  WorkflowTaskSummary,
} from '@lucid-fin/contracts';

import type { AssetMetaInput, EmbeddingRecord, SemanticSearchResult } from './sqlite-assets.js';
import type {
  upsertCharacter as _upsertCharacter,
  upsertEquipment as _upsertEquipment,
  upsertLocation as _upsertLocation,
} from './sqlite-entities.js';
import type {
  updateWorkflowRun as _updateWorkflowRun,
  updateWorkflowStageRun as _updateWorkflowStageRun,
  updateWorkflowTaskRun as _updateWorkflowTaskRun,
  listWorkflowTaskSummaries as _listWorkflowTaskSummaries,
} from './sqlite-workflows.js';

// ---------------------------------------------------------------------------
// Domain store interfaces
// ---------------------------------------------------------------------------

/** Asset storage operations */
export interface IAssetStore {
  insertAsset(meta: AssetMetaInput): void;
  deleteAsset(hash: string): void;
  queryAssets(filter: { type?: string; limit?: number; offset?: number }): AssetMeta[];
  searchAssets(query: string, limit?: number): AssetMeta[];
}

/** Embedding / semantic search operations */
export interface IEmbeddingStore {
  insertEmbedding(hash: string, description: string, tokens: string[], model: string): void;
  queryEmbeddingByHash(hash: string): EmbeddingRecord | undefined;
  searchByTokens(queryTokens: string[], limit: number): SemanticSearchResult[];
  getAllEmbeddedHashes(): string[];
  clearEmbeddings(): void;
}

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

/** Entity CRUD -- characters, equipment, locations, scripts, color styles, dependencies */
export interface IEntityStore {
  // Characters
  upsertCharacter(char: Parameters<typeof _upsertCharacter>[1]): void;
  getCharacter(id: string): Character | undefined;
  listCharacters(): Character[];
  deleteCharacter(id: string): void;

  // Equipment
  upsertEquipment(equip: Parameters<typeof _upsertEquipment>[1]): void;
  getEquipment(id: string): Equipment | undefined;
  listEquipment(type?: string): Equipment[];
  deleteEquipment(id: string): void;

  // Locations
  upsertLocation(loc: Parameters<typeof _upsertLocation>[1]): void;
  getLocation(id: string): Location | undefined;
  listLocations(type?: string): Location[];
  deleteLocation(id: string): void;

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

/** Workflow runs, stage runs, task runs, task dependencies, artifacts, summaries, aggregates */
export interface IWorkflowStore {
  // Workflow runs
  insertWorkflowRun(run: WorkflowRun): void;
  getWorkflowRun(id: string): WorkflowRun | undefined;
  listWorkflowRuns(filter?: { status?: string; workflowType?: string; entityType?: string }): WorkflowRun[];
  updateWorkflowRun(id: string, updates: Parameters<typeof _updateWorkflowRun>[2]): void;

  // Stage runs
  insertWorkflowStageRun(stageRun: WorkflowStageRun): void;
  listWorkflowStageRuns(workflowRunId: string): WorkflowStageRun[];
  getWorkflowStageRun(id: string): WorkflowStageRun | undefined;
  updateWorkflowStageRun(id: string, updates: Parameters<typeof _updateWorkflowStageRun>[2]): void;

  // Task runs
  insertWorkflowTaskRun(taskRun: WorkflowTaskRun): void;
  listWorkflowTaskRuns(workflowRunId: string): WorkflowTaskRun[];
  listWorkflowTaskRunsByStage(stageRunId: string): WorkflowTaskRun[];
  listReadyWorkflowTasks(workflowRunId?: string): WorkflowTaskRun[];
  listAwaitingProviderTasks(workflowRunId?: string): WorkflowTaskRun[];
  getWorkflowTaskRun(id: string): WorkflowTaskRun | undefined;
  updateWorkflowTaskRun(id: string, updates: Parameters<typeof _updateWorkflowTaskRun>[2]): void;

  // Task dependencies
  insertWorkflowTaskDependency(taskRunId: string, dependsOnTaskRunId: string): void;
  listTaskDependencies(taskRunId: string): string[];
  listTaskDependents(dependsOnTaskRunId: string): string[];

  // Artifacts
  insertWorkflowArtifact(artifact: WorkflowArtifact): void;
  listWorkflowArtifacts(workflowRunId: string): WorkflowArtifact[];
  listEntityArtifacts(entityType: string, entityId: string): WorkflowArtifact[];
  listWorkflowArtifactsByTaskRun(taskRunId: string): WorkflowArtifact[];

  // Task summaries & aggregation
  listWorkflowTaskSummaries(filter?: Parameters<typeof _listWorkflowTaskSummaries>[1]): WorkflowTaskSummary[];
  recomputeStageAggregate(stageRunId: string): void;
  recomputeWorkflowAggregate(workflowRunId: string): void;
}

// ---------------------------------------------------------------------------
// Composite interface
// ---------------------------------------------------------------------------

/** Complete storage layer -- union of all domain stores */
export interface IStorageLayer extends
  IAssetStore,
  IEmbeddingStore,
  IEntityStore,
  ISeriesStore,
  IPresetStore,
  IWorkflowStore {
  /** Close the database connection */
  close(): void;
  /** Run integrity check -- throws if DB is corrupted */
  healthCheck(): void;
  /** Attempt to repair by exporting to SQL and reimporting into a fresh DB */
  repair(): void;
  /** Vacuum the database */
  vacuum(): void;
}
