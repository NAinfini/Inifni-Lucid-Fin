/** One selected shot in the Canvas handoff order. Array position is the order. */
export interface OrderedDeliveryItem {
  shotId: string;
  selectedVideoHash: string;
  trimInMs: number;
  trimOutMs: number;
  embeddedAudioEnabled: boolean;
}

/** Canonical, compare-and-set delivery state owned by one Canvas. */
export interface OrderedDeliverySequence {
  revision: number;
  items: OrderedDeliveryItem[];
  updatedAt: number;
}
