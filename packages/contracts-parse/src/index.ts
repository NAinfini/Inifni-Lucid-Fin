export { unsafeBrand } from './brand.js';
export {
  parseStrict,
  parseOrDegrade,
  parsePartial,
  makeBrandParser,
  makeTryBrand,
  setDegradeReporter,
  z,
  type DegradeReporter,
  type ParseContext,
} from './parse.js';

// IPC channel factories
export {
  defineInvokeChannel,
  definePushChannel,
  defineReplyChannel,
  type InvokeChannelDef,
  type PushChannelDef,
  type ReplyChannelDef,
} from './channels.js';

// Tool factory
export {
  defineTool,
  type ToolDef,
  type ToolRunContext,
  type ToolEvent,
} from './tools.js';

// Table factory
export { defineTable, col } from './tables.js';

// Channel registry (seed — Phase B batches append here)
export {
  allChannels,
  healthPingChannel,
  healthChannels,
  type HealthPingRequest,
  type HealthPingResponse,
} from './ipc/index.js';

// Batch 1 — settings + script
export * from './ipc/channels/batch-01.js';

// Batch 2 — character + equipment
export * from './ipc/channels/batch-02.js';

// Batch 3 — location + style + entity + colorStyle
export * from './ipc/channels/batch-03.js';

// Batch 4 — asset + storage
export * from './ipc/channels/batch-04.js';

// Batch 5 — job
export * from './ipc/channels/batch-05.js';

// Batch 6 — workflow
export * from './ipc/channels/batch-06.js';

// Batch 7 — canvas core (non-generation)
export * from './ipc/channels/batch-07.js';

// Batch 8 — canvas generation + preset
export * from './ipc/channels/batch-08.js';

// Batch 9 — commander:* (invoke + push)
export * from './ipc/channels/batch-09.js';

// Batch 10 — tail of Phase B-1 (app/ai/asset/clipboard/export/ffmpeg/
// import/ipc/keychain/lipsync/logger/render/session/shell/snapshot/
// updater/video/vision + refimage push + settings push)
export * from './ipc/channels/batch-10.js';

// ── Phase C-1: Agent / tool catalog ────────────────────────────
// `defineTool` and its types are re-exported above from `./tools.js`; the
// agent barrel adds `createCatalog` on top without duplicating them.
export { createCatalog } from './agent/catalog.js';
