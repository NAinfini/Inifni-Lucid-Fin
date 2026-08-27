import { TARGET_WIRE_INVOKE_CHANNEL_V1, type WireRequestV1 } from '@lucid-fin/target-contracts';
import {
  createTargetDataAccess,
  createTargetMediaPreviewSourceResolver,
  openOrCreateTargetStore,
  type TargetCommandContext,
  type TargetDataAccess,
  type TargetDataAccessOptions,
  type TargetStore,
} from '@lucid-fin/target-storage';
import {
  createHostConfirmationAuthority,
  createHostInteractionAuthority,
  provisionCanonicalBuiltInSkills,
  type SkillRegistrationBatchResult,
} from '@lucid-fin/target-storage/host';
import {
  createTargetWireUseCaseHandlers,
  type TargetWireUseCaseDependencies,
} from './ipc/handlers.js';
import {
  createTargetWireRouter,
  registerTargetWireRouter,
  type TargetIpcMainLike,
  type TargetWireErrorDescriptor,
} from './ipc/router.js';
import {
  createTargetPersistedRunEventPublisher,
  type TargetPersistedRunEventPublisher,
  type TargetWirePushSink,
} from './ipc/push-gateway.js';
import {
  createTargetMediaPreviewCapabilityGateway,
  type TargetMediaPreviewCapabilityGateway,
} from './media-preview.js';
import {
  createTargetExportDestinationGateway,
  type TargetExportDestinationGateway,
  type TargetExportDestinationPickerAdapter,
} from './export-destination.js';

export type TargetDesktopStartupStage = 'store' | 'skills' | 'recovery' | 'ipc' | 'ready';

export type TargetDesktopStartupState =
  | { readonly status: 'starting'; readonly stage: Exclude<TargetDesktopStartupStage, 'ready'> }
  | {
      readonly status: 'ready';
      readonly databaseCreated: boolean;
      readonly builtInSkillCount: number;
    }
  | {
      readonly status: 'failed';
      readonly stage: Exclude<TargetDesktopStartupStage, 'ready'>;
      readonly code: 'target_startup_failed';
      readonly publicSummary: string;
    };

export interface TargetDesktopRuntimeController {
  recoverAndReconcile(): Promise<void>;
  notifyDurableRunWork(): void;
  close(): Promise<void>;
}

export interface TargetDesktopCompositionOptions<Event> extends Pick<
  TargetWireUseCaseDependencies,
  'acceptanceSeedFor' | 'pickMedia'
> {
  readonly databasePath: string;
  readonly dataAccess: TargetDataAccessOptions;
  readonly exportDestinationPicker?: TargetExportDestinationPickerAdapter;
  readonly ipcMain: TargetIpcMainLike<Event>;
  readonly authorizeInvocation: (
    request: WireRequestV1,
    invocation: Event,
  ) => boolean | Promise<boolean>;
  readonly contextForRequest: (
    request: WireRequestV1,
    invocation: Event,
  ) => TargetCommandContext | Promise<TargetCommandContext>;
  readonly createRuntime: (
    data: TargetDataAccess,
    runEvents: TargetPersistedRunEventPublisher,
  ) => TargetDesktopRuntimeController;
  readonly createPushRequestId: () => string;
  readonly runEventSink: TargetWirePushSink;
  readonly reportStartup: (state: TargetDesktopStartupState) => void;
  readonly localizeWireError?: (descriptor: TargetWireErrorDescriptor) => string;
  readonly localizeStartupError?: (stage: Exclude<TargetDesktopStartupStage, 'ready'>) => string;
  readonly onInternalError: (cause: unknown) => void;
}

export interface TargetDesktopComposition {
  readonly data: TargetDataAccess;
  readonly databaseCreated: boolean;
  readonly builtInSkills: SkillRegistrationBatchResult;
  readonly exportDestination: TargetExportDestinationGateway;
  readonly mediaPreview: TargetMediaPreviewCapabilityGateway;
  readonly store: TargetStore;
  close(): Promise<void>;
}

export class TargetDesktopStartupError extends Error {
  readonly code = 'target_startup_failed' as const;
  readonly stage: Exclude<TargetDesktopStartupStage, 'ready'>;

  constructor(
    stage: Exclude<TargetDesktopStartupStage, 'ready'>,
    publicSummary: string,
    options?: ErrorOptions,
  ) {
    super(publicSummary, options);
    this.name = 'TargetDesktopStartupError';
    this.stage = stage;
  }
}

const DEFAULT_STARTUP_SUMMARY = 'Lucid Fin could not start the target workspace.';

export async function startTargetDesktopComposition<Event>(
  options: TargetDesktopCompositionOptions<Event>,
): Promise<TargetDesktopComposition> {
  let stage: Exclude<TargetDesktopStartupStage, 'ready'> = 'store';
  let store: TargetStore | undefined;
  let runtime: TargetDesktopRuntimeController | undefined;
  let disposeIpc: (() => void) | undefined;
  let exportDestination: TargetExportDestinationGateway | undefined;
  let mediaPreview: TargetMediaPreviewCapabilityGateway | undefined;

  const starting = (next: typeof stage) => {
    stage = next;
    options.reportStartup({ status: 'starting', stage });
  };

  try {
    starting('store');
    const opened = await openOrCreateTargetStore(options.databasePath);
    store = opened.store;

    starting('skills');
    const builtInSkills = await provisionCanonicalBuiltInSkills(store);
    exportDestination = createTargetExportDestinationGateway({
      picker: options.exportDestinationPicker,
    });
    const data = createTargetDataAccess(store, {
      ...options.dataAccess,
      deliveryDestinationGrants: exportDestination,
    });
    mediaPreview = createTargetMediaPreviewCapabilityGateway({
      sourceResolver: createTargetMediaPreviewSourceResolver(store, options.dataAccess.mediaCas),
      onInternalError: options.onInternalError,
    });
    const runEvents = createTargetPersistedRunEventPublisher(data.runs, options.runEventSink, {
      createRequestId: options.createPushRequestId,
      onError: options.onInternalError,
    });
    const interaction = createHostInteractionAuthority(store, options.dataAccess);
    const confirmation = createHostConfirmationAuthority(store, options.dataAccess);

    starting('recovery');
    runtime = options.createRuntime(data, runEvents);
    await runtime.recoverAndReconcile();

    starting('ipc');
    const handlers = createTargetWireUseCaseHandlers({
      data,
      interaction,
      confirmation,
      acceptanceSeedFor: options.acceptanceSeedFor,
      pickExportDestination: exportDestination.pick,
      pickMedia: options.pickMedia,
      mediaPreview,
      notifyDurableRunWork: () => runtime?.notifyDurableRunWork(),
      publishPersistedRunHead: (run) => runEvents.publishHead(run),
    });
    const router = createTargetWireRouter(handlers, {
      authorizeInvocation: options.authorizeInvocation,
      contextForRequest: options.contextForRequest,
      localizeError: options.localizeWireError,
      onInternalError: options.onInternalError,
    });
    disposeIpc = registerTargetWireRouter(options.ipcMain, TARGET_WIRE_INVOKE_CHANNEL_V1, router);

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
      code: 'target_startup_failed',
      publicSummary,
    });
    throw new TargetDesktopStartupError(stage, publicSummary, { cause });
  }
}
