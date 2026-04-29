/**
 * `ProcessPromptKey` brand parser — Phase G1-2.2.
 *
 * Process-prompt keys come in via IPC (`processPrompt:get / setCustom /
 * reset`) as raw strings. `ProcessPromptRepository` accepts only the
 * `ProcessPromptKey` brand, so handlers brand once at the boundary with
 * `parseProcessPromptKey` and pass typed values inward.
 */

import { z } from 'zod';
import type { ProcessPromptKey } from '@lucid-fin/contracts';
import { makeBrandParser, makeTryBrand } from '../parse.js';

const ProcessPromptKeySchema = z
  .string()
  .min(1)
  .transform((v) => v.trim())
  .refine((v) => v.length > 0, { message: 'processKey must be non-empty after trim' });

export const parseProcessPromptKey = makeBrandParser<ProcessPromptKey, string>(
  ProcessPromptKeySchema,
  'ProcessPromptKey',
);

export const tryProcessPromptKey = makeTryBrand<ProcessPromptKey, string>(ProcessPromptKeySchema);
