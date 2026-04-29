/**
 * `SeriesId` brand parser — Phase G1-2.7.
 */

import { z } from 'zod';
import type { SeriesId } from '@lucid-fin/contracts';
import { makeBrandParser, makeTryBrand } from '../parse.js';

const SeriesIdSchema = z
  .string()
  .min(1)
  .transform((v) => v.trim())
  .refine((v) => v.length > 0, { message: 'seriesId must be non-empty after trim' });

export const parseSeriesId = makeBrandParser<SeriesId, string>(SeriesIdSchema, 'SeriesId');

export const trySeriesId = makeTryBrand<SeriesId, string>(SeriesIdSchema);
