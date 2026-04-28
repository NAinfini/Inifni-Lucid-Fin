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
import { jobChannels } from './channels/batch-05.js';
import { workflowChannels } from './channels/batch-06.js';
import { canvasChannels } from './channels/batch-07.js';
import {
  canvasGenerationChannels,
  canvasGenerationPushChannels,
  presetChannels,
} from './channels/batch-08.js';
import {
  commanderChannels,
  commanderPushChannels,
} from './channels/batch-09.js';
import { seriesChannels } from './channels/batch-11.js';
import {
  folderChannels,
  setFolderChannels,
  processPromptChannels,
} from './channels/batch-12.js';
import {
  appChannels,
  aiChannels,
  assetBatch10Channels,
  assetPushChannels,
  clipboardChannels,
  exportChannels,
  ffmpegChannels,
  importChannels,
  keychainChannels,
  lipsyncChannels,
  loggerChannels,
  renderChannels,
  sessionChannels,
  shellChannels,
  snapshotChannels,
  updaterChannels,
  videoChannels,
  visionChannels,
  aiPushChannels,
  appPushChannels,
  clipboardPushChannels,
  loggerPushChannels,
  refimagePushChannels,
  settingsPushChannels,
  updaterPushChannels,
  videoPushChannels,
} from './channels/batch-10.js';

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

// Batch 5 — job (first batch with push channels)
export * from './channels/batch-05.js';

// Batch 6 — workflow
export * from './channels/batch-06.js';

// Batch 7 — canvas core (non-generation)
export * from './channels/batch-07.js';

// Batch 8 — canvas generation + preset
export * from './channels/batch-08.js';

// Batch 9 — commander:* (invoke + push)
export * from './channels/batch-09.js';

// Batch 10 — tail (app/ai/asset/clipboard/export/ffmpeg/import/ipc/
// keychain/lipsync/logger/render/session/shell/snapshot/updater/video/
// vision + refimage + settings push)
export * from './channels/batch-10.js';

// Batch 11 — series
export * from './channels/batch-11.js';

// Batch 12 — folder + setFolder + processPrompt
export * from './channels/batch-12.js';

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
  ...jobChannels,
  ...workflowChannels,
  ...canvasChannels,
  ...canvasGenerationChannels,
  ...canvasGenerationPushChannels,
  ...presetChannels,
  ...commanderChannels,
  ...commanderPushChannels,
  // Batch 10 — invoke
  ...appChannels,
  ...aiChannels,
  ...assetBatch10Channels,
  ...clipboardChannels,
  ...exportChannels,
  ...ffmpegChannels,
  ...importChannels,
  ...keychainChannels,
  ...lipsyncChannels,
  ...loggerChannels,
  ...renderChannels,
  ...sessionChannels,
  ...shellChannels,
  ...snapshotChannels,
  ...updaterChannels,
  ...videoChannels,
  ...visionChannels,
  // Batch 10 — push
  ...assetPushChannels,
  ...aiPushChannels,
  ...appPushChannels,
  ...clipboardPushChannels,
  ...loggerPushChannels,
  ...refimagePushChannels,
  ...settingsPushChannels,
  ...updaterPushChannels,
  ...videoPushChannels,
  // Batch 11 — series
  ...seriesChannels,
  // Batch 12 — folder + setFolder + processPrompt
  ...folderChannels,
  ...setFolderChannels,
  ...processPromptChannels,
] as const;
