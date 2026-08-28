import type {
  MediaBlob,
  MediaDerivationTransform,
  MediaTechnicalFacts,
  ProviderModel,
  ProviderReceipt,
  ProviderUsage,
} from '@lucid-fin/contracts';

export type LocalMediaDerivationTransform = Exclude<
  MediaDerivationTransform,
  { readonly operation: 'transcribe' }
>;

export type TranscriptionTransform = Extract<
  MediaDerivationTransform,
  { readonly operation: 'transcribe' }
>;

export type MediaDerivationPublication =
  | { readonly state: 'pending'; readonly bytes: AsyncIterable<Uint8Array> }
  | { readonly state: 'published' };

export interface MediaDerivationAdapterOutput {
  readonly ordinal: number;
  readonly blob: {
    readonly hash: string;
    readonly byteLength: number;
    readonly mimeType: string;
    readonly technicalFacts: MediaTechnicalFacts;
    readonly publication: MediaDerivationPublication;
  };
}

export interface LocalMediaDerivationRequest {
  readonly idempotencyKey: string;
  readonly requestHash: string;
  readonly source: {
    readonly blob: MediaBlob;
    readonly bytes: AsyncIterable<Uint8Array>;
  };
  readonly transform: LocalMediaDerivationTransform;
  readonly outputCount: number;
  readonly cancellationRequested: () => boolean;
}

export interface LocalMediaDerivationCancelRequest {
  readonly idempotencyKey: string;
  readonly requestHash: string;
}

export interface LocalMediaDerivationAdapter {
  derive(
    request: LocalMediaDerivationRequest,
    signal?: AbortSignal,
  ): Promise<readonly MediaDerivationAdapterOutput[]>;
  cancel(
    request: LocalMediaDerivationCancelRequest,
    signal?: AbortSignal,
  ): Promise<{ readonly state: 'cancelled' }>;
}

export interface TranscriptionProviderProfile {
  readonly id: string;
  readonly providerKind: string;
  readonly model: ProviderModel;
}

export interface TranscriptionProviderSource {
  readonly blob: MediaBlob;
  readonly bytes: AsyncIterable<Uint8Array>;
}

export interface TranscriptionProviderSubmitRequest {
  readonly idempotencyKey: string;
  readonly requestHash: string;
  readonly profile: TranscriptionProviderProfile;
  readonly source: TranscriptionProviderSource;
  readonly transform: TranscriptionTransform;
}

export interface TranscriptionProviderReconcileRequest {
  readonly idempotencyKey: string;
  readonly requestHash: string;
  readonly profile: TranscriptionProviderProfile;
  readonly receipt: ProviderReceipt | null;
}

export interface TranscriptionProviderCancelRequest extends Omit<
  TranscriptionProviderReconcileRequest,
  'receipt'
> {
  readonly receipt: ProviderReceipt;
}

interface TranscriptionProviderObservedState {
  readonly receipt: ProviderReceipt | null;
  readonly usage: ProviderUsage | null;
  readonly outputs: readonly [];
}

export type TranscriptionProviderState =
  | { readonly state: 'not_submitted' }
  | (TranscriptionProviderObservedState & { readonly state: 'unknown' })
  | (TranscriptionProviderObservedState & {
      readonly state: 'submitted';
      readonly receipt: ProviderReceipt;
    })
  | {
      readonly state: 'succeeded';
      readonly receipt: ProviderReceipt;
      readonly usage: ProviderUsage;
      readonly outputs: readonly [MediaDerivationAdapterOutput];
    }
  | (TranscriptionProviderObservedState & {
      readonly state: 'failed';
      readonly publicErrorCode: 'provider_failed' | 'execution_failed';
    })
  | (TranscriptionProviderObservedState & { readonly state: 'cancelled' });

export interface TranscriptionProviderAdapter {
  readonly providerKind: string;
  submit(
    request: TranscriptionProviderSubmitRequest,
    signal?: AbortSignal,
  ): Promise<TranscriptionProviderState>;
  reconcileByIdempotencyKey(
    request: TranscriptionProviderReconcileRequest,
    signal?: AbortSignal,
  ): Promise<TranscriptionProviderState>;
  cancel(
    request: TranscriptionProviderCancelRequest,
    signal?: AbortSignal,
  ): Promise<TranscriptionProviderState>;
}
