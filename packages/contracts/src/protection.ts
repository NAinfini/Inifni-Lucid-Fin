import { z } from 'zod';
import { strictObject } from './canonical.js';
import { EntityIdSchema, IsoTimestampSchema } from './primitives.js';

export const ProductionProtectedFieldRefSchema = strictObject({
  owner: z.literal('production'),
  objectId: EntityIdSchema,
  field: z.enum(['content', 'relations', 'lifecycle']),
});
export const ProductionResultDecisionProtectedFieldRefSchema = strictObject({
  owner: z.literal('production'),
  objectId: EntityIdSchema,
  field: z.literal('resultDecision'),
  resultId: EntityIdSchema,
});
export const DeliveryPlanProtectedFieldRefSchema = strictObject({
  owner: z.literal('delivery'),
  deliveryId: EntityIdSchema,
  field: z.enum(['name', 'lifecycle', 'sequence', 'formatIntent']),
});
export const DeliveryProtectedFieldRefSchema = DeliveryPlanProtectedFieldRefSchema;
export const ProtectedFieldRefSchema = z.union([
  ProductionProtectedFieldRefSchema,
  ProductionResultDecisionProtectedFieldRefSchema,
  DeliveryProtectedFieldRefSchema,
]);

export const ActiveProtectionSchema = strictObject({
  field: ProtectedFieldRefSchema,
  choiceId: EntityIdSchema,
  protectedAt: IsoTimestampSchema,
});

export type ProtectedFieldRef = z.infer<typeof ProtectedFieldRefSchema>;
export type ActiveProtection = z.infer<typeof ActiveProtectionSchema>;
