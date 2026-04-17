/**
 * Job DTO — Phase G1-2.3.
 *
 * Mirrors the `Job` shape returned by `rowToJob` in `sqlite-jobs.ts`.
 * Reads in `JobRepository` go through `parseOrDegrade` with this
 * schema — a corrupt row (e.g. non-numeric `createdAt`) surfaces as
 * a degraded-read telemetry event + skip, not a crash in the job-queue
 * UI.
 *
 * `params` / `result` are typed as `unknown` because they are
 * free-form JSON blobs produced by provider adapters; tightening them
 * belongs to individual generator schemas, not the job storage layer.
 */

import { z } from 'zod';

const JobStatusEnum = z.enum([
  'queued',
  'running',
  'completed',
  'failed',
  'cancelled',
  'paused',
  'dead',
]);

const GenerationTypeEnum = z.enum([
  'text',
  'image',
  'video',
  'voice',
  'music',
  'sfx',
]);

export const JobSchema = z.object({
  id: z.string().min(1),
  segmentId: z.string().optional(),
  type: GenerationTypeEnum,
  provider: z.string(),
  status: JobStatusEnum,
  priority: z.number(),
  prompt: z.string(),
  params: z.unknown().optional(),
  result: z.unknown().optional(),
  cost: z.number().optional(),
  attempts: z.number().int().nonnegative(),
  maxRetries: z.number().int().nonnegative(),
  progress: z.number().optional(),
  completedSteps: z.number().int().optional(),
  totalSteps: z.number().int().optional(),
  currentStep: z.string().optional(),
  batchId: z.string().optional(),
  batchIndex: z.number().int().optional(),
  createdAt: z.number().int().nonnegative(),
  startedAt: z.number().int().optional(),
  completedAt: z.number().int().optional(),
  error: z.string().optional(),
});

export type JobDto = z.infer<typeof JobSchema>;
