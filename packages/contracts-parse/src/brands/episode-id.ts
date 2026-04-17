/**
 * `EpisodeId` brand parser — Phase G1-2.7.
 */

import { z } from 'zod';
import type { EpisodeId } from '@lucid-fin/contracts';
import { makeBrandParser, makeTryBrand } from '../parse.js';

const EpisodeIdSchema = z
  .string()
  .min(1)
  .transform((v) => v.trim())
  .refine((v) => v.length > 0, { message: 'episodeId must be non-empty after trim' });

export const parseEpisodeId = makeBrandParser<EpisodeId, string>(
  EpisodeIdSchema,
  'EpisodeId',
);

export const tryEpisodeId = makeTryBrand<EpisodeId, string>(EpisodeIdSchema);
