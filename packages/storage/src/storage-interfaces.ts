import type { SessionRepository } from './repositories/session-repository.js';
import type { CommanderEventRepository } from './repositories/commander-event-repository.js';
import type { JobRepository } from './repositories/job-repository.js';
import type { AssetRepository } from './repositories/asset-repository.js';
import type { CanvasRepository } from './repositories/canvas-repository.js';
import type { EntityRepository } from './repositories/entity-repository.js';
import type { FolderRepository } from './repositories/folder-repository.js';
import type { SeriesRepository } from './repositories/series-repository.js';
import type { PresetRepository } from './repositories/preset-repository.js';
import type { ShotTemplateRepository } from './repositories/shot-template-repository.js';
import type { SnapshotRepository } from './repositories/snapshot-repository.js';
import type { WorkflowRepository } from './repositories/workflow-repository.js';
import type { ScriptRepository } from './repositories/script-repository.js';
import type { ColorStyleRepository } from './repositories/color-style-repository.js';
import type { DependencyRepository } from './repositories/dependency-repository.js';

/**
 * Repository bundle exposed by `SqliteIndex.repos`. The strangler
 * migration (G1-4.x) finished with G1-4.10: every domain now lives
 * on its own repository; the flat `db.xxx()` facade is gone.
 */
export interface RepoBundle {
  sessions: SessionRepository;
  commanderEvents: CommanderEventRepository;
  jobs: JobRepository;
  assets: AssetRepository;
  canvases: CanvasRepository;
  entities: EntityRepository;
  folders: FolderRepository;
  series: SeriesRepository;
  presets: PresetRepository;
  shotTemplates: ShotTemplateRepository;
  snapshots: SnapshotRepository;
  workflows: WorkflowRepository;
  scripts: ScriptRepository;
  colorStyles: ColorStyleRepository;
  dependencies: DependencyRepository;
}

/**
 * Storage layer contract — everything a consumer needs to interact
 * with persisted state. Domain operations live behind `repos`;
 * lifecycle + integrity management stays on the top-level interface.
 */
export interface IStorageLayer {
  readonly repos: RepoBundle;
  close(): void;
  healthCheck(): void;
  repair(): void;
  vacuum(): void;
}
