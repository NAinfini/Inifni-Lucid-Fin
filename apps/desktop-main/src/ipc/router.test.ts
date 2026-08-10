import { beforeEach, describe, expect, it, vi } from 'vitest';

const logger = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  fatal: vi.fn(),
}));

const registerAssetHandlers = vi.hoisted(() => vi.fn());
const registerJobHandlers = vi.hoisted(() => vi.fn());
const registerKeychainHandlers = vi.hoisted(() => vi.fn());
const registerScriptHandlers = vi.hoisted(() => vi.fn());
const registerCharacterHandlers = vi.hoisted(() => vi.fn());
const registerEquipmentHandlers = vi.hoisted(() => vi.fn());
const registerLocationHandlers = vi.hoisted(() => vi.fn());
const registerStyleHandlers = vi.hoisted(() => vi.fn());
const registerAiHandlers = vi.hoisted(() => vi.fn());
const registerColorStyleHandlers = vi.hoisted(() => vi.fn());
const registerWorkflowHandlers = vi.hoisted(() => vi.fn());
const registerRenderHandlers = vi.hoisted(() => vi.fn());
const registerExportHandlers = vi.hoisted(() => vi.fn());
const registerFfmpegHandlers = vi.hoisted(() => vi.fn());
const registerSeriesHandlers = vi.hoisted(() => vi.fn());
const createCanvasStore = vi.hoisted(() => vi.fn(() => ({ id: 'canvas-store' })));
const registerCanvasHandlers = vi.hoisted(() => vi.fn());
const registerCanvasGenerationHandlers = vi.hoisted(() => vi.fn());
const registerPresetHandlers = vi.hoisted(() => vi.fn());
const commanderContinuation = vi.hoisted(() => ({
  request: vi.fn(),
  recoverPending: vi.fn(),
}));
const registerCommanderHandlers = vi.hoisted(() => vi.fn(() => commanderContinuation));
const registerEntityHandlers = vi.hoisted(() => vi.fn());
const registerProcessPromptHandlers = vi.hoisted(() => vi.fn());
const registerProviderOAuthHandlers = vi.hoisted(() => vi.fn());
const registerVisionHandlers = vi.hoisted(() => vi.fn());
const registerVideoChainHandlers = vi.hoisted(() => vi.fn());
const registerLipSyncHandlers = vi.hoisted(() => vi.fn());
const registerEmbeddingHandlers = vi.hoisted(() => vi.fn());
const registerVideoCloneHandlers = vi.hoisted(() => vi.fn());
const registerStorageHandlers = vi.hoisted(() => vi.fn());
const registerSnapshotHandlers = vi.hoisted(() => vi.fn());
const registerFolderHandlers = vi.hoisted(() => vi.fn());
const finalExportService = vi.hoisted(() => ({ recoverInterruptedExecutions: vi.fn() }));
const productionMediaService = vi.hoisted(() => ({ recoverInterruptedAttempts: vi.fn() }));
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
    shell: {
      openExternal: vi.fn(),
      openPath: vi.fn(),
      showItemInFolder: vi.fn(),
    },
  };
  return { ...electron, default: electron };
});

