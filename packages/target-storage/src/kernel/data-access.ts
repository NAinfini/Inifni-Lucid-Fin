import type { TargetStore } from './store.js';
import type { MediaCas, MediaImportCapabilityResolver } from './media-cas.js';
import type { MediaInspectionAdapter } from './media-inspector.js';
import type {
  LocalMediaDerivationAdapter,
  TranscriptionProviderAdapter,
} from './media-derivation-adapters.js';
import type { GenerationProviderAdapter } from './generation-provider.js';
import type { ProviderCapabilitiesResolver } from './provider-capabilities.js';
import type { ResultAssessmentProviderAdapter } from './result-assessment-provider.js';
import type { LocalReviewRendererAdapter } from './local-review-renderer.js';
import type { PrivateRecoveryCodec } from './private-recovery-codec.js';
import type {
  DeliveryDestinationGrantResolver,
  LocalDeliveryExporterAdapter,
} from './local-delivery-exporter.js';
import {
  resolveTargetStorageEnvironment,
  type TargetStorageEnvironmentOptions,
} from '../internal/environment.js';
import { createProjectsAuthority, type ProjectsAuthority } from '../authorities/projects.js';
import {
  createPluginPackagesAuthority,
  type PluginPackagesAuthority,
  type TrustedPluginCatalogPort,
} from '../authorities/plugins.js';
import {
  createConversationsAuthority,
  type ConversationAuthority,
} from '../authorities/conversations.js';
import {
  createProjectMediaAuthority,
  type ProjectMediaAuthority,
} from '../authorities/project-media.js';
import {
  createGlobalMediaAuthority,
  type GlobalMediaAuthority,
} from '../authorities/global-media.js';
import { createProductionAuthority, type ProductionAuthority } from '../authorities/production.js';
import {
  createUserChoicesAuthority,
  type UserChoicesAuthority,
} from '../authorities/user-choices.js';
import { createCanvasAuthority, type CanvasAuthority } from '../authorities/canvas.js';
import { createRunsAuthority, type RunsAuthority } from '../authorities/runs.js';
import {
  createHarnessPersistenceAuthority,
  settleRunControlActivationInTransaction,
  type HarnessPersistenceAuthority,
} from '../authorities/harness-runtime.js';
import { createTaskListsAuthority, type TaskListsAuthority } from '../authorities/task-lists.js';
import {
  createCompactionsAuthority,
  type CompactionsAuthority,
} from '../authorities/compactions.js';
import { createOperationsAuthority, type OperationsAuthority } from '../authorities/operations.js';
import {
  createMediaDerivationsAuthority,
  type MediaDerivationsAuthority,
} from '../authorities/media-derivations.js';
import {
  createMediaInspectionAuthority,
  type MediaInspectionAuthority,
} from '../authorities/media-inspection.js';
import { createGenerationAuthority, type GenerationAuthority } from '../authorities/generation.js';
import {
  createProviderCapabilitiesAuthority,
  type ProviderCapabilitiesAuthority,
} from '../authorities/provider-capabilities.js';
import {
  createResultAssessmentsAuthority,
  type ResultAssessmentsAuthority,
} from '../authorities/result-assessments.js';
import { createDeliveryAuthority, type DeliveryAuthority } from '../authorities/delivery.js';
import {
  createDeliveryOperationsAuthority,
  type DeliveryOperationsAuthority,
} from '../authorities/delivery-operations.js';
import {
  createProjectHistoryReadModel,
  type ProjectHistoryReadModel,
} from '../read-models/history.js';
import {
  createProjectCapabilitiesReadModel,
  type ProjectCapabilitiesReadModel,
} from '../read-models/project-capabilities.js';
import {
  createProjectMemoryReadModel,
  type ProjectMemoryReadModel,
} from '../read-models/memory.js';
import {
  createProjectSearchReadModel,
  type ProjectSearchReadModel,
} from '../read-models/search.js';
import { createMediaQueryReadModel, type MediaQueryReadModel } from '../read-models/media.js';
import { createRunReplayReadModel, type RunReplayReadModel } from '../read-models/run-replay.js';
import {
  createProjectResultsReadModel,
  type ProjectResultsReadModel,
} from '../read-models/results.js';
import {
  createProjectOverviewReadModel,
  type ProjectOverviewReadModel,
} from '../read-models/overview.js';
import {
  createRunSchedulingReadModel,
  type RunSchedulingReadModel,
} from '../read-models/scheduling.js';

