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
  canvasId: col<CanvasId | null>('canvas_id'),
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
  payload: col<string>('payload'),
});
