/**
 * `PresetId` brand parser — Phase G1-2.8.
 */

import { z } from 'zod';
import type { PresetId } from '@lucid-fin/contracts';
import { makeBrandParser, makeTryBrand } from '../parse.js';

const PresetIdSchema = z
  .string()
  .min(1)
  .transform((v) => v.trim())
  .refine((v) => v.length > 0, { message: 'presetId must be non-empty after trim' });

export const parsePresetId = makeBrandParser<PresetId, string>(
  PresetIdSchema,
  'PresetId',
);

export const tryPresetId = makeTryBrand<PresetId, string>(PresetIdSchema);
