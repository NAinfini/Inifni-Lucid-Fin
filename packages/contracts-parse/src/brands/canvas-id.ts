/**
 * `CanvasId` brand parser — Phase G1-2.5.
 */

import { z } from 'zod';
import type { CanvasId } from '@lucid-fin/contracts';
import { makeBrandParser, makeTryBrand } from '../parse.js';

const CanvasIdSchema = z
  .string()
  .min(1)
  .transform((v) => v.trim())
  .refine((v) => v.length > 0, { message: 'canvasId must be non-empty after trim' });

export const parseCanvasId = makeBrandParser<CanvasId, string>(CanvasIdSchema, 'CanvasId');

export const tryCanvasId = makeTryBrand<CanvasId, string>(CanvasIdSchema);
