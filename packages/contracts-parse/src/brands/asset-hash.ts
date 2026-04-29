/**
 * `AssetHash` brand parser — Phase G1-2.4.
 *
 * Asset hashes come from CAS and from IPC payloads. `AssetRepository`
 * accepts only the `AssetHash` brand; handlers brand once at the
 * boundary with `parseAssetHash`.
 */

import { z } from 'zod';
import type { AssetHash } from '@lucid-fin/contracts';
import { makeBrandParser, makeTryBrand } from '../parse.js';

const AssetHashSchema = z
  .string()
  .min(1)
  .transform((v) => v.trim())
  .refine((v) => v.length > 0, { message: 'assetHash must be non-empty after trim' });

export const parseAssetHash = makeBrandParser<AssetHash, string>(AssetHashSchema, 'AssetHash');

export const tryAssetHash = makeTryBrand<AssetHash, string>(AssetHashSchema);
