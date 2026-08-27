import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  TARGET_WIRE_INVOKE_CHANNEL_V1,
  type PublicWireMethodV1,
  type WireRequestV1,
  type WireResponseV1,
  type WireSuccessV1,
} from '@lucid-fin/target-contracts';
import type { TargetDataAccessOptions } from '@lucid-fin/target-storage';
import { createHostCatalogProvisioning } from '@lucid-fin/target-storage/host';
import {
  IMPORT_TOKEN,
  NOW,
  PROVIDER_ID,
  PROVIDER_MODEL,
  ROOT_CATALOG,
  budget,
  commanderContext,
  createJourneyDependencies,
  createJourneyPrivateRecoveryCodec,
  deterministicIds,
  formatPolicy,
} from '../../../../packages/target-storage/test/i2h/fixture.js';
import { startTargetDesktopComposition } from './composition-root.js';

type Request<Method extends PublicWireMethodV1> = Extract<
  WireRequestV1,
  { readonly method: Method }
>;
type Success<Method extends PublicWireMethodV1> = Extract<
  WireSuccessV1,
  { readonly method: Method }
>;

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()?.();
});

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'lucid-fin-target-ipc-'));
  cleanups.push(() => rm(directory, { force: true, recursive: true }));
  const dependencies = createJourneyDependencies();
  const createId = deterministicIds();
  const dataAccess: TargetDataAccessOptions = {
    now: () => NOW,
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

function ipcFixture() {
  let listener: ((event: object, input: unknown) => Promise<WireResponseV1>) | undefined;
  return {
    ipcMain: {
      handle: vi.fn(
        (channel: string, next: (event: object, input: unknown) => Promise<WireResponseV1>) => {
          expect(channel).toBe(TARGET_WIRE_INVOKE_CHANNEL_V1);
          listener = next;
        },
      ),
      removeHandler: vi.fn(() => {
        listener = undefined;
      }),
    },
    async invoke<Method extends PublicWireMethodV1>(
      request: Request<Method>,
    ): Promise<Success<Method>> {
      if (listener === undefined) throw new Error('Target IPC listener is not ready');
      const response = await listener({}, request);
      if (response.kind !== 'success') {
        throw new Error(`${response.error.code}: ${response.error.publicSummary}`);
      }
      expect(response.kind).toBe('success');
      return response as Success<Method>;
    },
  };
}

function request<Method extends PublicWireMethodV1>(
  method: Method,
  input: Request<Method>['input'],
): Request<Method> {
  return {
    wireVersion: 1,
    kind: 'request',
    requestId: `request.ipc.${method}`,
    method,
    input,
  } as Request<Method>;
}

function pickerSuccess<Method extends 'os.export.pick' | 'os.media.pick'>(
  value: Request<Method>,
): Success<Method> {
  const wireRequest = value as WireRequestV1;
  return {
    wireVersion: 1,
    kind: 'success',
    requestId: wireRequest.requestId,
    method: wireRequest.method,
    result: {
      capabilityToken: IMPORT_TOKEN,
      displayLabel: 'harbor-reference.png',
      expiresAt: '2026-08-25T12:00:00.000Z',
    },
  } as Success<Method>;
}

describe('target desktop single-router IPC journey', () => {
  it('persists the project-first path and queries all project workspaces through one channel', async () => {
    const setup = await fixture();
    const ipc = ipcFixture();
    let pushRequest = 0;
    const sendPush = vi.fn();
    const runtime = {
      recoverAndReconcile: vi.fn(async () => undefined),
      notifyDurableRunWork: vi.fn(),
      close: vi.fn(async () => undefined),
    };
    const privateWritableGrant = 'C:\\private\\exports\\harbor-final.mp4';
    const composition = await startTargetDesktopComposition({
      ...setup,
      ipcMain: ipc.ipcMain,
      createPushRequestId: () => `request.ipc.push.${++pushRequest}`,
      runEventSink: { send: sendPush },
      onInternalError: vi.fn(),
      authorizeInvocation: () => true,
      contextForRequest: (wireRequest) => ({
        actor: 'user',
        causation: { kind: 'direct_ui', actionId: wireRequest.requestId },
        correlationId: `correlation.${wireRequest.requestId}`,
      }),
      createRuntime: () => runtime,
      acceptanceSeedFor: async () => ({
        model: { providerId: PROVIDER_ID, model: PROVIDER_MODEL, reasoningStrength: null },
        locale: 'en-US',
        timeZone: 'America/New_York',
        capabilityCatalog: ROOT_CATALOG,
        projectMediaSelections: [],
        citedMemoryEntryIds: [],
      }),
      exportDestinationPicker: {
        pick: async (input) => ({
          state: 'selected',
          destination: input.destination,
          displayLabel: 'harbor-final.mp4',
          writableGrant: privateWritableGrant,
        }),
      },
      pickExportDestination: (wireRequest) => pickerSuccess(wireRequest),
      pickMedia: (wireRequest) => pickerSuccess(wireRequest),
      reportStartup: vi.fn(),
      dataAccess: setup.dataAccess,
    });

    try {
      createHostCatalogProvisioning(composition.store, { now: () => NOW }).registerProviderProfile({
        id: PROVIDER_ID,
        displayName: 'IPC journey Provider',
        providerKind: 'fake-video',
        model: PROVIDER_MODEL,
        status: 'ready',
      });
      const created = await ipc.invoke(
        request('project.create', {
          name: 'Harbor IPC Film',
          permissionMode: 'reversible',
          budget,
          formatPolicy,
        }),
      );
      const project = created.result.project;
      expect((await ipc.invoke(request('project.get', { projectId: project.id }))).result.id).toBe(
        project.id,
      );

      const chat = (
        await ipc.invoke(
          request('chat.create', { projectId: project.id, title: 'Harbor production' }),
        )
      ).result;
      const exportDestination = await ipc.invoke(
        request('os.export.pick', {
          chatId: chat.id,
          projectId: project.id,
          deliveryPlan: {
            authority: 'delivery',
            id: 'delivery.ipc.export',
            revision: 1,
            contentHash: 'd'.repeat(64),
          },
          destination: 'file',
          suggestedFileName: 'harbor-final.mp4',
          allowedExtensions: ['mp4'],
        }),
      );
      expect(exportDestination.result).toMatchObject({
        state: 'selected',
        grant: { destination: { kind: 'user_selected_file', displayLabel: 'harbor-final.mp4' } },
      });
      expect(JSON.stringify(exportDestination)).not.toContain(privateWritableGrant);
      if (exportDestination.result.state !== 'selected') {
        throw new Error('Expected the target export picker to select a destination');
      }
      const { kind, grantId, grantHash, displayLabel, deliveryPlan } =
        exportDestination.result.grant.destination;
      const destination = { kind, grantId, grantHash, displayLabel };
      await expect(
        composition.exportDestination.resolve({
          descriptor: destination,
          projectId: project.id,
          chatId: chat.id,
          runId: 'run.ipc.export-destination.1',
          deliveryPlan,
          requiredExtension: 'mp4',
          operationFingerprint: 'a'.repeat(64),
        }),
      ).resolves.toEqual({
        descriptor: destination,
        writableGrant: privateWritableGrant,
      });
      const grant = (
        await ipc.invoke(request('os.media.pick', { kinds: ['image'], multiple: false }))
      ).result;
      const imported = (
        await ipc.invoke(
          request('media.global.import', {
            capabilityToken: grant.capabilityToken,
            displayName: null,
            tags: ['reference'],
          }),
        )
      ).result;
      const currentProject = (await ipc.invoke(request('project.get', { projectId: project.id })))
        .result;
      const attached = (
        await ipc.invoke(
          request('media.project.attach', {
            projectId: project.id,
            expectedProjectRevision: currentProject.revision,
            globalAssetId: imported.asset.id,
            expectedExistingRef: null,
            label: 'Harbor reference',
            collections: ['Locations'],
            roles: ['reference'],
            notes: 'IPC fixture reference.',
          }),
        )
      ).result.object;

      const accepted = (
        await ipc.invoke(
          request('message.send', {
            chatId: chat.id,
            blocks: [{ type: 'text', text: 'Create a harbor sequence.' }],
            attachments: [],
            selectedContext: [],
            supersedesMessageId: null,
            exportDestinationGrant: null,
          }),
        )
      ).result.acceptedRun;
      expect(runtime.notifyDurableRunWork).toHaveBeenCalled();
      expect((await ipc.invoke(request('run.get', { runId: accepted.id }))).result.status).toBe(
        'accepted',
      );

      const deriveStarted = await composition.data.mediaDerivations.start(
        {
          runId: accepted.id,
          commandId: 'command.ipc.media.derive.start',
          input: {
            operation: 'resize',
            source: { kind: 'project_media_ref', id: attached.id },
            expectedSourceHash: imported.asset.blobHash,
            attach: { enabled: false, expectedProjectRevision: null },
            outputIntents: [
              {
                ordinal: 0,
                globalAsset: {
                  filename: 'harbor-reference-960.png',
                  displayName: 'Harbor reference 960',
                  folderId: null,
                  tags: ['derived'],
                },
                projectMediaRef: null,
              },
            ],
            width: 960,
            height: 540,
            fit: 'contain',
          },
        },
        commanderContext(accepted.id),
      );
      const derived = await composition.data.mediaDerivations.continue(
        {
          dispatchOperationId: deriveStarted.operation.id,
          commandId: 'command.ipc.media.derive.continue',
        },
        commanderContext(accepted.id),
      );
      const operation = (
        await ipc.invoke(request('operation.get', { operations: [derived.operation] }))
      ).result.operations[0];
      expect(operation?.ref.id).toBe(derived.operation.id);

      const currentRun = (await ipc.invoke(request('run.get', { runId: accepted.id }))).result;
      expect(currentRun.status).toBe('accepted');
      const stopped = (
        await ipc.invoke(
          request('run.control', {
            runId: accepted.id,
            expectedRevision: currentRun.revision,
            action: 'cancel',
            expectedStatus: 'accepted',
            terminalSummary: 'Stopped by the IPC journey test.',
          }),
        )
      ).result;
      expect(stopped.status).toBe('cancelled');
      expect(sendPush).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 'push',
          method: 'run.events.appended',
          payload: expect.objectContaining({
            event: expect.objectContaining({ runId: accepted.id }),
          }),
        }),
      );
      const persistedEvents = (
        await ipc.invoke(
          request('run.events.list', {
            runId: accepted.id,
            afterSequence: null,
            page: { cursor: null, limit: 100 },
          }),
        )
      ).result.items;
      expect(persistedEvents.length).toBeGreaterThan(0);

      const [overview, production, canvas, media, delivery, results, history, capabilities] =
        await Promise.all([
          ipc.invoke(request('overview.get', { projectId: project.id })),
          ipc.invoke(
            request('production.query', {
              projectId: project.id,
              ids: [],
              types: [],
              includeArchived: false,
              includeFactSources: true,
              page: { cursor: null, limit: 100 },
            }),
          ),
          ipc.invoke(request('canvas.get', { projectId: project.id })),
          ipc.invoke(
            request('media.project.list', {
              projectId: project.id,
              roles: [],
              query: '',
              page: { cursor: null, limit: 100 },
            }),
          ),
          ipc.invoke(
            request('delivery.query', {
              projectId: project.id,
              deliveryPlanIds: [],
              page: { cursor: null, limit: 100 },
            }),
          ),
          ipc.invoke(
            request('result.query', {
              projectId: project.id,
              query: {
                resultIds: [],
                requestIds: [],
                targetRefs: [],
                include: [],
                page: { cursor: null, limit: 100 },
              },
            }),
          ),
          ipc.invoke(
            request('history.query', {
              projectId: project.id,
              order: 'reverse_chronological',
              query: {
                sources: [],
                eventTypes: [],
                subjects: [],
                actors: [],
                time: { from: null, to: null },
                page: { cursor: null, limit: 100 },
              },
            }),
          ),
          ipc.invoke(request('project.capabilities.get', { projectId: project.id })),
        ]);

      expect(overview.result.project.id).toBe(project.id);
      expect(production.result.items).toEqual([]);
      expect(canvas.result.projectId).toBe(project.id);
      expect(media.result.items).toEqual([attached]);
      expect(delivery.result.plans).toEqual([]);
      expect(results.result.items).toEqual([]);
      expect(history.result.items.every((entry) => entry.projectId === project.id)).toBe(true);
      expect(capabilities.result.projectId).toBe(project.id);
      expect(capabilities.result.providers).toEqual([
        expect.objectContaining({ id: PROVIDER_ID, status: 'ready' }),
      ]);
      expect(ipc.ipcMain.handle).toHaveBeenCalledOnce();

      await composition.close();
      const reconnectIpc = ipcFixture();
      const reconnect = await startTargetDesktopComposition({
        ...setup,
        ipcMain: reconnectIpc.ipcMain,
        createPushRequestId: () => `request.ipc.reconnect.push.${++pushRequest}`,
        runEventSink: { send: vi.fn() },
        onInternalError: vi.fn(),
        authorizeInvocation: () => true,
        contextForRequest: (wireRequest) => ({
          actor: 'user',
          causation: { kind: 'direct_ui', actionId: wireRequest.requestId },
          correlationId: `correlation.${wireRequest.requestId}`,
        }),
        createRuntime: () => ({
          recoverAndReconcile: async () => undefined,
          notifyDurableRunWork: () => undefined,
          close: async () => undefined,
        }),
        acceptanceSeedFor: vi.fn() as never,
        pickExportDestination: vi.fn() as never,
        pickMedia: vi.fn() as never,
        reportStartup: vi.fn(),
        dataAccess: setup.dataAccess,
      });
      try {
        const afterFirst = (
          await reconnectIpc.invoke(
            request('run.events.list', {
              runId: accepted.id,
              afterSequence: persistedEvents[0]!.sequence,
              page: { cursor: null, limit: 100 },
            }),
          )
        ).result.items;
        expect(afterFirst).toEqual(persistedEvents.slice(1));
        expect(reconnect.databaseCreated).toBe(false);
        expect(reconnect.builtInSkills.results.every(({ status }) => status === 'unchanged')).toBe(
          true,
        );
      } finally {
        await reconnect.close();
      }
    } finally {
      await composition.close();
    }
  }, 15_000);
});
