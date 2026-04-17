/**
 * Health-check channels — Phase A codegen sample.
 *
 * These are the first channels migrated to the new registry to seed the
 * codegen pipeline. Phase B migrates the remaining 97.
 */
import { z } from 'zod';
import { defineInvokeChannel } from '../../channels.js';

export const healthPingChannel = defineInvokeChannel({
  channel: 'health:ping',
  request: z.object({}),
  response: z.object({ ok: z.literal(true), uptime: z.number() }),
});

/** All channels in this domain, for registry discovery. */
export const healthChannels = [healthPingChannel] as const;
