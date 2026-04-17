/**
 * Health-check channels — Phase A codegen sample.
 *
 * These are the first channels migrated to the new registry to seed the
 * codegen pipeline. Phase B migrates the remaining 97.
 */
import { z } from 'zod';
import { defineInvokeChannel } from '../../channels.js';

const HealthPingRequest = z.object({});
const HealthPingResponse = z.object({ ok: z.literal(true), uptime: z.number() });

export const healthPingChannel = defineInvokeChannel({
  channel: 'health:ping',
  request: HealthPingRequest,
  response: HealthPingResponse,
});

export type HealthPingRequest = z.infer<typeof HealthPingRequest>;
export type HealthPingResponse = z.infer<typeof HealthPingResponse>;

/** All channels in this domain, for registry discovery. */
export const healthChannels = [healthPingChannel] as const;
