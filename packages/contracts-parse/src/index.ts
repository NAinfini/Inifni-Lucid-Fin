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
