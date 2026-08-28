import type {
  GenerationOutputIntent,
  GenerationQuote,
  GenerationReferenceBinding,
  GenerationSpec,
  MediaBlob,
  MediaTechnicalFacts,
  PromptAssemblyProvenanceSchema,
  ProviderModel,
  ProviderReceipt,
  ProviderUsage,
  TechnicalValidationSchema,
  z,
} from '@lucid-fin/contracts';

export interface GenerationProviderProfile {
  readonly id: string;
  readonly providerKind: string;
  readonly model: ProviderModel;
}

export interface GenerationProviderQuoteRequest {
  readonly idempotencyKey: string;
  readonly requestHash: string;
  readonly profile: GenerationProviderProfile;
  readonly spec: GenerationSpec;
}

export interface GenerationProviderQuoteResult {
  readonly quote: GenerationQuote;
  readonly estimatedDurationMs: number | null;
  readonly constraints: readonly {
    readonly field:
      'width' | 'height' | 'durationMs' | 'frameRate' | 'outputCount' | 'sampleRateHz' | 'channels';
    readonly normalizedValue: number | boolean;
    readonly message: string;
  }[];
}

export interface GenerationProviderReference {
  readonly binding: GenerationReferenceBinding;
  readonly blob: MediaBlob;
  readonly bytes: AsyncIterable<Uint8Array>;
}

export type GenerationProviderPublication =
  | { readonly state: 'pending'; readonly bytes: AsyncIterable<Uint8Array> }
  | { readonly state: 'published' };

export interface GenerationProviderOutput {
  readonly variantIndex: number;
  readonly blob: {
    readonly hash: string;
    readonly byteLength: number;
    readonly mimeType: string;
    readonly technicalFacts: MediaTechnicalFacts;
    readonly publication: GenerationProviderPublication;
  };
  readonly technicalValidation: z.output<typeof TechnicalValidationSchema>;
}

interface GenerationProviderStateCommon {
  readonly receipt: ProviderReceipt | null;
  readonly usage: ProviderUsage | null;
  readonly outputs: readonly GenerationProviderOutput[];
}

export type GenerationProviderState =
  | { readonly state: 'not_submitted' }
  | (GenerationProviderStateCommon & { readonly state: 'unknown' })
  | (GenerationProviderStateCommon & {
      readonly state: 'submitted';
      readonly receipt: ProviderReceipt;
      readonly outputs: readonly [];
    })
  | (GenerationProviderStateCommon & {
      readonly state: 'succeeded';
      readonly receipt: ProviderReceipt;
      readonly usage: ProviderUsage;
    })
  | (GenerationProviderStateCommon & {
      readonly state: 'failed';
      readonly publicErrorCode: 'provider_failed' | 'execution_failed';
    })
  | (GenerationProviderStateCommon & { readonly state: 'cancelled' });

export interface GenerationProviderSubmitRequest {
  readonly idempotencyKey: string;
  readonly requestHash: string;
  readonly profile: GenerationProviderProfile;
  readonly spec: GenerationSpec;
  readonly quote: GenerationQuote;
  readonly promptProvenance: z.output<typeof PromptAssemblyProvenanceSchema>;
  readonly outputIntents: readonly GenerationOutputIntent[];
  readonly references: readonly GenerationProviderReference[];
}

export interface GenerationProviderReconcileRequest {
  readonly idempotencyKey: string;
  readonly requestHash: string;
  readonly profile: GenerationProviderProfile;
  readonly receipt: ProviderReceipt | null;
}

export interface GenerationProviderCancelRequest extends Omit<
  GenerationProviderReconcileRequest,
  'receipt'
> {
  readonly receipt: ProviderReceipt;
}

export interface GenerationProviderAdapter {
  readonly providerKind: string;
  quote(
    request: GenerationProviderQuoteRequest,
    signal?: AbortSignal,
  ): Promise<GenerationProviderQuoteResult>;
  submit(
    request: GenerationProviderSubmitRequest,
    signal?: AbortSignal,
  ): Promise<GenerationProviderState>;
  reconcileByIdempotencyKey(
    request: GenerationProviderReconcileRequest,
    signal?: AbortSignal,
  ): Promise<GenerationProviderState>;
  cancel(
    request: GenerationProviderCancelRequest,
    signal?: AbortSignal,
  ): Promise<GenerationProviderState>;
}
