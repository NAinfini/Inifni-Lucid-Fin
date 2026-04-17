/**
 * `ShotTemplateId` brand parser — Phase G1-2.9.
 */

import { z } from 'zod';
import type { ShotTemplateId } from '@lucid-fin/contracts';
import { makeBrandParser, makeTryBrand } from '../parse.js';

const ShotTemplateIdSchema = z
  .string()
  .min(1)
  .transform((v) => v.trim())
  .refine((v) => v.length > 0, { message: 'shotTemplateId must be non-empty after trim' });

export const parseShotTemplateId = makeBrandParser<ShotTemplateId, string>(
  ShotTemplateIdSchema,
  'ShotTemplateId',
);

export const tryShotTemplateId = makeTryBrand<ShotTemplateId, string>(ShotTemplateIdSchema);
