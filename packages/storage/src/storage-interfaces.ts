import type { SessionRepository } from './repositories/session-repository.js';
import type { CommanderRunRepository } from './repositories/commander-run-repository.js';
import type { AssetRepository } from './repositories/asset-repository.js';
import type { CanvasRepository } from './repositories/canvas-repository.js';
import type { CanvasNodeRepository } from './repositories/canvas-node-repository.js';
import type { CanvasEdgeRepository } from './repositories/canvas-edge-repository.js';
import type { EntityRepository } from './repositories/entity-repository.js';
import type { FolderRepository } from './repositories/folder-repository.js';
import type { PresetRepository } from './repositories/preset-repository.js';
import type { ShotTemplateRepository } from './repositories/shot-template-repository.js';
import type { SnapshotRepository } from './repositories/snapshot-repository.js';
import type { TaskListRepository } from './repositories/task-list-repository.js';
import type { ScriptRepository } from './repositories/script-repository.js';
import type { ColorStyleRepository } from './repositories/color-style-repository.js';
import type { DependencyRepository } from './repositories/dependency-repository.js';
import type { ProjectSettingsRepository } from './repositories/project-settings-repository.js';
import type { PromptAssemblyRepository } from './repositories/prompt-assembly-repository.js';

/**
 * Repository bundle exposed by `SqliteIndex.repos`. Every durable domain
 * lives behind its own repository.
 */
export interface RepoBundle {
  sessions: SessionRepository;
  commanderRuns: CommanderRunRepository;
  assets: AssetRepository;
  canvases: CanvasRepository;
  canvasNodes: CanvasNodeRepository;
  canvasEdges: CanvasEdgeRepository;
  entities: EntityRepository;
  folders: FolderRepository;
  presets: PresetRepository;
  shotTemplates: ShotTemplateRepository;
  snapshots: SnapshotRepository;
  taskLists: TaskListRepository;
  scripts: ScriptRepository;
  colorStyles: ColorStyleRepository;
  dependencies: DependencyRepository;
  projectSettings: ProjectSettingsRepository;
  promptAssemblies: PromptAssemblyRepository;
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
