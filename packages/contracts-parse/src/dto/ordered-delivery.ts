import { z } from 'zod';

const MillisecondsSchema = z.number().finite().int().nonnegative();

export const OrderedDeliveryItemSchema = z
  .object({
    shotId: z.string().trim().min(1),
    selectedVideoHash: z.string().regex(/^[a-f0-9]{64}$/),
    trimInMs: MillisecondsSchema,
    trimOutMs: MillisecondsSchema,
    embeddedAudioEnabled: z.boolean(),
  })
  .strict()
  .superRefine((item, ctx) => {
    if (item.trimOutMs <= item.trimInMs) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['trimOutMs'],
        message: 'trimOutMs must be greater than trimInMs',
      });
    }
  });

export const OrderedDeliverySequenceSchema = z
  .object({
    revision: z.number().int().positive(),
    items: z.array(OrderedDeliveryItemSchema),
    updatedAt: MillisecondsSchema,
  })
  .strict()
  .superRefine((sequence, ctx) => {
    const seen = new Set<string>();
    for (const [index, item] of sequence.items.entries()) {
      if (seen.has(item.shotId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['items', index, 'shotId'],
          message: `Duplicate shotId: ${item.shotId}`,
        });
      }
      seen.add(item.shotId);
    }
  });

export type OrderedDeliveryItemDto = z.infer<typeof OrderedDeliveryItemSchema>;
export type OrderedDeliverySequenceDto = z.infer<typeof OrderedDeliverySequenceSchema>;
