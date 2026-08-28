import { LUCID_FIN_WIRE_INVOKE_CHANNEL_V1, type WireRequestV1 } from '@lucid-fin/contracts';
import {
  createDataAccess,
  createMediaPreviewSourceResolver,
  openOrCreateStore,
  type CommandContext,
  type DataAccess,
  type DataAccessOptions,
  type Store,
} from '@lucid-fin/storage';
import {
  createHostConfirmationAuthority,
  createHostInteractionAuthority,
  provisionCanonicalBuiltInSkills,
  type SkillRegistrationBatchResult,
} from '@lucid-fin/storage/host';
import { createWireUseCaseHandlers, type WireUseCaseDependencies } from './ipc/handlers.js';
import {
  createWireRouter,
  registerWireRouter,
  type IpcMainLike,
  type WireErrorDescriptor,
} from './ipc/router.js';
import {
  createPersistedRunEventPublisher,
  type PersistedRunEventPublisher,
  type WirePushSink,
} from './ipc/push-gateway.js';
import {
  createMediaPreviewCapabilityGateway,
  type MediaPreviewCapabilityGateway,
} from './media-preview.js';
import {
  createExportDestinationGateway,
  type ExportDestinationGateway,
  type ExportDestinationPickerAdapter,
} from './export-destination.js';

export type DesktopStartupStage = 'store' | 'skills' | 'recovery' | 'ipc' | 'ready';

export type DesktopStartupState =
  | { readonly status: 'starting'; readonly stage: Exclude<DesktopStartupStage, 'ready'> }
  | {
      readonly status: 'ready';
      readonly databaseCreated: boolean;
      readonly builtInSkillCount: number;
    }
  | {
      readonly status: 'failed';
      readonly stage: Exclude<DesktopStartupStage, 'ready'>;
      readonly code: 'desktop_startup_failed';
      readonly publicSummary: string;
    };

export interface DesktopRuntimeController {
  recoverAndReconcile(): Promise<void>;
  notifyDurableRunWork(): void;
  close(): Promise<void>;
}

export interface DesktopCompositionOptions<Event> extends Pick<
  WireUseCaseDependencies,
  'pickMedia'
> {
  readonly databasePath: string;
  readonly dataAccess: Omit<DataAccessOptions, 'deliveryDestinationGrants'>;
  readonly provisionHost?: (store: Store) => void | Promise<void>;
  readonly acceptanceSeedFor?: WireUseCaseDependencies['acceptanceSeedFor'];
  readonly createAcceptanceSeedFor?: (
    data: DataAccess,
  ) => WireUseCaseDependencies['acceptanceSeedFor'];
  readonly exportDestinationPicker?: ExportDestinationPickerAdapter;
  readonly ipcMain: IpcMainLike<Event>;
  readonly authorizeInvocation: (
    request: WireRequestV1,
    invocation: Event,
  ) => boolean | Promise<boolean>;
  readonly contextForRequest: (
    request: WireRequestV1,
    invocation: Event,
  ) => CommandContext | Promise<CommandContext>;
  readonly createRuntime: (
    data: DataAccess,
    runEvents: PersistedRunEventPublisher,
  ) => DesktopRuntimeController;
  readonly createPushRequestId: () => string;
  readonly runEventSink: WirePushSink;
  readonly reportStartup: (state: DesktopStartupState) => void;
  readonly localizeWireError?: (descriptor: WireErrorDescriptor) => string;
  readonly localizeStartupError?: (stage: Exclude<DesktopStartupStage, 'ready'>) => string;
  readonly onInternalError: (cause: unknown) => void;
}

export interface DesktopComposition {
  readonly data: DataAccess;
  readonly databaseCreated: boolean;
  readonly builtInSkills: SkillRegistrationBatchResult;
  readonly exportDestination: ExportDestinationGateway;
  readonly mediaPreview: MediaPreviewCapabilityGateway;
  readonly store: Store;
  close(): Promise<void>;
}

export class DesktopStartupError extends Error {
  readonly code = 'desktop_startup_failed' as const;
  readonly stage: Exclude<DesktopStartupStage, 'ready'>;

