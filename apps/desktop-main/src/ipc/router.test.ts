import { beforeEach, describe, expect, it, vi } from 'vitest';

const logger = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  fatal: vi.fn(),
}));

const registerAssetHandlers = vi.hoisted(() => vi.fn());
const registerKeychainHandlers = vi.hoisted(() => vi.fn());
const registerScriptHandlers = vi.hoisted(() => vi.fn());
const registerCharacterHandlers = vi.hoisted(() => vi.fn());
const registerEquipmentHandlers = vi.hoisted(() => vi.fn());
const registerLocationHandlers = vi.hoisted(() => vi.fn());
const registerStyleHandlers = vi.hoisted(() => vi.fn());
const registerColorStyleHandlers = vi.hoisted(() => vi.fn());
const registerTaskListHandlers = vi.hoisted(() => vi.fn());
const registerDeliveryPackageHandlers = vi.hoisted(() => vi.fn());
const registerReviewCutHandlers = vi.hoisted(() => vi.fn());
const registerFfmpegHandlers = vi.hoisted(() => vi.fn());
const registerCanvasHandlers = vi.hoisted(() => vi.fn());
const registerCanvasDeliveryHandlers = vi.hoisted(() => vi.fn());
const registerPresetHandlers = vi.hoisted(() => vi.fn());
const projectPresetCatalog = vi.hoisted(() => ({
  list: vi.fn(() => [{ id: 'resolved-preset' }]),
  save: vi.fn(),
  delete: vi.fn(),
  reset: vi.fn(),
}));
const commanderContinuation = vi.hoisted(() => ({
  request: vi.fn(),
  recoverPending: vi.fn(),
}));
const registerCommanderHandlers = vi.hoisted(() => vi.fn(() => commanderContinuation));
const registerProcessPromptHandlers = vi.hoisted(() => vi.fn());
const registerProviderOAuthHandlers = vi.hoisted(() => vi.fn());
const registerVisionHandlers = vi.hoisted(() => vi.fn());
const registerStorageHandlers = vi.hoisted(() => vi.fn());
const registerSnapshotHandlers = vi.hoisted(() => vi.fn());
const registerFolderHandlers = vi.hoisted(() => vi.fn());
const deliveryPackageService = vi.hoisted(() => ({ recoverInterruptedAttempts: vi.fn() }));
const createDeliveryPackageService = vi.hoisted(() => vi.fn(() => deliveryPackageService));
const reviewCutService = vi.hoisted(() => ({ tag: 'review-cut-service' }));
const createReviewCutService = vi.hoisted(() => vi.fn(() => reviewCutService));
const productionMediaService = vi.hoisted(() => ({ recoverInterruptedAttempts: vi.fn() }));
const createProductionMediaService = vi.hoisted(() => vi.fn(() => productionMediaService));
const visualAnalyzer = vi.hoisted(() => ({ id: 'visual-analyzer' }));

vi.mock('../logger.js', () => ({
  default: logger,
  debug: logger.debug,
  info: logger.info,
  warn: logger.warn,
  error: logger.error,
  fatal: logger.fatal,
}));

vi.mock('electron', () => {
  const electron = {
    app: { getPath: vi.fn(() => '') },
    dialog: {
      showOpenDialog: vi.fn(),
      showSaveDialog: vi.fn(),
    },
    ipcMain: { handle: vi.fn() },
    safeStorage: {
      isEncryptionAvailable: vi.fn(() => true),
      getSelectedStorageBackend: vi.fn(() => 'dpapi'),
      encryptString: vi.fn((value: string) => Buffer.from(`encrypted:${value}`)),
      decryptString: vi.fn((value: Buffer) => value.toString('utf8').replace(/^encrypted:/, '')),
    },
    shell: {
      openExternal: vi.fn(),
      openPath: vi.fn(),
      showItemInFolder: vi.fn(),
    },
  };
  return { ...electron, default: electron };
});

