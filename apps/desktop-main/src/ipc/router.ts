import { ipcMain, type BrowserWindow } from 'electron';
import log from '../logger.js';
import type { SqliteIndex } from '@lucid-fin/storage';
import { CAS, Keychain, type PromptStore, type ProcessPromptStore } from '@lucid-fin/storage';
import type { AdapterRegistry, LLMRegistry } from '@lucid-fin/adapters-ai';
import type { JobQueue, WorkflowEngine, AgentOrchestrator } from '@lucid-fin/application';
import { registerAssetHandlers } from './handlers/asset.handlers.js';
import { registerJobHandlers } from './handlers/job.handlers.js';
import { registerKeychainHandlers } from './handlers/keychain.handlers.js';
import { registerScriptHandlers } from './handlers/script.handlers.js';
import { registerCharacterHandlers } from './handlers/character.handlers.js';
import { registerEquipmentHandlers } from './handlers/equipment.handlers.js';
import { registerLocationHandlers } from './handlers/location.handlers.js';
import { registerStyleHandlers } from './handlers/style.handlers.js';
import { registerAiHandlers } from './handlers/ai.handlers.js';
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
import { registerVisionHandlers } from './handlers/vision.handlers.js';
import { registerVideoChainHandlers } from './handlers/video-chain.js';
import { registerLipSyncHandlers } from './handlers/lipsync.handlers.js';
import { registerEmbeddingHandlers } from './handlers/embedding.handlers.js';
import { registerVideoCloneHandlers } from './handlers/video-clone.handlers.js';
import { registerStorageHandlers } from './handlers/storage.handlers.js';
import { registerSnapshotHandlers } from './handlers/snapshot.handlers.js';
import { registerProcessPromptHandlers } from './handlers/process-prompt.handlers.js';
import { registerFolderHandlers } from './handlers/folder.handlers.js';
import { BUILT_IN_PRESET_LIBRARY } from '@lucid-fin/contracts';

export interface AppDeps {
  db: SqliteIndex;
  cas: CAS;
  keychain: Keychain;
  registry: AdapterRegistry;
  jobQueue: JobQueue;
  llmRegistry: LLMRegistry;
  workflowEngine: WorkflowEngine;
  agent: AgentOrchestrator | null;
  promptStore: PromptStore;
  processPromptStore: ProcessPromptStore;
}

export function registerAllHandlers(getWindow: () => BrowserWindow | null, deps: AppDeps): void {
  const {
    db,
    cas,
    keychain,
    registry,
    jobQueue,
    llmRegistry,
    workflowEngine,
    agent,
    promptStore,
    processPromptStore,
  } = deps;
  log.info('Registering IPC handlers', {
    category: 'ipc',
    hasWindowGetter: typeof getWindow === 'function',
    hasAgent: Boolean(agent),
  });
  registerAssetHandlers(ipcMain, cas, db, keychain);
  registerJobHandlers(ipcMain, getWindow, db, jobQueue);
  registerKeychainHandlers(ipcMain, keychain, registry, llmRegistry);
  registerScriptHandlers(ipcMain, db);
  registerCharacterHandlers(ipcMain, db);
  registerEquipmentHandlers(ipcMain, db);
  registerLocationHandlers(ipcMain, db);
  registerStyleHandlers(ipcMain, db);
  registerAiHandlers(ipcMain, getWindow, agent, promptStore);
  registerProcessPromptHandlers(ipcMain, processPromptStore);
  registerColorStyleHandlers(ipcMain, db, cas, workflowEngine);
  registerWorkflowHandlers(ipcMain, workflowEngine);
  registerRenderHandlers(ipcMain);
  registerFfmpegHandlers(ipcMain);
  registerSeriesHandlers(ipcMain, db);
  const canvasStore = createCanvasStore(db);
  registerCanvasHandlers(ipcMain, canvasStore);
  registerExportHandlers(ipcMain, cas, canvasStore);
  registerCanvasGenerationHandlers(ipcMain, {
    adapterRegistry: registry,
    cas,
    db,
    canvasStore,
    keychain,
    getWindow,
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
    keychain,
    promptStore,
    resolvePrompt: (code: string) => promptStore.resolve(code),
    resolveProcessPrompt: (processKey: string) => processPromptStore.getEffectiveValue(processKey),
    listProcessPromptKeys: () =>
      processPromptStore
        .list()
        .map((record) => ({ processKey: record.processKey, name: record.name })),
  });
  registerEntityHandlers(ipcMain, { adapterRegistry: registry, cas, db });
  registerVisionHandlers(ipcMain, { cas, keychain });
  registerVideoChainHandlers(ipcMain, canvasStore, cas);
  registerLipSyncHandlers(ipcMain, { cas, canvasStore, db });
  registerEmbeddingHandlers(ipcMain, { cas, keychain, db, getWindow });
  registerVideoCloneHandlers(ipcMain, { cas, canvasStore, getWindow });
  registerStorageHandlers(ipcMain, { db, cas });
  registerSnapshotHandlers(ipcMain, db);
  registerFolderHandlers(ipcMain, db);
  log.info('IPC handlers registered', {
    category: 'ipc',
    canvasStoreReady: true,
    hasAgent: Boolean(agent),
  });
}
