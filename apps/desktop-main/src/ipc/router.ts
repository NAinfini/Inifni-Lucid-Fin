import { ipcMain, type BrowserWindow } from 'electron';
import log from '../logger.js';
import type { SqliteIndex } from '@lucid-fin/storage';
import { ProjectFS, CAS, Keychain, type PromptStore } from '@lucid-fin/storage';
import type { AdapterRegistry, LLMRegistry } from '@lucid-fin/adapters-ai';
import type { JobQueue, WorkflowEngine, AgentOrchestrator } from '@lucid-fin/application';
import { registerProjectHandlers } from './handlers/project.handlers.js';
import { registerAssetHandlers } from './handlers/asset.handlers.js';
import { registerJobHandlers } from './handlers/job.handlers.js';
import { registerKeychainHandlers } from './handlers/keychain.handlers.js';
import { registerScriptHandlers } from './handlers/script.handlers.js';
import { registerSceneHandlers } from './handlers/scene.handlers.js';
import { registerCharacterHandlers } from './handlers/character.handlers.js';
import { registerEquipmentHandlers } from './handlers/equipment.handlers.js';
import { registerLocationHandlers } from './handlers/location.handlers.js';
import { registerStyleHandlers } from './handlers/style.handlers.js';
import { registerAiHandlers } from './handlers/ai.handlers.js';
import { registerOrchestrationHandlers } from './handlers/orchestration.handlers.js';
import { registerColorStyleHandlers } from './handlers/color-style.handlers.js';
import { registerWorkflowHandlers } from './handlers/workflow.handlers.js';
import { registerRenderHandlers } from './handlers/render.handlers.js';
import { registerExportHandlers } from './handlers/export.handlers.js';
import { registerFfmpegHandlers } from './handlers/ffmpeg.handlers.js';
import { registerSeriesHandlers } from './handlers/series.handlers.js';
import { createCanvasStore, registerCanvasHandlers } from './handlers/canvas.handlers.js';
import { registerCanvasGenerationHandlers } from './handlers/canvas-generation.handlers.js';
import { registerPresetHandlers } from './handlers/preset.handlers.js';
import { registerCommanderHandlers } from './handlers/commander.handlers.js';
import { registerEntityHandlers } from './handlers/entity.handlers.js';
import { BUILT_IN_PRESET_LIBRARY } from '@lucid-fin/contracts';

export interface AppDeps {
  db: SqliteIndex;
  projectFS: ProjectFS;
  cas: CAS;
  keychain: Keychain;
  registry: AdapterRegistry;
  jobQueue: JobQueue;
  llmRegistry: LLMRegistry;
  workflowEngine: WorkflowEngine;
  agent: AgentOrchestrator | null;
  promptStore: PromptStore;
}

export function registerAllHandlers(
  getWindow: () => BrowserWindow | null,
  deps: AppDeps,
): void {
  const { db, projectFS, cas, keychain, registry, jobQueue, llmRegistry, workflowEngine, agent, promptStore } = deps;
  log.info('Registering IPC handlers', {
    category: 'ipc',
    hasWindowGetter: typeof getWindow === 'function',
    hasAgent: Boolean(agent),
  });
  registerProjectHandlers(ipcMain, projectFS, db, cas);
  registerAssetHandlers(ipcMain, cas, db);
  registerJobHandlers(ipcMain, getWindow, db, jobQueue);
  registerKeychainHandlers(ipcMain, keychain, registry, llmRegistry);
  registerScriptHandlers(ipcMain, db);
  registerSceneHandlers(ipcMain, db);
  registerCharacterHandlers(ipcMain, db);
  registerEquipmentHandlers(ipcMain, db);
  registerLocationHandlers(ipcMain, db);
  registerStyleHandlers(ipcMain);
  registerAiHandlers(ipcMain, getWindow, agent, promptStore);
  registerOrchestrationHandlers(ipcMain, db);
  registerColorStyleHandlers(ipcMain, db, cas, workflowEngine);
  registerWorkflowHandlers(ipcMain, workflowEngine);
  registerRenderHandlers(ipcMain);
  registerExportHandlers(ipcMain);
  registerFfmpegHandlers(ipcMain);
  registerSeriesHandlers(ipcMain, db);
  const canvasStore = createCanvasStore(db);
  registerCanvasHandlers(ipcMain, canvasStore);
  registerCanvasGenerationHandlers(ipcMain, {
    adapterRegistry: registry,
    cas,
    db,
    canvasStore,
    keychain,
  });
  registerPresetHandlers(ipcMain, db);
  registerCommanderHandlers(ipcMain, getWindow, {
    adapterRegistry: registry,
    llmRegistry,
    canvasStore,
    presetLibrary: BUILT_IN_PRESET_LIBRARY,
    jobQueue,
    workflowEngine,
    db,
    cas,
    projectFS,
    keychain,
    resolvePrompt: (code: string) => promptStore.resolve(code),
  });
  registerEntityHandlers(ipcMain, { adapterRegistry: registry, cas, db });
  log.info('IPC handlers registered', {
    category: 'ipc',
    canvasStoreReady: true,
    hasAgent: Boolean(agent),
  });
}
