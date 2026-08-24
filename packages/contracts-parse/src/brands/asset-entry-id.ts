import { z } from 'zod';
import type { AssetEntryId } from '@lucid-fin/contracts';
import { makeBrandParser, makeTryBrand } from '../parse.js';

const AssetEntryIdSchema = z.string().trim().min(1);

export const parseAssetEntryId = makeBrandParser<AssetEntryId, string>(
  AssetEntryIdSchema,
  'AssetEntryId',
);

export const tryAssetEntryId = makeTryBrand<AssetEntryId, string>(AssetEntryIdSchema);
