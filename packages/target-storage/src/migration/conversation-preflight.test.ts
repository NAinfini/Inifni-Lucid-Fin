import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { preflightLegacyConversation } from './conversation-preflight.js';

function fixture(content = 'Finished'): DatabaseSync {
  const database = new DatabaseSync(':memory:');
  database.exec(`
    CREATE TABLE commander_sessions (id TEXT, messages TEXT);
    CREATE TABLE commander_runs (
      id TEXT, session_id TEXT, status TEXT, accepted_at INTEGER,
      started_at INTEGER, completed_at INTEGER, last_seq INTEGER
    );
    CREATE TABLE commander_events (run_id TEXT, seq INTEGER, kind TEXT, payload TEXT);
  `);
  database.prepare('INSERT INTO commander_sessions VALUES (?, ?)').run(
    'session.1',
    JSON.stringify([
      { id: 'message.user', role: 'user', content: 'Start', timestamp: 1000 },
      {
        id: 'message.assistant',
        role: 'assistant',
        content,
        timestamp: 1300,
        runMeta: { runId: 'run.1', status: 'completed', startedAt: 1100, completedAt: 1400 },
      },
    ]),
  );
  database
    .prepare('INSERT INTO commander_runs VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run('run.1', 'session.1', 'completed', 1000, 1100, 1400, 2);
  const insertEvent = database.prepare('INSERT INTO commander_events VALUES (?, ?, ?, ?)');
  insertEvent.run('run.1', 0, 'run_start', JSON.stringify({ kind: 'run_start', intent: 'Start' }));
  insertEvent.run(
    'run.1',
    1,
    'assistant_text',
    JSON.stringify({ kind: 'assistant_text', content: 'Finished', isDelta: false }),
  );
  insertEvent.run('run.1', 2, 'run_end', JSON.stringify({ kind: 'run_end', status: 'completed' }));
  return database;
}

describe('Legacy conversation preflight', () => {
  it('proves an assistant Message only from exact session, time, status, and event projection', () => {
    const database = fixture();
    const report = preflightLegacyConversation(database);
    expect(report).toMatchObject({
      sessionCount: 1,
      messageCount: 2,
      assistantMessageCount: 1,
      assistantOrigins: [
        {
          sessionId: 'session.1',
          messageId: 'message.assistant',
          runId: 'run.1',
          status: 'completed',
        },
      ],
      blockers: [],
      ok: true,
    });
    expect(JSON.stringify(report)).not.toContain('Finished');
    database.close();
  });

  it('blocks content correlation and missing runMeta without reporting message text', () => {
    const mismatch = fixture('Different private text');
    const mismatchReport = preflightLegacyConversation(mismatch);
    expect(mismatchReport.blockers).toContainEqual({
      kind: 'assistant_message_run_event_projection_mismatch',
      sessionId: 'session.1',
      messageId: 'message.assistant',
      runId: 'run.1',
    });
    expect(JSON.stringify(mismatchReport)).not.toContain('Different private text');
    mismatch.close();

    const missing = fixture();
    missing
      .prepare('UPDATE commander_sessions SET messages = ?')
      .run(
        JSON.stringify([
          { id: 'message.assistant', role: 'assistant', content: 'Private', timestamp: 1300 },
        ]),
      );
    expect(preflightLegacyConversation(missing).blockers[0]?.kind).toBe(
      'assistant_message_missing_run_meta',
    );
    missing.close();
  });

  it('blocks reusing one imported Run as the origin of multiple assistant Messages', () => {
    const database = fixture();
    database.prepare('UPDATE commander_sessions SET messages = ?').run(
      JSON.stringify([
        {
          id: 'message.assistant.1',
          role: 'assistant',
          content: 'Finished',
          timestamp: 1300,
          runMeta: { runId: 'run.1', status: 'completed', startedAt: 1100, completedAt: 1400 },
        },
        {
          id: 'message.assistant.2',
          role: 'assistant',
          content: 'Finished',
          timestamp: 1300,
          runMeta: { runId: 'run.1', status: 'completed', startedAt: 1100, completedAt: 1400 },
        },
      ]),
    );

    const report = preflightLegacyConversation(database);
    expect(report.assistantOrigins).toHaveLength(1);
    expect(report.blockers).toContainEqual({
      kind: 'assistant_message_run_reused',
      sessionId: 'session.1',
      messageId: 'message.assistant.2',
      runId: 'run.1',
    });
    expect(report.ok).toBe(false);
    database.close();
  });

  it('blocks Message identities reused across Legacy sessions', () => {
    const database = fixture();
    database
      .prepare('INSERT INTO commander_sessions VALUES (?, ?)')
      .run(
        'session.2',
        JSON.stringify([
          { id: 'message.user', role: 'user', content: 'Duplicate', timestamp: 1500 },
        ]),
      );

    const report = preflightLegacyConversation(database);
    expect(report.blockers).toContainEqual({
      kind: 'duplicate_message_identity',
      sessionId: 'session.2',
      messageId: 'message.user',
      runId: null,
    });
    expect(report.ok).toBe(false);
    database.close();
  });
});
