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
const registerSceneHandlers = vi.hoisted(() => vi.fn());
const registerCharacterHandlers = vi.hoisted(() => vi.fn());
const registerEquipmentHandlers = vi.hoisted(() => vi.fn());
const registerLocationHandlers = vi.hoisted(() => vi.fn());
const registerStyleHandlers = vi.hoisted(() => vi.fn());
const registerAiHandlers = vi.hoisted(() => vi.fn());
const registerOrchestrationHandlers = vi.hoisted(() => vi.fn());
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
const registerCommanderHandlers = vi.hoisted(() => vi.fn());
const registerEntityHandlers = vi.hoisted(() => vi.fn());

vi.mock('../logger.js', () => ({
  default: logger,
  debug: logger.debug,
  info: logger.info,
  warn: logger.warn,
  error: logger.error,
  fatal: logger.fatal,
}));

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
}));

vi.mock('./handlers/asset.handlers.js', () => ({ registerAssetHandlers }));
vi.mock('./handlers/job.handlers.js', () => ({ registerJobHandlers }));
vi.mock('./handlers/keychain.handlers.js', () => ({ registerKeychainHandlers }));
vi.mock('./handlers/script.handlers.js', () => ({ registerScriptHandlers }));
vi.mock('./handlers/scene.handlers.js', () => ({ registerSceneHandlers }));
vi.mock('./handlers/character.handlers.js', () => ({ registerCharacterHandlers }));
vi.mock('./handlers/equipment.handlers.js', () => ({ registerEquipmentHandlers }));
vi.mock('./handlers/location.handlers.js', () => ({ registerLocationHandlers }));
vi.mock('./handlers/style.handlers.js', () => ({ registerStyleHandlers }));
vi.mock('./handlers/ai.handlers.js', () => ({ registerAiHandlers }));
vi.mock('./handlers/orchestration.handlers.js', () => ({ registerOrchestrationHandlers }));
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
      db: { tag: 'db' },
      cas: { tag: 'cas' },
      keychain: { tag: 'keychain' },
      registry: { tag: 'registry' },
      jobQueue: { tag: 'jobQueue' },
      llmRegistry: { tag: 'llmRegistry' },
      workflowEngine: { tag: 'workflowEngine' },
      agent: { tag: 'agent' },
      promptStore: { resolve: vi.fn((code: string) => code) },
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
    expect(registerCanvasGenerationHandlers).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        adapterRegistry: deps.registry,
        canvasStore: { id: 'canvas-store' },
      }),
    );
    expect(logger.info).toHaveBeenCalledWith(
      'IPC handlers registered',
      expect.objectContaining({
        category: 'ipc',
        canvasStoreReady: true,
      }),
    );
  });
});
