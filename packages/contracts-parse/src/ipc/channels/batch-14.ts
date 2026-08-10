/** Capability-scoped OAuth channels. Responses are renderer-safe by construction. */
import { z } from 'zod';
import { defineInvokeChannel, definePushChannel } from '../../channels.js';

export const OAuthProviderTargetSchema = z
  .object({
    provider: z.enum(['chatgpt', 'gemini']),
    capability: z.enum(['llm', 'image', 'video', 'vision']),
  })
  .strict();

const OAuthUsageWindowSchema = z
  .object({
    id: z.string(),
    label: z.string(),
    usedPercent: z.number().min(0).max(100),
    remainingPercent: z.number().min(0).max(100),
    windowDurationMinutes: z.number().positive().optional(),
    resetsAt: z.number().int().positive().optional(),
  })
  .strict();

const OAuthUsageSchema = z.discriminatedUnion('state', [
  z
    .object({
      state: z.literal('available'),
      windows: z.array(OAuthUsageWindowSchema),
      credits: z
        .object({
          hasCredits: z.boolean(),
          unlimited: z.boolean(),
          balance: z.string().optional(),
        })
        .strict()
        .optional(),
    })
    .strict(),
  z
    .object({
      state: z.literal('unavailable'),
      reason: z.string(),
      dashboardUrl: z.string().url().optional(),
    })
    .strict(),
]);

const BaseShape = { target: OAuthProviderTargetSchema } as const;

export const OAuthProviderStatusSchema = z.discriminatedUnion('state', [
  z
    .object({
      ...BaseShape,
      state: z.literal('unavailable'),
      reason: z.string(),
      setupUrl: z.string().url().optional(),
      version: z.string().optional(),
    })
    .strict(),
  z
    .object({ ...BaseShape, state: z.literal('signedOut'), version: z.string().optional() })
    .strict(),
  z
    .object({ ...BaseShape, state: z.literal('signingIn'), version: z.string().optional() })
    .strict(),
  z
    .object({
      ...BaseShape,
      state: z.literal('ready'),
      planType: z.string().nullable().optional(),
      usage: OAuthUsageSchema,
      version: z.string().optional(),
    })
    .strict(),
  z
    .object({
      ...BaseShape,
      state: z.literal('error'),
      code: z.enum([
        'configuration_missing',
        'wrong_auth_mode',
        'capability_unavailable',
        'quota_exhausted',
        'login_cancelled',
        'oauth_failed',
        'protocol_error',
        'process_exited',
      ]),
      message: z.string(),
      retryable: z.boolean(),
      version: z.string().optional(),
    })
    .strict(),
]);

const RequestSchema = z.object({ target: OAuthProviderTargetSchema }).strict();

export const providerOAuthStatusChannel = defineInvokeChannel({
  channel: 'providerOAuth:status',
  request: RequestSchema,
  response: OAuthProviderStatusSchema,
});
export const providerOAuthLoginChannel = defineInvokeChannel({
  channel: 'providerOAuth:login',
  request: RequestSchema,
  response: OAuthProviderStatusSchema,
});
export const providerOAuthCancelLoginChannel = defineInvokeChannel({
  channel: 'providerOAuth:cancelLogin',
  request: RequestSchema,
  response: OAuthProviderStatusSchema,
});
export const providerOAuthLogoutChannel = defineInvokeChannel({
  channel: 'providerOAuth:logout',
  request: RequestSchema,
  response: OAuthProviderStatusSchema,
});
export const providerOAuthChangedChannel = definePushChannel({
  channel: 'providerOAuth:changed',
  payload: OAuthProviderStatusSchema,
});

export type OAuthProviderTarget = z.infer<typeof OAuthProviderTargetSchema>;
export type OAuthProviderStatus = z.infer<typeof OAuthProviderStatusSchema>;
export type ProviderOAuthStatusRequest = z.infer<typeof RequestSchema>;
export type ProviderOAuthStatusResponse = OAuthProviderStatus;
export type ProviderOAuthLoginRequest = z.infer<typeof RequestSchema>;
export type ProviderOAuthLoginResponse = OAuthProviderStatus;
export type ProviderOAuthCancelLoginRequest = z.infer<typeof RequestSchema>;
export type ProviderOAuthCancelLoginResponse = OAuthProviderStatus;
export type ProviderOAuthLogoutRequest = z.infer<typeof RequestSchema>;
export type ProviderOAuthLogoutResponse = OAuthProviderStatus;
export type ProviderOAuthChangedPayload = OAuthProviderStatus;

export const providerOAuthChannels = [
  providerOAuthStatusChannel,
  providerOAuthLoginChannel,
  providerOAuthCancelLoginChannel,
  providerOAuthLogoutChannel,
  providerOAuthChangedChannel,
] as const;
