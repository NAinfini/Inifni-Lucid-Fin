/**
 * `EquipmentId` brand parser — Phase G1-2.6.
 */

import { z } from 'zod';
import type { EquipmentId } from '@lucid-fin/contracts';
import { makeBrandParser, makeTryBrand } from '../parse.js';

const EquipmentIdSchema = z
  .string()
  .min(1)
  .transform((v) => v.trim())
  .refine((v) => v.length > 0, { message: 'equipmentId must be non-empty after trim' });

export const parseEquipmentId = makeBrandParser<EquipmentId, string>(
  EquipmentIdSchema,
  'EquipmentId',
);

export const tryEquipmentId = makeTryBrand<EquipmentId, string>(EquipmentIdSchema);
