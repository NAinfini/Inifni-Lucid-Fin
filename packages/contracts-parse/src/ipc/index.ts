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
import { locationChannels, styleChannels, colorStyleChannels } from './channels/batch-03.js';
import { assetContentChannels, assetEntryChannels, storageChannels } from './channels/batch-04.js';
import { taskListChannels } from './channels/batch-06.js';
import { canvasChannels } from './channels/batch-07.js';
import { presetChannels } from './channels/batch-08.js';
import { commanderChannels, commanderPushChannels } from './channels/batch-09.js';
import { folderChannels, setFolderChannels, processPromptChannels } from './channels/batch-12.js';
import { providerHealthChannels } from './channels/batch-13.js';
import { providerOAuthChannels } from './channels/batch-14.js';
import {
  appChannels,
  clipboardChannels,
  ffmpegChannels,
  keychainChannels,
  loggerChannels,
  deliveryPackageChannels,
  reviewCutChannels,
  sessionChannels,
  shellChannels,
  snapshotChannels,
  updaterChannels,
  visionChannels,
  appPushChannels,
  clipboardPushChannels,
  loggerPushChannels,
  settingsPushChannels,
  updaterPushChannels,
} from './channels/batch-10.js';

export { healthPingChannel, healthChannels } from './channels/health.js';
export type { HealthPingRequest, HealthPingResponse } from './channels/health.js';

// Batch 1 — settings + script
export * from './channels/batch-01.js';

// Batch 2 — character + equipment
export * from './channels/batch-02.js';

// Batch 3 — location + style + entity + colorStyle
export * from './channels/batch-03.js';

// Batch 4 — asset + storage
export * from './channels/batch-04.js';

// Batch 6 — persistent task lists and human approval gates
export * from './channels/batch-06.js';

// Batch 7 — canvas core (non-generation)
export * from './channels/batch-07.js';

// Batch 8 — canvas generation + preset
export * from './channels/batch-08.js';

// Batch 9 — commander:* (invoke + push)
export * from './channels/batch-09.js';

// Batch 10 — tail (app/ai/asset/clipboard/export/ffmpeg/import/ipc/
// keychain/logger/render/session/shell/snapshot/updater/video/
// vision + settings push)
export * from './channels/batch-10.js';

// Batch 12 — folder + setFolder + processPrompt
export * from './channels/batch-12.js';

// Batch 13 — provider health
export * from './channels/batch-13.js';

// Batch 14 — capability-scoped provider OAuth
export * from './channels/batch-14.js';

/** Every channel known to the registry, concatenated for codegen. */
export const allChannels = [
  ...healthChannels,
  ...settingsChannels,
  ...scriptChannels,
  ...characterChannels,
  ...equipmentChannels,
  ...locationChannels,
  ...styleChannels,
  ...colorStyleChannels,
  ...assetEntryChannels,
  ...assetContentChannels,
  ...storageChannels,
  ...taskListChannels,
  ...canvasChannels,
  ...presetChannels,
  ...commanderChannels,
  ...commanderPushChannels,
  // Batch 10 — invoke
  ...appChannels,
  ...clipboardChannels,
  ...ffmpegChannels,
  ...keychainChannels,
  ...loggerChannels,
  ...deliveryPackageChannels,
  ...reviewCutChannels,
  ...sessionChannels,
  ...shellChannels,
  ...snapshotChannels,
  ...updaterChannels,
  ...visionChannels,
  // Batch 10 — push
  ...appPushChannels,
  ...clipboardPushChannels,
  ...loggerPushChannels,
  ...settingsPushChannels,
  ...updaterPushChannels,
  // Batch 12 — folder + setFolder + processPrompt
  ...folderChannels,
  ...setFolderChannels,
  ...processPromptChannels,
  // Batch 13 — provider health
  ...providerHealthChannels,
  // Batch 14 — capability-scoped provider OAuth
  ...providerOAuthChannels,
] as const;
