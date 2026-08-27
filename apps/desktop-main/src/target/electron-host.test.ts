import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  TARGET_WIRE_PUSH_CHANNEL_V1,
  type WirePushV1,
  type WireResponseV1,
} from '@lucid-fin/target-contracts';
import type { TargetDataAccessOptions } from '@lucid-fin/target-storage';
import {
  createJourneyDependencies,
  createJourneyPrivateRecoveryCodec,
  deterministicIds,
} from '../../../../packages/target-storage/test/i2h/fixture.js';
import {
  createTargetElectronPushSink,
  startTargetElectronHost,
  type TargetRendererWindowLike,
} from './electron-host.js';

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()?.();
});

async function dataFixture(): Promise<{
  readonly databasePath: string;
  readonly dataAccess: TargetDataAccessOptions;
}> {
  const directory = await mkdtemp(join(tmpdir(), 'lucid-fin-target-electron-host-'));
  cleanups.push(() => rm(directory, { force: true, recursive: true }));
  const dependencies = createJourneyDependencies();
  return {
    databasePath: join(directory, 'project.sqlite'),
    dataAccess: {
      now: () => '2026-08-24T12:00:00.000Z',
      createId: deterministicIds(),
      privateRecoveryCodec: createJourneyPrivateRecoveryCodec(),
      mediaCas: dependencies.mediaCas,
      mediaImportCapabilities: dependencies.imports,
      mediaInspector: dependencies.mediaInspector,
      localMediaDerivation: dependencies.localDerivation,
      transcriptionProvider: dependencies.transcription,
      generationProvider: dependencies.generation,
      providerCapabilitiesResolver: dependencies.providerCapabilities,
      resultAssessmentProvider: dependencies.assessment,
      reviewRenderer: dependencies.review,
      deliveryExporter: dependencies.exporter,
      deliveryDestinationGrants: dependencies.destinations,
    },
  };
}

function windowFixture(order: string[]) {
  let destroyed = false;
  let webContentsDestroyed = false;
  const send = vi.fn();
  const window: TargetRendererWindowLike = {
    webContents: {
      isDestroyed: () => webContentsDestroyed,
      send,
    },
    isDestroyed: () => destroyed,
    destroy: vi.fn(() => {
      order.push('window-destroy');
      destroyed = true;
      webContentsDestroyed = true;
    }),
  };
  return { send, window };
}

function ipcFixture(order: string[]) {
  return {
    handle: vi.fn(
      (_channel: string, _listener: (event: object, input: unknown) => Promise<WireResponseV1>) => {
        order.push('ipc');
      },
    ),
    removeHandler: vi.fn(() => order.push('remove-ipc')),
  };
}

function mediaPreviewProtocolFixture(order: string[]) {
  return {
    handle: vi.fn(() => order.push('media-protocol-install')),
    unhandle: vi.fn(() => order.push('media-protocol-uninstall')),
  };
}

describe('target Electron host', () => {
  it('creates and loads the renderer only after the complete target startup barrier', async () => {
    const setup = await dataFixture();
    const order: string[] = [];
    const ipcMain = ipcFixture(order);
    const mediaPreviewProtocol = mediaPreviewProtocolFixture(order);
    const renderer = windowFixture(order);
    const runtime = {
      recoverAndReconcile: vi.fn(async () => {
        order.push('recovery');
      }),
      notifyDurableRunWork: vi.fn(),
      close: vi.fn(async () => {
        order.push('runtime-close');
      }),
    };
    let pushRequest = 0;
    const host = await startTargetElectronHost({
      composition: {
        ...setup,
        contextForRequest: () => ({
          actor: 'user',
          causation: { kind: 'direct_ui', actionId: 'action.electron-host.1' },
          correlationId: 'correlation.electron-host.1',
        }),
        createRuntime: () => runtime,
        createPushRequestId: () => `request.electron-host.push.${++pushRequest}`,
        acceptanceSeedFor: vi.fn() as never,
        pickExportDestination: vi.fn() as never,
        pickMedia: vi.fn() as never,
        reportStartup: (state) => {
          if (state.status === 'starting') order.push(state.stage);
          else order.push(state.status);
        },
        onInternalError: vi.fn(),
      },
      ipcMain,
      mediaPreviewProtocol,
      isTrustedInvocation: () => true,
      createWindow: (preloadPath) => {
        order.push('window-create');
        expect(preloadPath).toMatch(/preload\.generated\.cjs$/u);
        return renderer.window;
      },
      loadWindow: async () => {
        order.push('window-load');
      },
    });

    expect(order.indexOf('ready')).toBeLessThan(order.indexOf('window-create'));
    expect(order.indexOf('window-create')).toBeLessThan(order.indexOf('window-load'));
    expect(order.indexOf('media-protocol-install')).toBeLessThan(order.indexOf('window-load'));
    await host.close();
    await host.close();
    expect(ipcMain.removeHandler).toHaveBeenCalledOnce();
    expect(mediaPreviewProtocol.unhandle).toHaveBeenCalledOnce();
    expect(runtime.close).toHaveBeenCalledOnce();
    expect(renderer.window.destroy).toHaveBeenCalledOnce();
  });

  it('sends target pushes only to a live renderer webContents', () => {
    const order: string[] = [];
    const renderer = windowFixture(order);
    let window: TargetRendererWindowLike | null = null;
    const sink = createTargetElectronPushSink(() => window);
    const push = { kind: 'push' } as WirePushV1;

    sink.send(push);
    window = renderer.window;
    sink.send(push);
    expect(renderer.send).toHaveBeenCalledWith(TARGET_WIRE_PUSH_CHANNEL_V1, push);
    renderer.window.destroy();
    sink.send(push);
    expect(renderer.send).toHaveBeenCalledOnce();
  });

  it('destroys a half-loaded renderer and closes target authorities when loading fails', async () => {
    const setup = await dataFixture();
    const order: string[] = [];
    const ipcMain = ipcFixture(order);
    const mediaPreviewProtocol = mediaPreviewProtocolFixture(order);
    const renderer = windowFixture(order);
    const runtime = {
      recoverAndReconcile: async () => undefined,
      notifyDurableRunWork: () => undefined,
      close: vi.fn(async () => undefined),
    };

    await expect(
      startTargetElectronHost({
        composition: {
          ...setup,
          contextForRequest: vi.fn() as never,
          createRuntime: () => runtime,
          createPushRequestId: () => 'request.electron-host.push.failure',
          acceptanceSeedFor: vi.fn() as never,
          pickExportDestination: vi.fn() as never,
          pickMedia: vi.fn() as never,
          reportStartup: () => undefined,
          onInternalError: vi.fn(),
        },
        ipcMain,
        mediaPreviewProtocol,
        isTrustedInvocation: () => true,
        createWindow: () => renderer.window,
        loadWindow: async () => {
          throw new Error('renderer load failed');
        },
      }),
    ).rejects.toThrow('renderer load failed');

    expect(renderer.window.destroy).toHaveBeenCalledOnce();
    expect(mediaPreviewProtocol.unhandle).toHaveBeenCalledOnce();
    expect(ipcMain.removeHandler).toHaveBeenCalledOnce();
    expect(runtime.close).toHaveBeenCalledOnce();
  });
});
