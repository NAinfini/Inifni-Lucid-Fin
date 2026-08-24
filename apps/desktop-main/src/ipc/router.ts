import * as electron from 'electron';
import type { BrowserWindow } from 'electron';
import log from '../logger.js';
import type { SqliteIndex } from '@lucid-fin/storage';
import { CAS, Keychain, type PromptStore, type ProcessPromptStore } from '@lucid-fin/storage';
import type { AdapterRegistry, LLMRegistry } from '@lucid-fin/adapters-ai';
import type { TaskExecutionEngine } from '@lucid-fin/application';
import { registerAssetHandlers } from './handlers/asset.handlers.js';
import { registerKeychainHandlers } from './handlers/keychain.handlers.js';
import { registerScriptHandlers } from './handlers/script.handlers.js';
import { registerCharacterHandlers } from './handlers/character.handlers.js';
import { registerEquipmentHandlers } from './handlers/equipment.handlers.js';
import { registerLocationHandlers } from './handlers/location.handlers.js';
import { registerStyleHandlers } from './handlers/style.handlers.js';
import { registerColorStyleHandlers } from './handlers/color-style.handlers.js';
import { registerTaskListHandlers } from './handlers/task-list.handlers.js';
import { registerDeliveryPackageHandlers } from './handlers/delivery-package.handlers.js';
import { registerReviewCutHandlers } from './handlers/review-cut.handlers.js';
import { registerFfmpegHandlers } from './handlers/ffmpeg.handlers.js';
import { registerCanvasHandlers, type CanvasStore } from './handlers/canvas.handlers.js';
import { projectPresetCatalog, registerPresetHandlers } from './handlers/preset.handlers.js';
import { registerCommanderHandlers } from './handlers/commander.handlers.js';
import { registerVisionHandlers } from './handlers/vision.handlers.js';
import { registerStorageHandlers } from './handlers/storage.handlers.js';
import { registerSnapshotHandlers } from './handlers/snapshot.handlers.js';
import { registerProcessPromptHandlers } from './handlers/process-prompt.handlers.js';
import { registerFolderHandlers } from './handlers/folder.handlers.js';
import { registerProviderOAuthHandlers } from './handlers/provider-oauth.handlers.js';
import { registerCanvasDeliveryHandlers } from './handlers/canvas-delivery.handlers.js';
import { createDeliveryPackageService } from '../services/delivery-package.service.js';
import { createReviewCutService } from '../services/review-cut.service.js';
import { createProductionMediaService } from '../services/production-media.service.js';
import type { VisualAnalyzer } from '../services/visual-analyzer.service.js';
import type { MediaGenerationService } from '../services/media-generation.service.js';
import type { MediaEvaluationService } from '../services/media-evaluation.service.js';
import type { ProviderOAuthManager } from '../oauth/provider-oauth-manager.js';
import { reconcileStaleCommanderTaskLists } from './handlers/commander-task-list-lifecycle.js';
import { createSafeStorageCommanderRecoveryCodec } from './handlers/commander-recovery.service.js';

const { ipcMain } = electron;

export interface AppDeps {
  db: SqliteIndex;
  cas: CAS;
  keychain: Keychain;
  registry: AdapterRegistry;
  llmRegistry: LLMRegistry;
  taskExecutionEngine: TaskExecutionEngine;
  promptStore: PromptStore;
  processPromptStore: ProcessPromptStore;
  oauthManager: ProviderOAuthManager;
  promptAssemblyService: import('../services/prompt-assembly.service.js').PromptAssemblyService;
  audioTaskService: import('../services/audio-task.service.js').AudioTaskService;
  mediaTaskService: import('../services/media-task.service.js').MediaTaskService;
  mediaGenerationService: MediaGenerationService;
  mediaEvaluationService: MediaEvaluationService;
  visualAnalyzer: VisualAnalyzer;
  canvasStore: CanvasStore;
}

