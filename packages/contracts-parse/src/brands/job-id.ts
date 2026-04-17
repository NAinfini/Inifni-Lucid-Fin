/**
 * `JobId` brand parser — Phase G1-2.3.
 *
 * Job IDs arrive via IPC (`job:list`, `job:cancel`, etc.) as raw
 * strings. `JobRepository` accepts only the `JobId` brand; handlers
 * brand once at the boundary with `parseJobId` and pass typed values
 * inward.
 */

import { z } from 'zod';
import type { JobId } from '@lucid-fin/contracts';
import { makeBrandParser, makeTryBrand } from '../parse.js';

const JobIdSchema = z
  .string()
  .min(1)
  .transform((v) => v.trim())
  .refine((v) => v.length > 0, { message: 'jobId must be non-empty after trim' });

export const parseJobId = makeBrandParser<JobId, string>(JobIdSchema, 'JobId');
export const tryJobId = makeTryBrand<JobId, string>(JobIdSchema);
