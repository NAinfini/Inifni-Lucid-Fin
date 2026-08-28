import type {
  DomainObjectRef,
  EvaluationInputSchema,
  FinalAssessmentSchema,
  MediaBlob,
  ProviderModel,
  ProviderReceipt,
  ProviderUsage,
  ResourceAmount,
  z,
} from '@lucid-fin/contracts';

export interface ResultAssessmentProviderProfile {
  readonly id: string;
  readonly providerKind: string;
  readonly model: ProviderModel;
}

export interface ResultAssessmentProviderSubject {
  readonly role: 'subject' | 'reference';
  readonly ref: DomainObjectRef;
  readonly blob: MediaBlob | null;
}

export interface ResultAssessmentProviderQuoteRequest {
  readonly idempotencyKey: string;
  readonly requestHash: string;
  readonly profile: ResultAssessmentProviderProfile;
  readonly request: z.output<typeof EvaluationInputSchema>;
  readonly subjects: readonly ResultAssessmentProviderSubject[];
}

export interface ResultAssessmentProviderQuoteResult {
  readonly cost: ResourceAmount;
}

export interface ResultAssessmentProviderEvidence {
  readonly findings: z.output<typeof FinalAssessmentSchema>['findings'];
  readonly limitations: z.output<typeof FinalAssessmentSchema>['limitations'];
  readonly recommendations: z.output<typeof FinalAssessmentSchema>['recommendations'];
  readonly artifacts: z.output<typeof FinalAssessmentSchema>['artifacts'];
}

interface ResultAssessmentProviderStateCommon {
  readonly receipt: ProviderReceipt | null;
  readonly usage: ProviderUsage | null;
}

export type ResultAssessmentProviderState =
  | { readonly state: 'not_submitted' }
  | (ResultAssessmentProviderStateCommon & { readonly state: 'unknown' })
  | (ResultAssessmentProviderStateCommon & {
      readonly state: 'submitted';
      readonly receipt: ProviderReceipt;
      readonly usage: null;
    })
  | (ResultAssessmentProviderStateCommon & {
      readonly state: 'succeeded';
      readonly receipt: ProviderReceipt;
      readonly usage: ProviderUsage;
      readonly assessment: ResultAssessmentProviderEvidence;
    })
  | (ResultAssessmentProviderStateCommon & {
      readonly state: 'failed';
      readonly publicErrorCode: 'provider_failed' | 'execution_failed';
    })
  | (ResultAssessmentProviderStateCommon & { readonly state: 'cancelled' });

export type ResultAssessmentProviderSubmitRequest = ResultAssessmentProviderQuoteRequest;

export interface ResultAssessmentProviderReconcileRequest {
  readonly idempotencyKey: string;
  readonly requestHash: string;
  readonly profile: ResultAssessmentProviderProfile;
  readonly receipt: ProviderReceipt | null;
}

export interface ResultAssessmentProviderCancelRequest extends Omit<
  ResultAssessmentProviderReconcileRequest,
  'receipt'
> {
  readonly receipt: ProviderReceipt;
}

export interface ResultAssessmentProviderAdapter {
  readonly providerKind: string;
  quote(
    request: ResultAssessmentProviderQuoteRequest,
    signal?: AbortSignal,
  ): Promise<ResultAssessmentProviderQuoteResult>;
  submit(
    request: ResultAssessmentProviderSubmitRequest,
    signal?: AbortSignal,
  ): Promise<ResultAssessmentProviderState>;
  reconcileByIdempotencyKey(
    request: ResultAssessmentProviderReconcileRequest,
    signal?: AbortSignal,
  ): Promise<ResultAssessmentProviderState>;
  cancel(
    request: ResultAssessmentProviderCancelRequest,
    signal?: AbortSignal,
  ): Promise<ResultAssessmentProviderState>;
}
