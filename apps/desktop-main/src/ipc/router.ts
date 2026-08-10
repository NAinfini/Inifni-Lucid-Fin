import * as electron from 'electron';
import type { BrowserWindow } from 'electron';
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
import { registerProviderOAuthHandlers } from './handlers/provider-oauth.handlers.js';
import { BUILT_IN_PRESET_LIBRARY } from '@lucid-fin/contracts';
import { createFinalExportService } from '../services/final-export.service.js';
import { createProductionMediaService } from '../services/production-media.service.js';
import { createVisualAnalyzer } from '../services/visual-analyzer.service.js';
import type { ProviderOAuthManager } from '../oauth/provider-oauth-manager.js';

const { ipcMain } = electron;

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
  oauthManager: ProviderOAuthManager;
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
    oauthManager,
  } = deps;
  log.info('Registering IPC handlers', {
    category: 'ipc',
    hasWindowGetter: typeof getWindow === 'function',
    hasAgent: Boolean(agent),
  });
  const visualAnalyzer = createVisualAnalyzer({ cas, llmRegistry });
  registerAssetHandlers(ipcMain, cas, db, visualAnalyzer);
  registerJobHandlers(ipcMain, getWindow, db, jobQueue);
  registerKeychainHandlers(ipcMain, keychain, registry, llmRegistry);
  registerProviderOAuthHandlers(ipcMain, getWindow, oauthManager);
  registerScriptHandlers(ipcMain, db);
  registerCharacterHandlers(ipcMain, db);
  registerEquipmentHandlers(ipcMain, db);
  registerLocationHandlers(ipcMain, db);
  registerStyleHandlers(ipcMain, db);
  registerAiHandlers(ipcMain, getWindow, agent, promptStore);
  registerProcessPromptHandlers(ipcMain, processPromptStore);
  registerColorStyleHandlers(ipcMain, db, cas, workflowEngine);
  const canvasStore = createCanvasStore(db);
  const finalExportService = createFinalExportService({ db, cas, workflowEngine });
  const productionMediaService = createProductionMediaService({
    db,
    cas,
    keychain,
    visualAnalyzer,
    adapterRegistry: registry,
    canvasStore,
    workflowEngine,
  });
  registerRenderHandlers(ipcMain, finalExportService);
  registerFfmpegHandlers(ipcMain);
  registerSeriesHandlers(ipcMain, db);
  registerCanvasHandlers(ipcMain, canvasStore);
  registerExportHandlers(ipcMain, cas, canvasStore, finalExportService);
  registerCanvasGenerationHandlers(ipcMain, {
    adapterRegistry: registry,
    cas,
    db,
    canvasStore,
    keychain,
    getWindow,
  });
  registerPresetHandlers(ipcMain, db);
  const commanderContinuation = registerCommanderHandlers(ipcMain, getWindow, {
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
    finalExportService,
    productionMediaService,
    visualAnalyzer,
    resolvePrompt: (code: string) => promptStore.resolve(code),
    resolveProcessPrompt: (processKey: string) => processPromptStore.getEffectiveValue(processKey),
    listProcessPromptKeys: () =>
      processPromptStore
        .list()
        .map((record) => ({ processKey: record.processKey, name: record.name })),
  });
  registerWorkflowHandlers(ipcMain, workflowEngine, {
    requestCommanderContinuation: commanderContinuation.request,
  });
  registerEntityHandlers(ipcMain, { adapterRegistry: registry, cas, db });
  registerVisionHandlers(ipcMain, { visualAnalyzer });
  registerVideoChainHandlers(ipcMain, canvasStore, cas);
  registerLipSyncHandlers(ipcMain, { cas, canvasStore, db });
  registerEmbeddingHandlers(ipcMain, { visualAnalyzer, db, getWindow });
  registerVideoCloneHandlers(ipcMain, { cas, canvasStore, getWindow });
  registerStorageHandlers(ipcMain, { db, cas });
  registerSnapshotHandlers(ipcMain, db);
  registerFolderHandlers(ipcMain, db);
  productionMediaService.recoverInterruptedAttempts();
  finalExportService.recoverInterruptedExecutions();
  commanderContinuation.recoverPending();
  log.info('IPC handlers registered', {
    category: 'ipc',
    canvasStoreReady: true,
    hasAgent: Boolean(agent),
  });
}
