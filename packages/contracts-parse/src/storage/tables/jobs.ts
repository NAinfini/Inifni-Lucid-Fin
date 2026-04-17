/**
 * Job-domain table constant. Matches `CREATE TABLE jobs` in
 * `SCHEMA_SQL`; column types mirror better-sqlite3 storage shapes, not
 * DTO shapes (JSON payloads stay serialized strings here).
 */
import type { JobId, ProviderId } from '@lucid-fin/contracts';
import { defineTable, col } from '../../tables.js';

export const JobsTable = defineTable('jobs', {
  id: col<JobId>('id'),
  segmentId: col<string | null>('segment_id'),
  type: col<string>('type'),
  provider: col<ProviderId>('provider'),
  status: col<string>('status'),
  priority: col<number | null>('priority'),
  prompt: col<string | null>('prompt'),
  params: col<string | null>('params'),
  result: col<string | null>('result'),
  cost: col<number | null>('cost'),
  attempts: col<number | null>('attempts'),
  maxRetries: col<number | null>('max_retries'),
  progress: col<number | null>('progress'),
  completedSteps: col<number | null>('completed_steps'),
  totalSteps: col<number | null>('total_steps'),
  currentStep: col<string | null>('current_step'),
  batchId: col<string | null>('batch_id'),
  batchIndex: col<number | null>('batch_index'),
  createdAt: col<number>('created_at'),
  startedAt: col<number | null>('started_at'),
  completedAt: col<number | null>('completed_at'),
  error: col<string | null>('error'),
});