export interface TargetDataAccess {
  readonly projects: ProjectsAuthority;
  readonly plugins: PluginPackagesAuthority;
  readonly globalMedia: GlobalMediaAuthority;
  readonly conversations: ConversationAuthority;
  readonly projectMedia: ProjectMediaAuthority;
  readonly production: ProductionAuthority;
  readonly userChoices: UserChoicesAuthority;
  readonly canvas: CanvasAuthority;
  readonly runs: RunsAuthority;
  readonly harness: HarnessPersistenceAuthority;
  readonly taskLists: TaskListsAuthority;
  readonly compactions: CompactionsAuthority;
  readonly operations: OperationsAuthority;
  readonly mediaDerivations: MediaDerivationsAuthority;
  readonly mediaInspection: MediaInspectionAuthority;
  readonly generation: GenerationAuthority;
  readonly providerCapabilities: ProviderCapabilitiesAuthority;
  readonly resultAssessments: ResultAssessmentsAuthority;
  readonly delivery: DeliveryAuthority;
  readonly deliveryOperations: DeliveryOperationsAuthority;
  readonly runReplay: RunReplayReadModel;
  readonly projectCapabilities: ProjectCapabilitiesReadModel;
  readonly history: ProjectHistoryReadModel;
  readonly search: ProjectSearchReadModel;
  readonly media: MediaQueryReadModel;
  readonly memory: ProjectMemoryReadModel;
  readonly results: ProjectResultsReadModel;
  readonly overview: ProjectOverviewReadModel;
  readonly scheduling: RunSchedulingReadModel;
}

export interface TargetDataAccessOptions extends TargetStorageEnvironmentOptions {
  readonly trustedPluginCatalog?: TrustedPluginCatalogPort;
  readonly privateRecoveryCodec: PrivateRecoveryCodec;
  readonly mediaCas: MediaCas;
  readonly mediaImportCapabilities: MediaImportCapabilityResolver;
  readonly mediaInspector: MediaInspectionAdapter;
  readonly localMediaDerivation: LocalMediaDerivationAdapter;
  readonly transcriptionProvider: TranscriptionProviderAdapter;
  readonly generationProvider: GenerationProviderAdapter;
  readonly providerCapabilitiesResolver: ProviderCapabilitiesResolver;
  readonly resultAssessmentProvider: ResultAssessmentProviderAdapter;
  readonly reviewRenderer: LocalReviewRendererAdapter;
  readonly deliveryExporter: LocalDeliveryExporterAdapter;
  readonly deliveryDestinationGrants: DeliveryDestinationGrantResolver;
}

export function createTargetDataAccess(
  store: TargetStore,
  options: TargetDataAccessOptions,
): TargetDataAccess {
  const environment = resolveTargetStorageEnvironment(options);
  const delivery = createDeliveryAuthority(store, environment);
  const runs = createRunsAuthority(
    store,
    environment,
    options.privateRecoveryCodec,
    settleRunControlActivationInTransaction,
  );
  return Object.freeze({
    projects: createProjectsAuthority(store, environment),
    plugins: createPluginPackagesAuthority(store, environment, options.trustedPluginCatalog),
    globalMedia: createGlobalMediaAuthority(
      store,
      environment,
      options.mediaCas,
      options.mediaImportCapabilities,
    ),
    conversations: createConversationsAuthority(store, environment),
    projectMedia: createProjectMediaAuthority(store, environment),
    production: createProductionAuthority(store, environment),
    userChoices: createUserChoicesAuthority(store, environment),
    canvas: createCanvasAuthority(store, environment),
    runs,
    harness: createHarnessPersistenceAuthority(
      store,
      environment,
      runs,
      options.privateRecoveryCodec,
    ),
    taskLists: createTaskListsAuthority(store, environment),
    compactions: createCompactionsAuthority(store, environment),
    operations: createOperationsAuthority(store, environment),
    mediaDerivations: createMediaDerivationsAuthority(
      store,
      environment,
      options.mediaCas,
      options.localMediaDerivation,
      options.transcriptionProvider,
    ),
    mediaInspection: createMediaInspectionAuthority(
      store,
      options.mediaCas,
      options.mediaInspector,
    ),
    generation: createGenerationAuthority(
      store,
      environment,
      options.mediaCas,
      options.generationProvider,
    ),
    providerCapabilities: createProviderCapabilitiesAuthority(
      store,
      options.providerCapabilitiesResolver,
    ),
    resultAssessments: createResultAssessmentsAuthority(
      store,
      environment,
      options.resultAssessmentProvider,
    ),
    delivery,
    deliveryOperations: createDeliveryOperationsAuthority(
      store,
      environment,
      options.mediaCas,
      delivery,
      options.reviewRenderer,
      options.deliveryDestinationGrants,
      options.deliveryExporter,
    ),
    runReplay: createRunReplayReadModel(store),
    projectCapabilities: createProjectCapabilitiesReadModel(store),
    history: createProjectHistoryReadModel(store),
    search: createProjectSearchReadModel(store),
    media: createMediaQueryReadModel(store),
    memory: createProjectMemoryReadModel(store),
    results: createProjectResultsReadModel(store),
    overview: createProjectOverviewReadModel(store),
    scheduling: createRunSchedulingReadModel(store),
  });
}
