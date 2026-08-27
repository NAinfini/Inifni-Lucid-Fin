import { expect, vi } from 'vitest';
import type { TargetDataAccessOptions } from '@lucid-fin/target-storage';
import {
  createJourneyDependencies,
  createJourneyPrivateRecoveryCodec,
  deterministicIds,
} from '../../packages/target-storage/test/i2h/fixture.js';
import {
  TargetDesktopStartupError,
  startTargetDesktopComposition,
  type TargetDesktopStartupState,
} from '../../apps/desktop-main/src/target/composition-root.js';

const CANONICAL_BUILT_IN_SKILL_COUNT = 287;

export interface TargetCompositionStartupCase {
  readonly databasePath: string;
  readonly expectedDatabaseCreated: boolean;
  readonly expectedProjectIds: readonly string[];
}

function startupDataAccess(): TargetDataAccessOptions {
  const dependencies = createJourneyDependencies();
  return {
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
  };
}

function ipcFixture(order: string[]) {
  const listeners = new Map<string, (...args: never[]) => unknown>();
  return {
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

function listProjectIds(data: Awaited<ReturnType<typeof startTargetDesktopComposition>>['data']) {
  return data.projects
    .list({
      wireVersion: 1,
      kind: 'request',
      requestId: 'request.composition.projects.1',
      method: 'project.list',
      input: { cursor: null, limit: 20 },
    })
    .result.items.map(({ id }) => id)
    .sort();
}

export async function assertTargetCompositionStartup(
  fixture: TargetCompositionStartupCase,
): Promise<void> {
  const dataAccess = startupDataAccess();
  const order: string[] = [];
  const ipc = ipcFixture(order);
  const runtime = {
    recoverAndReconcile: vi.fn(async () => order.push('recovery')),
    notifyDurableRunWork: vi.fn(),
    close: vi.fn(async () => order.push('runtime-close')),
  };
  const start = async (currentOrder: string[], currentIpc = ipc, currentRuntime = runtime) =>
    startTargetDesktopComposition({
      databasePath: fixture.databasePath,
      dataAccess,
      ...pushFixture(),
      ipcMain: currentIpc.ipcMain,
      contextForRequest: () => ({
        actor: 'user',
        causation: { kind: 'direct_ui', actionId: 'action.composition.1' },
        correlationId: 'correlation.composition.1',
      }),
      createRuntime: () => currentRuntime,
      acceptanceSeedFor: vi.fn() as never,
      pickExportDestination: vi.fn() as never,
      pickMedia: vi.fn() as never,
      reportStartup: (state) => {
        if (state.status === 'starting') currentOrder.push(state.stage);
        if (state.status === 'ready') currentOrder.push('ready');
      },
    });

  let first: Awaited<ReturnType<typeof startTargetDesktopComposition>> | undefined;
  let second: Awaited<ReturnType<typeof startTargetDesktopComposition>> | undefined;
  try {
    first = await start(order);
    expect(order).toEqual(['store', 'skills', 'recovery', 'recovery', 'ipc', 'ipc', 'ready']);
    expect(first.databaseCreated).toBe(fixture.expectedDatabaseCreated);
    expect(first.builtInSkills.results).toHaveLength(CANONICAL_BUILT_IN_SKILL_COUNT);
    expect(first.builtInSkills.results.every(({ status }) => status === 'inserted')).toBe(true);
    expect(listProjectIds(first.data)).toEqual([...fixture.expectedProjectIds].sort());
    expect(ipc.ipcMain.handle).toHaveBeenCalledOnce();
    expect(runtime.notifyDurableRunWork).toHaveBeenCalledOnce();

    await first.close();
    await first.close();
    expect(runtime.close).toHaveBeenCalledOnce();
    expect(ipc.ipcMain.removeHandler).toHaveBeenCalledOnce();
    expect(() => listProjectIds(first.data)).toThrow(/not open/i);

    const coldOrder: string[] = [];
    const coldIpc = ipcFixture(coldOrder);
    const coldRuntime = {
      recoverAndReconcile: vi.fn(async () => coldOrder.push('recovery')),
      notifyDurableRunWork: vi.fn(),
      close: vi.fn(async () => coldOrder.push('runtime-close')),
    };
    second = await start(coldOrder, coldIpc, coldRuntime);
    expect(coldOrder).toEqual(['store', 'skills', 'recovery', 'recovery', 'ipc', 'ipc', 'ready']);
    expect(second.databaseCreated).toBe(false);
    expect(second.builtInSkills.results).toHaveLength(CANONICAL_BUILT_IN_SKILL_COUNT);
    expect(second.builtInSkills.results.every(({ status }) => status === 'unchanged')).toBe(true);
    expect(listProjectIds(second.data)).toEqual([...fixture.expectedProjectIds].sort());
    await second.close();
    expect(coldRuntime.close).toHaveBeenCalledOnce();
    expect(coldIpc.ipcMain.removeHandler).toHaveBeenCalledOnce();

    const failedIpc = ipcFixture([]);
    const failedStates: TargetDesktopStartupState[] = [];
    const failedRuntimeClose = vi.fn(async () => undefined);
    await expect(
      startTargetDesktopComposition({
        databasePath: fixture.databasePath,
        dataAccess,
        ...pushFixture(),
        ipcMain: failedIpc.ipcMain,
        contextForRequest: vi.fn() as never,
        createRuntime: () => ({
          recoverAndReconcile: async () => {
            throw new Error('PRIVATE provider recovery receipt');
          },
          notifyDurableRunWork: () => undefined,
          close: failedRuntimeClose,
        }),
        acceptanceSeedFor: vi.fn() as never,
        pickExportDestination: vi.fn() as never,
        pickMedia: vi.fn() as never,
        reportStartup: (state) => failedStates.push(state),
        localizeStartupError: (stage) => `Localized startup ${stage}`,
      }),
    ).rejects.toEqual(
      expect.objectContaining<TargetDesktopStartupError>({
        code: 'target_startup_failed',
        stage: 'recovery',
        message: 'Localized startup recovery',
      }),
    );
    expect(failedIpc.ipcMain.handle).not.toHaveBeenCalled();
    expect(failedRuntimeClose).toHaveBeenCalledOnce();
    expect(failedStates.at(-1)).toEqual({
      status: 'failed',
      stage: 'recovery',
      code: 'target_startup_failed',
      publicSummary: 'Localized startup recovery',
    });
    expect(JSON.stringify(failedStates)).not.toContain('PRIVATE');
  } finally {
    await second?.close();
    await first?.close();
  }
}
