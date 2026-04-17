/**
 * `ContextItemId` brand parsers — Phase G2a-1.
 *
 * Context item IDs are stable identifiers assigned at item creation time.
 * Every hop from persistence/IPC into application code is validated here.
 */

import { z } from 'zod';
import type { ContextItemId } from '@lucid-fin/contracts';
import { makeBrandParser, makeTryBrand } from '../parse.js';
import { unsafeBrand } from '../brand.js';
import { randomUUID } from 'node:crypto';

const ContextItemIdSchema = z
  .string()
  .min(1)
  .transform((v) => v.trim())
  .refine((v) => v.length > 0, { message: 'contextItemId must be non-empty after trim' });

export const parseContextItemId = makeBrandParser<ContextItemId, string>(
  ContextItemIdSchema,
  'ContextItemId',
);

export const tryContextItemId = makeTryBrand<ContextItemId, string>(ContextItemIdSchema);

/** Generate a fresh context item ID (UUID v4). */
export function freshContextItemId(): ContextItemId {
  return unsafeBrand<ContextItemId>(randomUUID());
}
