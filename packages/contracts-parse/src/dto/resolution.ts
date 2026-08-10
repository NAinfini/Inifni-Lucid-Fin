import { z } from 'zod';

const OptionalAspectRatioSchema = z.string().trim().min(1).optional();

export const ResolutionIntentSchema = z.discriminatedUnion('mode', [
  z
    .object({
      mode: z.literal('provider-default'),
      aspectRatio: OptionalAspectRatioSchema,
    })
    .strict(),
  z
    .object({
      mode: z.literal('exact'),
      width: z.number().int().positive(),
      height: z.number().int().positive(),
    })
    .strict(),
  z
    .object({
      mode: z.literal('tier'),
      tier: z.string().trim().min(1),
      aspectRatio: OptionalAspectRatioSchema,
    })
    .strict(),
]);

export const ResolutionPolicySchema = z
  .object({
    referenceImage: ResolutionIntentSchema.optional(),
    image: ResolutionIntentSchema.optional(),
    video: ResolutionIntentSchema.optional(),
  })
  .strict();

export const ResolvedResolutionSchema = z
  .object({
    source: z.enum(['node', 'canvas', 'provider']),
    requested: ResolutionIntentSchema,
    providerId: z.string().min(1),
    mediaType: z.enum(['image', 'video']),
    width: z.number().int().positive().optional(),
    height: z.number().int().positive().optional(),
    tier: z.string().min(1).optional(),
    aspectRatio: z.string().min(1).optional(),
    providerValue: z.string().min(1).optional(),
    outputKnown: z.boolean(),
  })
  .strict();

export const ResolutionAuditSchema = z
  .object({
    requested: ResolutionIntentSchema,
    resolved: ResolvedResolutionSchema,
    actual: z
      .object({
        width: z.number().int().positive(),
        height: z.number().int().positive(),
      })
      .strict()
      .optional(),
    estimatedCostUsd: z.number().nonnegative().optional(),
    reportedActualCostUsd: z.number().nonnegative().optional(),
  })
  .strict();

export type ResolutionIntentDto = z.infer<typeof ResolutionIntentSchema>;
export type ResolutionPolicyDto = z.infer<typeof ResolutionPolicySchema>;
export type ResolutionAuditDto = z.infer<typeof ResolutionAuditSchema>;
