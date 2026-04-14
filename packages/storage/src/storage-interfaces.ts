import type {
  AssetMeta,
  Canvas,
  Job,
  Character,
  Equipment,
  Location,
  Scene,
  ScriptDocument,
  ColorStyle,
  Series,
  ShotTemplate,
  WorkflowRun,
  WorkflowStageRun,
  WorkflowTaskRun,
  WorkflowArtifact,
  WorkflowTaskSummary,
} from '@lucid-fin/contracts';

import type { AssetMetaInput, EmbeddingRecord, SemanticSearchResult } from './sqlite-assets.js';
import type { StoredSession, StoredSnapshot } from './sqlite-snapshots.js';
import type {
  upsertCharacter as _upsertCharacter,
  upsertEquipment as _upsertEquipment,
  upsertLocation as _upsertLocation,
} from './sqlite-entities.js';
import type {
  upsertEpisode as _upsertEpisode,
  listEpisodes as _listEpisodes,
  upsertPresetOverride as _upsertPresetOverride,
  listPresetOverrides as _listPresetOverrides,
} from './sqlite-content.js';
import type {
  updateJob as _updateJob,
} from './sqlite-jobs.js';
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

/** Job queue persistence */
export interface IJobStore {
  insertJob(job: Job): void;
  updateJob(jobId: string, updates: Parameters<typeof _updateJob>[2]): void;
  getJob(jobId: string): Job | undefined;
  listJobs(filter?: { status?: string }): Job[];
}

/** Canvas persistence */
export interface ICanvasStore {
  upsertCanvas(canvas: Canvas): void;
  getCanvas(id: string): Canvas | undefined;
  listCanvases(): Array<{ id: string; name: string; updatedAt: number }>;
  listCanvasesFull(): Canvas[];
  deleteCanvas(id: string): void;
}

/** Entity CRUD -- characters, equipment, locations, scenes, scripts, color styles, dependencies */
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

  // Scenes
  upsertScene(scene: Scene): void;
  getScene(id: string): Scene | undefined;
  listScenes(): Scene[];
  deleteScene(id: string): void;

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

/** Series and episodes */
export interface ISeriesStore {
  upsertSeries(series: Series): void;
  getSeries(id: string): Series | undefined;
  deleteSeries(id: string): void;
  upsertEpisode(episode: Parameters<typeof _upsertEpisode>[1]): void;
  listEpisodes(seriesId: string): ReturnType<typeof _listEpisodes>;
  deleteEpisode(id: string): void;
}

/** Preset overrides and custom shot templates */
export interface IPresetStore {
  upsertPresetOverride(override: Parameters<typeof _upsertPresetOverride>[1]): void;
  listPresetOverrides(): ReturnType<typeof _listPresetOverrides>;
  deletePresetOverride(id: string): void;
  listCustomShotTemplates(): ShotTemplate[];
  upsertCustomShotTemplate(template: ShotTemplate): void;
  deleteCustomShotTemplate(templateId: string): void;
}

/** Commander sessions */
export interface ISessionStore {
  upsertSession(s: StoredSession): void;
  getSession(id: string): StoredSession | undefined;
  listSessions(limit?: number): StoredSession[];
  deleteSession(id: string): void;
}

/** Snapshots (capture / restore) */
export interface ISnapshotStore {
  insertSnapshot(s: StoredSnapshot): void;
  getSnapshot(id: string): StoredSnapshot | undefined;
  listSnapshots(sessionId: string): StoredSnapshot[];
  deleteSnapshot(id: string): void;
  pruneSnapshots(sessionId: string, maxKeep: number): void;
  pruneSnapshotsTiered(): void;
  captureSnapshot(sessionId: string, label: string, trigger: 'auto' | 'manual'): StoredSnapshot;
  restoreSnapshot(snapshotId: string): void;
}

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
  IJobStore,
  ICanvasStore,
  IEntityStore,
  ISeriesStore,
  IPresetStore,
  ISessionStore,
  ISnapshotStore,
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
