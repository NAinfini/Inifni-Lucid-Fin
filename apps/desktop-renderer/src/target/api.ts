import type {
  PublicWireMethodV1,
  TargetDesktopApiV1,
  TargetDesktopResponseV1,
  WireSuccessV1,
} from '@lucid-fin/target-contracts';

export type TargetResult<Method extends PublicWireMethodV1> = Extract<
  WireSuccessV1,
  { readonly method: Method }
>['result'];

export class TargetApiError extends Error {
  constructor(
    readonly code: Exclude<
      TargetDesktopResponseV1<PublicWireMethodV1>,
      { readonly kind: 'success' }
    >['error']['code'],
    readonly retryable: boolean,
    readonly correlationId: string,
    readonly confirmation: { readonly id: string; readonly immutableInputHash: string } | null,
    publicSummary: string,
  ) {
    super(publicSummary);
    this.name = 'TargetApiError';
  }
}

export async function targetResult<Method extends PublicWireMethodV1>(
  responsePromise: Promise<TargetDesktopResponseV1<Method>>,
): Promise<TargetResult<Method>> {
  const response = await responsePromise;
  if (response.kind === 'success') return response.result as TargetResult<Method>;
  throw new TargetApiError(
    response.error.code,
    response.error.retryable,
    response.error.correlationId,
    response.error.code === 'confirmation_required'
      ? {
          id: response.error.confirmationId,
          immutableInputHash: response.error.immutableInputHash,
        }
      : null,
    response.error.publicSummary,
  );
}

let requestSequence = 0;

export function createTargetRequestId(): string {
  requestSequence += 1;
  return `ui.${Date.now()}.${requestSequence}.${crypto.randomUUID()}`;
}

export function getTargetDesktopApi(): TargetDesktopApiV1 | null {
  return window.lucidTarget ?? null;
}