vi.mock('./handlers/asset.handlers.js', () => ({ registerAssetHandlers }));
vi.mock('./handlers/keychain.handlers.js', () => ({ registerKeychainHandlers }));
vi.mock('./handlers/script.handlers.js', () => ({ registerScriptHandlers }));
vi.mock('./handlers/character.handlers.js', () => ({ registerCharacterHandlers }));
vi.mock('./handlers/equipment.handlers.js', () => ({ registerEquipmentHandlers }));
vi.mock('./handlers/location.handlers.js', () => ({ registerLocationHandlers }));
vi.mock('./handlers/style.handlers.js', () => ({ registerStyleHandlers }));
vi.mock('./handlers/color-style.handlers.js', () => ({ registerColorStyleHandlers }));
vi.mock('./handlers/task-list.handlers.js', () => ({ registerTaskListHandlers }));
vi.mock('./handlers/delivery-package.handlers.js', () => ({ registerDeliveryPackageHandlers }));
vi.mock('./handlers/review-cut.handlers.js', () => ({ registerReviewCutHandlers }));
vi.mock('./handlers/ffmpeg.handlers.js', () => ({ registerFfmpegHandlers }));
vi.mock('./handlers/canvas.handlers.js', () => ({ registerCanvasHandlers }));
vi.mock('./handlers/canvas-delivery.handlers.js', () => ({ registerCanvasDeliveryHandlers }));
vi.mock('./handlers/preset.handlers.js', () => ({ registerPresetHandlers, projectPresetCatalog }));
vi.mock('./handlers/commander.handlers.js', () => ({ registerCommanderHandlers }));
vi.mock('./handlers/process-prompt.handlers.js', () => ({ registerProcessPromptHandlers }));
vi.mock('./handlers/provider-oauth.handlers.js', () => ({ registerProviderOAuthHandlers }));
vi.mock('./handlers/vision.handlers.js', () => ({ registerVisionHandlers }));
vi.mock('./handlers/storage.handlers.js', () => ({ registerStorageHandlers }));
vi.mock('./handlers/snapshot.handlers.js', () => ({ registerSnapshotHandlers }));
vi.mock('./handlers/folder.handlers.js', () => ({ registerFolderHandlers }));
vi.mock('../services/delivery-package.service.js', () => ({
  createDeliveryPackageService,
}));
vi.mock('../services/review-cut.service.js', () => ({ createReviewCutService }));
vi.mock('../services/production-media.service.js', () => ({
  createProductionMediaService,
}));
vi.mock('../services/visual-analyzer.service.js', () => ({
  createVisualAnalyzer: vi.fn(() => visualAnalyzer),
}));
vi.mock('@lucid-fin/contracts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@lucid-fin/contracts')>()),
  BUILT_IN_PRESET_LIBRARY: [{ id: 'preset-1' }],
}));

import { registerAllHandlers, type AppDeps } from './router.js';

