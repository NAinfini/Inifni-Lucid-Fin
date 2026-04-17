/**
 * `CharacterId` brand parser — Phase G1-2.6.
 */

import { z } from 'zod';
import type { CharacterId } from '@lucid-fin/contracts';
import { makeBrandParser, makeTryBrand } from '../parse.js';

const CharacterIdSchema = z
  .string()
  .min(1)
  .transform((v) => v.trim())
  .refine((v) => v.length > 0, { message: 'characterId must be non-empty after trim' });

export const parseCharacterId = makeBrandParser<CharacterId, string>(
  CharacterIdSchema,
  'CharacterId',
);

export const tryCharacterId = makeTryBrand<CharacterId, string>(CharacterIdSchema);
