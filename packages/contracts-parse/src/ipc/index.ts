/**
 * Channel registry — single source of truth for all IPC channel definitions.
 *
 * Phase B adds batches 1–10 here. Phase A only seeds `health:*`.
 *
 * The `allChannels` array is what `scripts/gen-preload.ts` consumes to emit
 * the preload bundle and the pure-type `LucidAPI` interface.
 */
import { healthChannels } from './channels/health.js';
import { settingsChannels, scriptChannels } from './channels/batch-01.js';
import { characterChannels, equipmentChannels } from './channels/batch-02.js';
import {
  locationChannels,
  styleChannels,
  entityChannels,
  colorStyleChannels,
} from './channels/batch-03.js';
import { assetChannels, storageChannels } from './channels/batch-04.js';

export { healthPingChannel, healthChannels } from './channels/health.js';
export type {
  HealthPingRequest,
  HealthPingResponse,
} from './channels/health.js';

// Batch 1 — settings + script
export * from './channels/batch-01.js';

// Batch 2 — character + equipment
export * from './channels/batch-02.js';

// Batch 3 — location + style + entity + colorStyle
export * from './channels/batch-03.js';

// Batch 4 — asset + storage
export * from './channels/batch-04.js';

/** Every channel known to the registry, concatenated for codegen. */
export const allChannels = [
  ...healthChannels,
  ...settingsChannels,
  ...scriptChannels,
  ...characterChannels,
  ...equipmentChannels,
  ...locationChannels,
  ...styleChannels,
  ...entityChannels,
  ...colorStyleChannels,
  ...assetChannels,
  ...storageChannels,
] as const;
