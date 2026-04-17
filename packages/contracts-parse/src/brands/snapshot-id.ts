/**
 * `SnapshotId` brand parser — Phase G1-2.10.
 */

import { z } from 'zod';
import type { SnapshotId } from '@lucid-fin/contracts';
import { makeBrandParser, makeTryBrand } from '../parse.js';

const SnapshotIdSchema = z
  .string()
  .min(1)
  .transform((v) => v.trim())
  .refine((v) => v.length > 0, { message: 'snapshotId must be non-empty after trim' });

export const parseSnapshotId = makeBrandParser<SnapshotId, string>(
  SnapshotIdSchema,
  'SnapshotId',
);

export const trySnapshotId = makeTryBrand<SnapshotId, string>(SnapshotIdSchema);
