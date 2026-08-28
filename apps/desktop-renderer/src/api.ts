import type {
  PublicWireMethodV1,
  DesktopApiV1,
  DesktopResponseV1,
  WireSuccessV1,
} from '@lucid-fin/contracts';

export type WireResult<Method extends PublicWireMethodV1> = Extract<
  WireSuccessV1,
  { readonly method: Method }
>['result'];

export class DesktopApiError extends Error {
  constructor(
    readonly code: Exclude<
      DesktopResponseV1<PublicWireMethodV1>,
      { readonly kind: 'success' }
    >['error']['code'],
    readonly retryable: boolean,
    readonly correlationId: string,
    readonly confirmation: { readonly id: string; readonly immutableInputHash: string } | null,
    publicSummary: string,
  ) {
    super(publicSummary);
    this.name = 'DesktopApiError';
  }
}

export async function wireResult<Method extends PublicWireMethodV1>(
  responsePromise: Promise<DesktopResponseV1<Method>>,
): Promise<WireResult<Method>> {
  const response = await responsePromise;
  if (response.kind === 'success') return response.result as WireResult<Method>;
  throw new DesktopApiError(
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

export function createRequestId(): string {
  requestSequence += 1;
  return `ui.${Date.now()}.${requestSequence}.${crypto.randomUUID()}`;
}

export function getDesktopApi(): DesktopApiV1 | null {
  return window.lucidFin ?? null;
}
