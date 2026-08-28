import type { DeliveryManifest, MediaTechnicalFacts, ReviewCutRequest } from '@lucid-fin/contracts';

export interface LocalRenderedDeliveryBlob {
  readonly hash: string;
  readonly byteLength: number;
  readonly mimeType: string;
  readonly technicalFacts: MediaTechnicalFacts;
  readonly bytes: AsyncIterable<Uint8Array>;
}

export interface LocalReviewRenderOutput {
  readonly blob: LocalRenderedDeliveryBlob;
}

export interface LocalReviewRenderRequest {
  readonly idempotencyKey: string;
  readonly requestHash: string;
  readonly manifest: DeliveryManifest;
  readonly range: ReviewCutRequest['range'];
}

export interface LocalReviewRenderCancelRequest {
  readonly idempotencyKey: string;
  readonly requestHash: string;
}

export type LocalReviewRenderCancelResult =
  | { readonly state: 'cancelled' }
  | { readonly state: 'succeeded'; readonly output: LocalReviewRenderOutput };

export interface LocalReviewRendererAdapter {
  render(request: LocalReviewRenderRequest, signal?: AbortSignal): Promise<LocalReviewRenderOutput>;
  cancel(
    request: LocalReviewRenderCancelRequest,
    signal?: AbortSignal,
  ): Promise<LocalReviewRenderCancelResult>;
}