vi.mock('./handlers/asset.handlers.js', () => ({ registerAssetHandlers }));
vi.mock('./handlers/job.handlers.js', () => ({ registerJobHandlers }));
vi.mock('./handlers/keychain.handlers.js', () => ({ registerKeychainHandlers }));
vi.mock('./handlers/script.handlers.js', () => ({ registerScriptHandlers }));
vi.mock('./handlers/character.handlers.js', () => ({ registerCharacterHandlers }));
vi.mock('./handlers/equipment.handlers.js', () => ({ registerEquipmentHandlers }));
vi.mock('./handlers/location.handlers.js', () => ({ registerLocationHandlers }));
vi.mock('./handlers/style.handlers.js', () => ({ registerStyleHandlers }));
vi.mock('./handlers/ai.handlers.js', () => ({ registerAiHandlers }));
vi.mock('./handlers/color-style.handlers.js', () => ({ registerColorStyleHandlers }));
vi.mock('./handlers/workflow.handlers.js', () => ({ registerWorkflowHandlers }));
vi.mock('./handlers/render.handlers.js', () => ({ registerRenderHandlers }));
vi.mock('./handlers/export.handlers.js', () => ({ registerExportHandlers }));
vi.mock('./handlers/ffmpeg.handlers.js', () => ({ registerFfmpegHandlers }));
vi.mock('./handlers/series.handlers.js', () => ({ registerSeriesHandlers }));
vi.mock('./handlers/canvas.handlers.js', () => ({ createCanvasStore, registerCanvasHandlers }));
vi.mock('./handlers/canvas-generation.handlers.js', () => ({ registerCanvasGenerationHandlers }));
vi.mock('./handlers/preset.handlers.js', () => ({ registerPresetHandlers }));
vi.mock('./handlers/commander.handlers.js', () => ({ registerCommanderHandlers }));
vi.mock('./handlers/entity.handlers.js', () => ({ registerEntityHandlers }));
vi.mock('./handlers/process-prompt.handlers.js', () => ({ registerProcessPromptHandlers }));
vi.mock('./handlers/provider-oauth.handlers.js', () => ({ registerProviderOAuthHandlers }));
vi.mock('./handlers/vision.handlers.js', () => ({ registerVisionHandlers }));
vi.mock('./handlers/video-chain.js', () => ({ registerVideoChainHandlers }));
vi.mock('./handlers/lipsync.handlers.js', () => ({ registerLipSyncHandlers }));
vi.mock('./handlers/embedding.handlers.js', () => ({ registerEmbeddingHandlers }));
vi.mock('./handlers/video-clone.handlers.js', () => ({ registerVideoCloneHandlers }));
vi.mock('./handlers/storage.handlers.js', () => ({ registerStorageHandlers }));
vi.mock('./handlers/snapshot.handlers.js', () => ({ registerSnapshotHandlers }));
vi.mock('./handlers/folder.handlers.js', () => ({ registerFolderHandlers }));
vi.mock('../services/final-export.service.js', () => ({
  createFinalExportService: vi.fn(() => finalExportService),
}));
vi.mock('../services/production-media.service.js', () => ({
  createProductionMediaService: vi.fn(() => productionMediaService),
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

  it('logs registration start and completion with handler context', () => {
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
          workflows: {
            listRecoverableMediaAttempts: vi.fn(() => []),
            listRecoverableExportExecutions: vi.fn(() => []),
          },
        },
      },
      cas: { tag: 'cas' },
      keychain: { tag: 'keychain' },
      registry: { tag: 'registry' },
      jobQueue: { tag: 'jobQueue' },
      llmRegistry: { tag: 'llmRegistry' },
      workflowEngine: { tag: 'workflowEngine' },
      agent: { tag: 'agent' },
      promptStore: { resolve: vi.fn((code: string) => code) },
      processPromptStore: { getEffectiveValue: vi.fn((key: string) => key) },
      oauthManager: { tag: 'oauth-manager' },
    } as unknown as AppDeps;

    registerAllHandlers(getWindow, deps);

    expect(logger.info).toHaveBeenCalledWith(
      'Registering IPC handlers',
      expect.objectContaining({
        category: 'ipc',
        hasAgent: true,
        hasWindowGetter: true,
      }),
    );
    expect(registerAssetHandlers).toHaveBeenCalled();
    expect(registerExportHandlers).toHaveBeenCalled();
    expect(registerCommanderHandlers).toHaveBeenCalled();
    expect(registerProcessPromptHandlers).toHaveBeenCalledWith(
      expect.anything(),
      deps.processPromptStore,
    );
    expect(registerCommanderHandlers).toHaveBeenCalledWith(
      expect.anything(),
      getWindow,
      expect.objectContaining({
        resolveProcessPrompt: expect.any(Function),
      }),
    );
    expect(registerCanvasGenerationHandlers).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        adapterRegistry: deps.registry,
        canvasStore: { id: 'canvas-store' },
      }),
    );
    expect(registerWorkflowHandlers).toHaveBeenCalledWith(expect.anything(), deps.workflowEngine, {
      requestCommanderContinuation: commanderContinuation.request,
    });
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
