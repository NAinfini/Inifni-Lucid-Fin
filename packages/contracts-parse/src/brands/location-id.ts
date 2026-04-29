/**
 * `LocationId` brand parser — Phase G1-2.6.
 */

import { z } from 'zod';
import type { LocationId } from '@lucid-fin/contracts';
import { makeBrandParser, makeTryBrand } from '../parse.js';

const LocationIdSchema = z
  .string()
  .min(1)
  .transform((v) => v.trim())
  .refine((v) => v.length > 0, { message: 'locationId must be non-empty after trim' });

export const parseLocationId = makeBrandParser<LocationId, string>(LocationIdSchema, 'LocationId');

export const tryLocationId = makeTryBrand<LocationId, string>(LocationIdSchema);
