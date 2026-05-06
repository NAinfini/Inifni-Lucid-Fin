/**
 * Provider health channels — runtime reliability monitoring (R43).
 *
 * Exposes the in-memory provider health status to the renderer via a
 * single invoke channel. No persistence — data resets on app restart.
 */
import { z } from 'zod';
import { defineInvokeChannel } from '../../channels.js';

// ── provider:health ─────────────────────────────────────────────

const ProviderHealthStatusSchema = z.object({
  providerId: z.string(),
  lastSuccess: z.string().optional(),
  lastFailure: z.string().optional(),
  consecutiveFailures: z.number(),
  status: z.enum(['healthy', 'degraded', 'down', 'unknown']),
  totalSuccesses: z.number(),
  totalFailures: z.number(),
});

const ProviderHealthRequest = z.object({}).strict();
const ProviderHealthResponse = z.array(ProviderHealthStatusSchema);

export const providerHealthChannel = defineInvokeChannel({
  channel: 'provider:health',
  request: ProviderHealthRequest,
  response: ProviderHealthResponse,
});

export type ProviderHealthRequest = z.infer<typeof ProviderHealthRequest>;
export type ProviderHealthResponse = z.infer<typeof ProviderHealthResponse>;

// ── provider:health:get ─────────────────────────────────────────

const ProviderHealthGetRequest = z.object({ providerId: z.string() });
const ProviderHealthGetResponse = ProviderHealthStatusSchema;

export const providerHealthGetChannel = defineInvokeChannel({
  channel: 'provider:health:get',
  request: ProviderHealthGetRequest,
  response: ProviderHealthGetResponse,
});

export type ProviderHealthGetRequest = z.infer<typeof ProviderHealthGetRequest>;
export type ProviderHealthGetResponse = z.infer<typeof ProviderHealthGetResponse>;

/** All channels in this domain, for registry discovery. */
export const providerHealthChannels = [providerHealthChannel, providerHealthGetChannel] as const;
