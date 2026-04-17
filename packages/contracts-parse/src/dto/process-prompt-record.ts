/**
 * ProcessPromptRecord DTO — Phase G1-2.2.
 *
 * Mirrors the shape `rowToRecord` returns from `process_prompts`. Reads
 * in `ProcessPromptRepository` go through `parseOrDegrade` with this
 * schema so a row with (e.g.) a null `name` surfaces as a degraded-read
 * telemetry event + skip, not a crash in the Settings window.
 */

import { z } from 'zod';

export const ProcessPromptRecordSchema = z.object({
  id: z.number().int().nonnegative(),
  processKey: z.string().min(1),
  name: z.string(),
  description: z.string(),
  defaultValue: z.string(),
  customValue: z.string().nullable(),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
});

export type ProcessPromptRecordDto = z.infer<typeof ProcessPromptRecordSchema>;
