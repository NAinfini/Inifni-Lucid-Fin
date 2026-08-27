import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { preflightLegacyRunHistory } from './run-history-preflight.js';

const mediaHash = createHash('sha256').update('attachment').digest('hex');

function fixture(): DatabaseSync {
  const database = new DatabaseSync(':memory:');
  database.exec(`
    CREATE TABLE commander_runs (
      id TEXT, session_id TEXT, parent_run_id TEXT, retry_of_run_id TEXT,
      status TEXT, accepted_at INTEGER, started_at INTEGER, completed_at INTEGER, last_seq INTEGER
    );
    CREATE TABLE commander_events (
      run_id TEXT, seq INTEGER, kind TEXT, step INTEGER, emitted_at INTEGER,
      payload TEXT, private_payload BLOB
    );
    CREATE TABLE commander_run_canvases (
      run_id TEXT, ordinal INTEGER, canvas_id TEXT, released_at INTEGER
    );
    CREATE TABLE commander_run_attachments (
      run_id TEXT, ordinal INTEGER, content_hash TEXT, mime_type TEXT,
      original_name TEXT, role TEXT
    );
  `);
  database
    .prepare('INSERT INTO commander_runs VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run('run.root', 'session.1', null, null, 'completed', 1000, 1100, 1500, 1);
  database
    .prepare('INSERT INTO commander_runs VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run('run.child', 'session.1', 'run.root', null, 'completed', 1600, 1700, 2000, 1);
  const event = database.prepare('INSERT INTO commander_events VALUES (?, ?, ?, ?, ?, ?, ?)');
  for (const runId of ['run.root', 'run.child']) {
    event.run(runId, 0, 'run_start', 0, 1_000, JSON.stringify({ kind: 'run_start' }), null);
    event.run(
      runId,
      1,
      'run_end',
      1,
      2_000,
      JSON.stringify({ kind: 'run_end', status: 'completed' }),
      Buffer.from('private'),
    );
  }
  database
    .prepare('INSERT INTO commander_run_canvases VALUES (?, ?, ?, ?)')
    .run('run.root', 0, 'project.1', 1400);
  database
    .prepare('INSERT INTO commander_run_attachments VALUES (?, ?, ?, ?, ?, ?)')
    .run('run.root', 0, mediaHash, 'image/png', 'private.png', 'reference');
  return database;
}

describe('Legacy run history preflight', () => {
  it('accepts terminal lineage, contiguous event brackets, scopes, and verified attachments', () => {
    const database = fixture();
    const report = preflightLegacyRunHistory(database, new Set([mediaHash]));
    expect(report).toMatchObject({
      counts: { runs: 2, events: 4, scopes: 1, attachments: 1 },
      blockers: [],
      ok: true,
    });
    expect(JSON.stringify(report)).not.toContain('private');
    database.close();
  });

  it('blocks sequence drift, lineage cycles, and unverified attachment bytes', () => {
    const database = fixture();
    database
      .prepare('UPDATE commander_runs SET parent_run_id = ? WHERE id = ?')
      .run('run.child', 'run.root');
    database
      .prepare('UPDATE commander_events SET seq = 3 WHERE run_id = ? AND seq = 1')
      .run('run.child');
    const report = preflightLegacyRunHistory(database, new Set());
    expect(new Set(report.blockers.map(({ kind }) => kind))).toEqual(
      expect.objectContaining(
        new Set(['cyclic_run_lineage', 'run_event_sequence_mismatch', 'unverified_run_attachment']),
      ),
    );
    expect(report.ok).toBe(false);
    database.close();
  });

  it('blocks Target-unrepresentable run scalars before materialization', () => {
    const database = fixture();
    const outsideSafeInteger = 9_007_199_254_740_992n;
    database
      .prepare(
        'UPDATE commander_runs SET accepted_at = ?, started_at = ?, completed_at = ? WHERE id = ?',
      )
      .run(outsideSafeInteger, outsideSafeInteger, outsideSafeInteger, 'run.root');
    database
      .prepare('UPDATE commander_events SET step = ?, emitted_at = ? WHERE run_id = ? AND seq = 0')
      .run(-1, outsideSafeInteger, 'run.root');
    database
      .prepare('UPDATE commander_run_canvases SET ordinal = ? WHERE run_id = ?')
      .run(outsideSafeInteger, 'run.root');
    database
      .prepare('UPDATE commander_run_attachments SET ordinal = ?, role = ? WHERE run_id = ?')
      .run(outsideSafeInteger, 'other', 'run.root');

    const report = preflightLegacyRunHistory(database, new Set([mediaHash]));
    expect(new Set(report.blockers.map(({ kind }) => kind))).toEqual(
      expect.objectContaining(
        new Set([
          'invalid_run_time_order',
          'invalid_run_event_scalar',
          'invalid_run_scope',
          'invalid_run_attachment',
        ]),
      ),
    );
    expect(report.ok).toBe(false);
    database.close();
  });
});
