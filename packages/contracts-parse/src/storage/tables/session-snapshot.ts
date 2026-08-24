/**
 * Commander session + snapshot tables.
 *
 * Snapshots cascade on commander_session delete via FK — repository
 * code should still surface the dependency explicitly for clarity.
 */
import type { SessionId, SnapshotId, CanvasId } from '@lucid-fin/contracts';
import { defineTable, col } from '../../tables.js';

export const CommanderSessionsTable = defineTable('commander_sessions', {
  id: col<SessionId>('id'),
  defaultCanvasId: col<CanvasId | null>('default_canvas_id'),
  title: col<string>('title'),
  messages: col<string>('messages'),
  contextGraphJson: col<string | null>('context_graph_json'),
  createdAt: col<number>('created_at'),
  updatedAt: col<number>('updated_at'),
});

export const SnapshotsTable = defineTable('snapshots', {
  id: col<SnapshotId>('id'),
  sessionId: col<SessionId>('session_id'),
  label: col<string>('label'),
  trigger: col<string>('trigger'),
  schemaVersion: col<number>('schema_version'),
  data: col<string>('data'),
  createdAt: col<number>('created_at'),
});

export const CommanderEventsTable = defineTable('commander_events', {
  sessionId: col<SessionId>('session_id'),
  runId: col<string>('run_id'),
  seq: col<number>('seq'),
  kind: col<string>('kind'),
  step: col<number>('step'),
  emittedAt: col<number>('emitted_at'),
  privatePayload: col<Buffer | null>('private_payload'),
  payload: col<string>('payload'),
});

export const CommanderRunsTable = defineTable('commander_runs', {
  id: col<string>('id'),
  sessionId: col<SessionId>('session_id'),
  defaultCanvasId: col<CanvasId | null>('default_canvas_id'),
  workType: col<string>('work_type'),
  parentRunId: col<string | null>('parent_run_id'),
  retryOfRunId: col<string | null>('retry_of_run_id'),
  displayName: col<string | null>('display_name'),
  objective: col<string | null>('objective'),
  intent: col<string>('intent'),
  status: col<string>('status'),
  acceptedAt: col<number>('accepted_at'),
  startedAt: col<number | null>('started_at'),
  completedAt: col<number | null>('completed_at'),
  lastSeq: col<number>('last_seq'),
  errorText: col<string | null>('error_text'),
});

export const CommanderRunAttachmentsTable = defineTable('commander_run_attachments', {
  runId: col<string>('run_id'),
  ordinal: col<number>('ordinal'),
  contentHash: col<string>('content_hash'),
  role: col<string>('role'),
  originalName: col<string>('original_name'),
  mimeType: col<string>('mime_type'),
});

export const CommanderRunCanvasesTable = defineTable('commander_run_canvases', {
  runId: col<string>('run_id'),
  canvasId: col<CanvasId>('canvas_id'),
  ordinal: col<number>('ordinal'),
  releasedAt: col<number | null>('released_at'),
});
