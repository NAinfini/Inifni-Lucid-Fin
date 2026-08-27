import type {
  DeliveryDestinationIntentSchema,
  DeliveryManifest,
  z,
} from '@lucid-fin/target-contracts';
import type { LocalRenderedDeliveryBlob } from './local-review-renderer.js';

type DeliveryDestinationIntent = z.output<typeof DeliveryDestinationIntentSchema>;

export interface ResolvedDeliveryDestinationGrant {
  readonly descriptor: DeliveryDestinationIntent;
  readonly writableGrant: unknown;
}

export interface ResolveDeliveryDestinationGrantRequest {
  readonly descriptor: DeliveryDestinationIntent;
  readonly projectId: string;
  readonly chatId: string;
  readonly runId: string;
  readonly deliveryPlan: DeliveryManifest['sourcePlan'];
  readonly requiredExtension: DeliveryManifest['formatIntent']['container'];
  readonly operationFingerprint: string;
}

export interface DeliveryDestinationGrantResolver {
  resolve(
    request: ResolveDeliveryDestinationGrantRequest,
  ): Promise<ResolvedDeliveryDestinationGrant>;
}

export interface LocalDeliveryExportRequest {
  readonly idempotencyKey: string;
  readonly requestHash: string;
  readonly manifest: DeliveryManifest;
  readonly destination: DeliveryDestinationIntent;
  readonly writableGrant: unknown;
  readonly overwriteExisting: boolean;
}

export interface LocalDeliveryExportOutput {
  readonly blob: LocalRenderedDeliveryBlob;
  readonly outputContentHash: string;
}

export interface LocalDeliveryExportCancelRequest {
  readonly idempotencyKey: string;
  readonly requestHash: string;
}

export type LocalDeliveryExportCancelResult =
  | { readonly state: 'cancelled' }
  | { readonly state: 'succeeded'; readonly output: LocalDeliveryExportOutput };

export interface LocalDeliveryExporterAdapter {
  export(
    request: LocalDeliveryExportRequest,
    signal?: AbortSignal,
  ): Promise<LocalDeliveryExportOutput>;
  cancel(
    request: LocalDeliveryExportCancelRequest,
    signal?: AbortSignal,
  ): Promise<LocalDeliveryExportCancelResult>;
}
