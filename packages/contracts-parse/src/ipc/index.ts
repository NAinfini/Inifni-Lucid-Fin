/**
 * Channel registry — single source of truth for all IPC channel definitions.
 *
 * Phase B adds batches 1–10 here. Phase A only seeds `health:*`.
 */
export { healthPingChannel, healthChannels } from './channels/health.js';