  constructor(
    stage: Exclude<DesktopStartupStage, 'ready'>,
    publicSummary: string,
    options?: ErrorOptions,
  ) {
    super(publicSummary, options);
    this.name = 'DesktopStartupError';
    this.stage = stage;
  }
}

const DEFAULT_STARTUP_SUMMARY = 'Lucid Fin could not start the workspace.';

export async function startDesktopComposition<Event>(
  options: DesktopCompositionOptions<Event>,
): Promise<DesktopComposition> {
  let stage: Exclude<DesktopStartupStage, 'ready'> = 'store';
  let store: Store | undefined;
  let runtime: DesktopRuntimeController | undefined;
  let disposeIpc: (() => void) | undefined;
  let exportDestination: ExportDestinationGateway | undefined;
  let mediaPreview: MediaPreviewCapabilityGateway | undefined;

  const starting = (next: typeof stage) => {
    stage = next;
    options.reportStartup({ status: 'starting', stage });
  };

  try {
    starting('store');
    const opened = await openOrCreateStore(options.databasePath);
    store = opened.store;

    starting('skills');
    const builtInSkills = await provisionCanonicalBuiltInSkills(store);
    await options.provisionHost?.(store);
    exportDestination = createExportDestinationGateway({
      picker: options.exportDestinationPicker,
    });
    const data = createDataAccess(store, {
      ...options.dataAccess,
      deliveryDestinationGrants: exportDestination,
    });
    mediaPreview = createMediaPreviewCapabilityGateway({
      sourceResolver: createMediaPreviewSourceResolver(store, options.dataAccess.mediaCas),
      onInternalError: options.onInternalError,
    });
    const runEvents = createPersistedRunEventPublisher(data.runs, options.runEventSink, {
      createRequestId: options.createPushRequestId,
      onError: options.onInternalError,
    });
    const interaction = createHostInteractionAuthority(store, options.dataAccess);
    const confirmation = createHostConfirmationAuthority(store, options.dataAccess);
    const acceptanceSeedFor = options.createAcceptanceSeedFor?.(data) ?? options.acceptanceSeedFor;
    if (acceptanceSeedFor === undefined) {
      throw new Error('Desktop composition requires a canonical run acceptance seed factory.');
    }

    starting('recovery');
    runtime = options.createRuntime(data, runEvents);
    await runtime.recoverAndReconcile();

    starting('ipc');
    const handlers = createWireUseCaseHandlers({
      data,
      interaction,
      confirmation,
      acceptanceSeedFor,
      pickExportDestination: exportDestination.pick,
      pickMedia: options.pickMedia,
      mediaPreview,
      notifyDurableRunWork: () => runtime?.notifyDurableRunWork(),
      publishPersistedRunHead: (run) => runEvents.publishHead(run),
    });
    const router = createWireRouter(handlers, {
      authorizeInvocation: options.authorizeInvocation,
      contextForRequest: options.contextForRequest,
      localizeError: options.localizeWireError,
      onInternalError: options.onInternalError,
    });
    disposeIpc = registerWireRouter(options.ipcMain, LUCID_FIN_WIRE_INVOKE_CHANNEL_V1, router);

    options.reportStartup({
      status: 'ready',
      databaseCreated: opened.created,
      builtInSkillCount: builtInSkills.results.length,
    });
    runtime.notifyDurableRunWork();

    let closed = false;
    return Object.freeze({
      data,
      databaseCreated: opened.created,
      builtInSkills,
      exportDestination,
      mediaPreview,
      store,
      async close(): Promise<void> {
        if (closed) return;
        closed = true;
        disposeIpc?.();
        disposeIpc = undefined;
        try {
          await runtime?.close();
        } finally {
          exportDestination?.close();
          mediaPreview?.close();
          store?.close();
        }
      },
    });
  } catch (cause) {
    disposeIpc?.();
    try {
      await runtime?.close();
    } catch (closeCause) {
      options.onInternalError(closeCause);
    } finally {
      exportDestination?.close();
      mediaPreview?.close();
      store?.close();
    }
    const publicSummary = options.localizeStartupError?.(stage) ?? DEFAULT_STARTUP_SUMMARY;
    options.reportStartup({
      status: 'failed',
      stage,
      code: 'desktop_startup_failed',
      publicSummary,
    });
    throw new DesktopStartupError(stage, publicSummary, { cause });
  }
}