export async function registerAllHandlers(
  getWindow: () => BrowserWindow | null,
  deps: AppDeps,
): Promise<void> {
  const {
    db,
    cas,
    keychain,
    registry,
    llmRegistry,
    taskExecutionEngine,
    promptStore,
    processPromptStore,
    oauthManager,
    promptAssemblyService,
    audioTaskService,
    mediaTaskService,
    mediaGenerationService,
    mediaEvaluationService,
    visualAnalyzer,
    canvasStore,
  } = deps;
  log.info('Registering IPC handlers', {
    category: 'ipc',
    hasWindowGetter: typeof getWindow === 'function',
  });
  registerAssetHandlers(ipcMain, cas, db);
  registerKeychainHandlers(ipcMain, keychain, registry, llmRegistry);
  registerProviderOAuthHandlers(ipcMain, getWindow, oauthManager);
  registerScriptHandlers(ipcMain, db);
  registerCharacterHandlers(ipcMain, db);
  registerEquipmentHandlers(ipcMain, db);
  registerLocationHandlers(ipcMain, db);
  registerStyleHandlers(ipcMain, db);
  registerProcessPromptHandlers(ipcMain, processPromptStore);
  registerColorStyleHandlers(ipcMain, db, cas, taskExecutionEngine);
  registerPresetHandlers(ipcMain, db);
  const deliveryPackageService = createDeliveryPackageService({
    db,
    cas,
    taskExecutionEngine,
  });
  const reviewCutService = createReviewCutService({ db, cas, taskExecutionEngine });
  const productionMediaService = createProductionMediaService({
    db,
    cas,
    keychain,
    visualAnalyzer,
    adapterRegistry: registry,
    canvasStore,
    presetCatalog: projectPresetCatalog,
    taskExecutionEngine,
    promptAssemblyService,
    mediaGenerationService,
    mediaEvaluationService,
    resolveProcessPrompt: (processKey: string) => processPromptStore.getEffectiveValue(processKey),
  });
  registerDeliveryPackageHandlers(ipcMain, getWindow, deliveryPackageService);
  registerReviewCutHandlers(ipcMain, getWindow, reviewCutService);
  registerFfmpegHandlers(ipcMain);
  registerCanvasHandlers(ipcMain, canvasStore);
  registerCanvasDeliveryHandlers(ipcMain, getWindow, db.repos.canvases, {
    replace: (canvasId, deliverySequence) =>
      canvasStore.replaceDeliverySequence(canvasId, deliverySequence),
  });
  const commanderContinuation = registerCommanderHandlers(ipcMain, getWindow, {
    adapterRegistry: registry,
    llmRegistry,
    canvasStore,
    presetCatalog: projectPresetCatalog,
    taskExecutionEngine,
    db,
    cas,
    keychain,
    promptStore,
    productionMediaService,
    mediaGenerationService,
    visualAnalyzer,
    promptAssemblyService,
    audioTaskService,
    mediaTaskService,
    resolvePrompt: (code: string) => promptStore.resolve(code),
    resolveProcessPrompt: (processKey: string) => processPromptStore.getEffectiveValue(processKey),
    listProcessPromptKeys: () =>
      processPromptStore
        .list()
        .map((record) => ({ processKey: record.processKey, name: record.name })),
    recoveryCodec: createSafeStorageCommanderRecoveryCodec(electron.safeStorage),
  });
  registerTaskListHandlers(ipcMain, taskExecutionEngine, {
    requestCommanderContinuation: commanderContinuation.request,
    mediaTaskService,
    promptAssemblyService,
  });
  registerVisionHandlers(ipcMain, { visualAnalyzer });
  registerStorageHandlers(ipcMain, { db, cas });
  registerSnapshotHandlers(ipcMain, db);
  registerFolderHandlers(ipcMain, db);
  productionMediaService.recoverInterruptedAttempts();
  void deliveryPackageService.recoverInterruptedAttempts();
  await reconcileStaleCommanderTaskLists(taskExecutionEngine, db.repos.commanderRuns);
  commanderContinuation.recoverPending();
  log.info('IPC handlers registered', {
    category: 'ipc',
    canvasStoreReady: true,
  });
}
