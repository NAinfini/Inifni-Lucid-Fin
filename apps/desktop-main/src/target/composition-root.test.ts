import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TargetDataAccessOptions } from '@lucid-fin/target-storage';
import {
  createJourneyDependencies,
  createJourneyPrivateRecoveryCodec,
  deterministicIds,
} from '../../../../packages/target-storage/test/i2h/fixture.js';
import {
  TargetDesktopStartupError,
  startTargetDesktopComposition,
  type TargetDesktopStartupState,
} from './composition-root.js';

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()?.();
});

async function startupFixture() {
  const directory = await mkdtemp(join(tmpdir(), 'lucid-fin-target-composition-'));
  cleanups.push(() => rm(directory, { force: true, recursive: true }));
  const dependencies = createJourneyDependencies();
  const createId = deterministicIds();
  const dataAccess: TargetDataAccessOptions = {
    now: () => '2026-08-24T12:00:00.000Z',
    createId,
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
  };
  return { dataAccess, databasePath: join(directory, 'project.sqlite') };
}

function ipcFixture(order: string[]) {
  const listeners = new Map<string, (...args: never[]) => unknown>();
  return {
    listeners,
    ipcMain: {
      handle: vi.fn((channel: string, listener: (...args: never[]) => unknown) => {
        order.push('ipc');
        listeners.set(channel, listener);
      }),
      removeHandler: vi.fn((channel: string) => {
        order.push('remove-ipc');
        listeners.delete(channel);
      }),
    },
  };
}

function pushFixture() {
  let request = 0;
  return {
    createPushRequestId: () => `request.composition.push.${++request}`,
    runEventSink: { send: vi.fn() },
    onInternalError: vi.fn(),
  };
}

describe('target desktop composition startup barrier', () => {
  it('becomes ready only after schema, Skill provisioning, recovery, and one IPC registration', async () => {
    const fixture = await startupFixture();
    const order: string[] = [];
    const states: TargetDesktopStartupState[] = [];
    const ipc = ipcFixture(order);
    const runtime = {
      recoverAndReconcile: vi.fn(async () => order.push('recovery')),
      notifyDurableRunWork: vi.fn(),
      close: vi.fn(async () => order.push('runtime-close')),
    };
    const composition = await startTargetDesktopComposition({
      ...fixture,
      ...pushFixture(),
      ipcMain: ipc.ipcMain,
      contextForRequest: () => ({
        actor: 'user',
        causation: { kind: 'direct_ui', actionId: 'action.composition.1' },
        correlationId: 'correlation.composition.1',
      }),
      createRuntime: () => runtime,
      acceptanceSeedFor: vi.fn() as never,
      pickExportDestination: vi.fn() as never,
      pickMedia: vi.fn() as never,
      reportStartup: (state) => {
        states.push(state);
        if (state.status === 'starting') order.push(state.stage);
        if (state.status === 'ready') order.push('ready');
      },
      dataAccess: fixture.dataAccess,
    });

    expect(order).toEqual(['store', 'skills', 'recovery', 'recovery', 'ipc', 'ipc', 'ready']);
    expect(composition.databaseCreated).toBe(true);
    expect(composition.builtInSkills.results).toHaveLength(287);
    expect(composition.builtInSkills.results.every(({ status }) => status === 'inserted')).toBe(
      true,
    );
    expect(ipc.ipcMain.handle).toHaveBeenCalledOnce();

    await composition.close();
    await composition.close();
    expect(runtime.close).toHaveBeenCalledOnce();
    expect(ipc.ipcMain.removeHandler).toHaveBeenCalledOnce();
    expect(() =>
      composition.data.projects.list({
        wireVersion: 1,
        kind: 'request',
        requestId: 'request.composition.closed.1',
        method: 'project.list',
        input: { cursor: null, limit: 20 },
      }),
    ).toThrow(/not open/i);
  });

  it('cold-opens the same store with an unchanged canonical Skill pack', async () => {
    const fixture = await startupFixture();
    const start = async () => {
      const ipc = ipcFixture([]);
      return startTargetDesktopComposition({
        ...fixture,
        ...pushFixture(),
        ipcMain: ipc.ipcMain,
        contextForRequest: vi.fn() as never,
        createRuntime: () => ({
          recoverAndReconcile: async () => undefined,
          notifyDurableRunWork: () => undefined,
          close: async () => undefined,
        }),
        acceptanceSeedFor: vi.fn() as never,
        pickExportDestination: vi.fn() as never,
        pickMedia: vi.fn() as never,
        reportStartup: () => undefined,
        dataAccess: fixture.dataAccess,
      });
    };

    const first = await start();
    await first.close();
    const second = await start();
    expect(second.databaseCreated).toBe(false);
    expect(second.builtInSkills.results).toHaveLength(287);
    expect(second.builtInSkills.results.every(({ status }) => status === 'unchanged')).toBe(true);
    await second.close();
  });

  it('reports a recovery failure without registering IPC or leaving the store open', async () => {
    const fixture = await startupFixture();
    const states: TargetDesktopStartupState[] = [];
    const ipc = ipcFixture([]);
    const close = vi.fn(async () => undefined);

    await expect(
      startTargetDesktopComposition({
        ...fixture,
        ...pushFixture(),
        ipcMain: ipc.ipcMain,
        contextForRequest: vi.fn() as never,
        createRuntime: () => ({
          recoverAndReconcile: async () => {
            throw new Error('PRIVATE provider recovery receipt');
          },
          notifyDurableRunWork: () => undefined,
          close,
        }),
        acceptanceSeedFor: vi.fn() as never,
        pickExportDestination: vi.fn() as never,
        pickMedia: vi.fn() as never,
        reportStartup: (state) => states.push(state),
        localizeStartupError: (stage) => `Localized startup ${stage}`,
        dataAccess: fixture.dataAccess,
      }),
    ).rejects.toEqual(
      expect.objectContaining<TargetDesktopStartupError>({
        code: 'target_startup_failed',
        stage: 'recovery',
        message: 'Localized startup recovery',
      }),
    );
    expect(ipc.ipcMain.handle).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledOnce();
    expect(states.at(-1)).toEqual({
      status: 'failed',
      stage: 'recovery',
      code: 'target_startup_failed',
      publicSummary: 'Localized startup recovery',
    });
    expect(JSON.stringify(states)).not.toContain('PRIVATE');
  });
});
