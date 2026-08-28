import type { ProviderModel } from '@lucid-fin/contracts';
import type {
  DataAccessOptions,
  GenerationProviderAdapter,
  ResultAssessmentProviderAdapter,
  TranscriptionProviderAdapter,
  TrustedPluginCatalogPort,
} from '@lucid-fin/storage';
import type { WireHandler } from './ipc/router.js';
import { LOCAL_OLLAMA_PROVIDER_ID, ProviderNotConfiguredError } from './production-adapters.js';
import {
  createProductionLocalAdapters,
  type LocalMediaPicker,
} from './production-local-adapters.js';

function notConfigured(): never {
  throw new ProviderNotConfiguredError(LOCAL_OLLAMA_PROVIDER_ID);
}

const emptyTrustedPluginCatalog: TrustedPluginCatalogPort = Object.freeze({
  list: () => Object.freeze([]),
});

function unconfiguredGeneration(): GenerationProviderAdapter {
  return Object.freeze({
    providerKind: LOCAL_OLLAMA_PROVIDER_ID,
    quote: async () => notConfigured(),
    submit: async () => notConfigured(),
    reconcileByIdempotencyKey: async () => notConfigured(),
    cancel: async () => notConfigured(),
  });
}

function unconfiguredTranscription(): TranscriptionProviderAdapter {
  return Object.freeze({
    providerKind: LOCAL_OLLAMA_PROVIDER_ID,
    submit: async () => notConfigured(),
    reconcileByIdempotencyKey: async () => notConfigured(),
    cancel: async () => notConfigured(),
  });
}

function unconfiguredAssessment(): ResultAssessmentProviderAdapter {
  return Object.freeze({
    providerKind: LOCAL_OLLAMA_PROVIDER_ID,
    quote: async () => notConfigured(),
    submit: async () => notConfigured(),
    reconcileByIdempotencyKey: async () => notConfigured(),
    cancel: async () => notConfigured(),
  });
}

export type ProductionDataAccessPorts = Omit<
  DataAccessOptions,
  'mediaCas' | 'privateRecoveryCodec' | 'deliveryDestinationGrants'
>;

export interface ProductionHostPorts {
  readonly dataAccessPorts: ProductionDataAccessPorts;
  readonly pickMedia: WireHandler<'os.media.pick'>;
}

export function createProductionHostPorts(input: {
  readonly model: ProviderModel;
  readonly mediaCas: DataAccessOptions['mediaCas'];
  readonly scratchRoot: string;
  readonly mediaPicker?: LocalMediaPicker;
  readonly now?: () => string;
  readonly createId?: DataAccessOptions['createId'];
}): ProductionHostPorts {
  const local = createProductionLocalAdapters({
    mediaCas: input.mediaCas,
    scratchRoot: input.scratchRoot,
    model: input.model,
    mediaPicker: input.mediaPicker,
    now: () => new Date(input.now?.() ?? Date.now()),
  });
  return Object.freeze({
    pickMedia: local.pickMedia,
    dataAccessPorts: Object.freeze({
      now: input.now,
      createId: input.createId,
      trustedPluginCatalog: emptyTrustedPluginCatalog,
      mediaImportCapabilities: local.mediaImportCapabilities,
      mediaInspector: local.mediaInspector,
      localMediaDerivation: local.localMediaDerivation,
      transcriptionProvider: unconfiguredTranscription(),
      generationProvider: unconfiguredGeneration(),
      providerCapabilitiesResolver: local.providerCapabilitiesResolver,
      resultAssessmentProvider: unconfiguredAssessment(),
      reviewRenderer: local.reviewRenderer,
      deliveryExporter: local.deliveryExporter,
    }),
  });
}
