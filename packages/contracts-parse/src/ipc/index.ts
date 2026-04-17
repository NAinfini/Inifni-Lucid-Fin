/**
 * Channel registry — single source of truth for all IPC channel definitions.
 *
 * Phase B adds batches 1–10 here. Phase A only seeds `health:*`.
 *
 * The `allChannels` array is what `scripts/gen-preload.ts` consumes to emit
 * the preload bundle and the pure-type `LucidAPI` interface.
 */
import { healthChannels } from './channels/health.js';

export { healthPingChannel, healthChannels } from './channels/health.js';
export type {
  HealthPingRequest,
  HealthPingResponse,
} from './channels/health.js';

/** Every channel known to the registry, concatenated for codegen. */
export const allChannels = [
  ...healthChannels,
  // Phase B-1 batches append here.
] as const;
