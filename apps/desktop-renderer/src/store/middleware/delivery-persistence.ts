import type { OrderedDeliverySequence } from '@lucid-fin/contracts';

export interface DeliveryUpdateRequest {
  canvasId: string;
  expectedRevision: number;
  deliverySequence: OrderedDeliverySequence;
}

export interface DeliveryPersistenceTransport {
  update(request: DeliveryUpdateRequest): Promise<{ deliverySequence: OrderedDeliverySequence }>;
}

export interface DeliveryPersistenceControllerOptions {
  canvasId: string;
  persistedRevision: number;
  transport: DeliveryPersistenceTransport;
  onPersisted: (deliverySequence: OrderedDeliverySequence) => void;
  onFailure: (error: unknown) => void;
  debounceMs?: number;
}

function copySequence(sequence: OrderedDeliverySequence): OrderedDeliverySequence {
  return structuredClone(sequence);
}

/** Serializes adjacent Canvas delivery CAS writes without racing local edits. */
export class DeliveryPersistenceController {
  private readonly canvasId: string;
  private readonly transport: DeliveryPersistenceTransport;
  private readonly onPersisted: (deliverySequence: OrderedDeliverySequence) => void;
  private readonly onFailure: (error: unknown) => void;
  private readonly debounceMs: number;
  private persistedRevision: number;
  private pending: OrderedDeliverySequence | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private inFlight: Promise<void> | null = null;

  constructor(options: DeliveryPersistenceControllerOptions) {
    this.canvasId = options.canvasId;
    this.persistedRevision = options.persistedRevision;
    this.transport = options.transport;
    this.onPersisted = options.onPersisted;
    this.onFailure = options.onFailure;
    this.debounceMs = options.debounceMs ?? 250;
  }

  queue(draft: OrderedDeliverySequence): void {
    this.pending = copySequence(draft);
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.drain();
    }, this.debounceMs);
  }

  get isPending(): boolean {
    return this.pending !== null || this.timer !== null || this.inFlight !== null;
  }

  flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    return this.drain();
  }

  private drain(): Promise<void> {
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.run().finally(() => {
      this.inFlight = null;
      if (this.pending && !this.timer) void this.drain();
    });
    return this.inFlight;
  }

  private async run(): Promise<void> {
    while (this.pending) {
      const draft = this.pending;
      this.pending = null;
      const expectedRevision = this.persistedRevision;
      const deliverySequence = { ...draft, revision: expectedRevision + 1 };

      try {
        const result = await this.transport.update({
          canvasId: this.canvasId,
          expectedRevision,
          deliverySequence,
        });
        this.persistedRevision = result.deliverySequence.revision;
        this.onPersisted(result.deliverySequence);
      } catch (error) {
        this.pending = null;
        this.onFailure(error);
        return;
      }
    }
  }
}