describe('registerAllHandlers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('logs registration start and completion with handler context', async () => {
    const getWindow = () => null;
    const deps = {
      db: {
        tag: 'db',
        repos: {
          sessions: {
            upsert: vi.fn(),
            get: vi.fn(),
            list: vi.fn(() => ({ rows: [], degradedCount: 0 })),
            delete: vi.fn(),
          },
          snapshots: {
            insert: vi.fn(),
            get: vi.fn(),
            list: vi.fn(() => ({ rows: [], degradedCount: 0 })),
            delete: vi.fn(),
            prune: vi.fn(),
            pruneTiered: vi.fn(),
            capture: vi.fn(),
            restore: vi.fn(),
          },
          taskLists: {
            listRecoverableProductionMediaAttempts: vi.fn(() => []),
            listRecoverableDeliveryPackageAttempts: vi.fn(() => []),
          },
          commanderRuns: {
            getLatestForSession: vi.fn(() => undefined),
          },
        },
      },
      cas: { tag: 'cas' },
      keychain: { tag: 'keychain' },
      registry: { tag: 'registry' },
      llmRegistry: { tag: 'llmRegistry' },
      taskExecutionEngine: { tag: 'taskExecutionEngine', listSummaries: vi.fn(() => []) },
      promptStore: { resolve: vi.fn((code: string) => code) },
      processPromptStore: { getEffectiveValue: vi.fn((key: string) => key) },
      oauthManager: { tag: 'oauth-manager' },
      promptAssemblyService: { tag: 'prompt-assembly-service' },
      audioTaskService: { tag: 'audio-task-service' },
      mediaTaskService: { tag: 'media-task-service' },
      mediaGenerationService: { tag: 'media-generation-service' },
      mediaEvaluationService: { tag: 'media-evaluation-service' },
      visualAnalyzer,
      canvasStore: { id: 'canvas-store' },
    } as unknown as AppDeps;

    await registerAllHandlers(getWindow, deps);

    expect(logger.info).toHaveBeenCalledWith(
      'Registering IPC handlers',
      expect.objectContaining({
        category: 'ipc',
        hasWindowGetter: true,
      }),
    );
    expect(registerAssetHandlers).toHaveBeenCalled();
    expect(registerCanvasHandlers).toHaveBeenCalledWith(expect.anything(), deps.canvasStore);
    expect(registerCanvasDeliveryHandlers).toHaveBeenCalledWith(
      expect.anything(),
      getWindow,
      deps.db.repos.canvases,
      expect.objectContaining({ replace: expect.any(Function) }),
    );
    expect(registerCommanderHandlers).toHaveBeenCalled();
    expect(registerProcessPromptHandlers).toHaveBeenCalledWith(
      expect.anything(),
      deps.processPromptStore,
    );
    expect(registerCommanderHandlers).toHaveBeenCalledWith(
      expect.anything(),
      getWindow,
      expect.objectContaining({
        presetCatalog: projectPresetCatalog,
        resolveProcessPrompt: expect.any(Function),
      }),
    );
    expect(createProductionMediaService).toHaveBeenCalledWith(
      expect.objectContaining({
        presetCatalog: projectPresetCatalog,
        canvasStore: deps.canvasStore,
        mediaGenerationService: deps.mediaGenerationService,
        mediaEvaluationService: deps.mediaEvaluationService,
      }),
    );
    expect(createDeliveryPackageService).toHaveBeenCalledWith(
      expect.objectContaining({
        db: deps.db,
        cas: deps.cas,
        taskExecutionEngine: deps.taskExecutionEngine,
      }),
    );
    expect(registerDeliveryPackageHandlers).toHaveBeenCalledWith(
      expect.anything(),
      getWindow,
      deliveryPackageService,
    );
    expect(createReviewCutService).toHaveBeenCalledWith(
      expect.objectContaining({
        db: deps.db,
        cas: deps.cas,
        taskExecutionEngine: deps.taskExecutionEngine,
      }),
    );
    expect(registerReviewCutHandlers).toHaveBeenCalledWith(
      expect.anything(),
      getWindow,
      reviewCutService,
    );
    expect(registerTaskListHandlers).toHaveBeenCalledWith(
      expect.anything(),
      deps.taskExecutionEngine,
      expect.objectContaining({
        requestCommanderContinuation: commanderContinuation.request,
        mediaTaskService: deps.mediaTaskService,
        promptAssemblyService: deps.promptAssemblyService,
      }),
    );
    expect(registerSnapshotHandlers).toHaveBeenCalledWith(expect.anything(), deps.db);
    expect(commanderContinuation.recoverPending).toHaveBeenCalledOnce();
    expect(logger.info).toHaveBeenCalledWith(
      'IPC handlers registered',
      expect.objectContaining({
        category: 'ipc',
        canvasStoreReady: true,
      }),
    );
  });
});
