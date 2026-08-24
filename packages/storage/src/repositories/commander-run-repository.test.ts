import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { SessionId } from '@lucid-fin/contracts';
import { SqliteIndex } from '../sqlite-index.js';

describe('CommanderRunRepository', () => {
  let index: SqliteIndex;

  beforeEach(() => {
    index = new SqliteIndex(':memory:');
    index.repos.sessions.upsert({
      id: 'session-1' as SessionId,
      defaultCanvasId: 'canvas-1',
      title: '',
      messages: '[]',
      createdAt: 1,
      updatedAt: 1,
    });
  });

  afterEach(() => index.close());

  it('atomically reserves a run with seq 0 and hydrates only events after the cursor', () => {
    const repo = index.repos.commanderRuns;
    const contentHash = 'a'.repeat(64);
    index.repos.assets.insert({
      hash: contentHash,
      type: 'image',
      format: 'png',
      originalName: 'reference.png',
      displayName: 'Reference',
      fileSize: 12,
      createdAt: 1,
      tags: [],
    });
    repo.start({
      id: 'run-1',
      sessionId: 'session-1' as SessionId,
      defaultCanvasId: 'canvas-1',
      authorizedCanvasIds: ['canvas-2', 'canvas-1'],
      intent: 'make a film',
      acceptedAt: 10,
      runStartPayload: '{"kind":"run_start"}',
      attachments: [
        {
          ordinal: 0,
          contentHash,
          role: 'reference',
          originalName: 'reference.png',
          mimeType: 'image/png',
        },
      ],
    });
    repo.append('run-1', {
      seq: 1,
      kind: 'assistant_text',
      step: 0,
      emittedAt: 11,
      payload: '{"kind":"assistant_text"}',
    });
    repo.append('run-1', {
      seq: 2,
      kind: 'run_end',
      step: 0,
      emittedAt: 12,
      payload: '{"kind":"run_end","status":"completed"}',
      terminalStatus: 'completed',
    });

    expect(repo.get('run-1')).toMatchObject({
      defaultCanvasId: 'canvas-1',
      authorizedCanvasIds: ['canvas-2', 'canvas-1'],
      status: 'completed',
      lastSeq: 2,
      attachments: [
        {
          ordinal: 0,
          contentHash,
          role: 'reference',
          originalName: 'reference.png',
          mimeType: 'image/png',
        },
      ],
    });
    expect(repo.listEvents('run-1', 0).map(({ seq }) => seq)).toEqual([1, 2]);
  });

  it('rejects a duplicate event sequence without changing the original row', () => {
    const repo = index.repos.commanderRuns;
    repo.start({
      id: 'run-duplicate',
      sessionId: 'session-1' as SessionId,
      authorizedCanvasIds: [],
      intent: 'append only',
      acceptedAt: 10,
      runStartPayload: '{}',
      attachments: [],
    });
    repo.append('run-duplicate', {
      seq: 1,
      kind: 'assistant_text',
      step: 0,
      emittedAt: 11,
      payload: '{"version":1}',
    });
    index.rawDb.prepare('UPDATE commander_runs SET last_seq = 0 WHERE id = ?').run('run-duplicate');

    expect(() =>
      repo.append('run-duplicate', {
        seq: 1,
        kind: 'assistant_text',
        step: 0,
        emittedAt: 12,
        payload: '{"version":2}',
      }),
    ).toThrow();
    expect(repo.listEvents('run-duplicate', 0)).toEqual([
      expect.objectContaining({ seq: 1, emittedAt: 11, payload: '{"version":1}' }),
    ]);
  });

  it('rejects an empty private payload atomically without changing existing events', () => {
    const repo = index.repos.commanderRuns;
    repo.start({
      id: 'run-empty-private',
      sessionId: 'session-1' as SessionId,
      authorizedCanvasIds: [],
      intent: 'private recovery input',
      acceptedAt: 10,
      runStartPayload: '{}',
      attachments: [],
    });
    repo.append('run-empty-private', {
      seq: 1,
      kind: 'assistant_text',
      step: 0,
      emittedAt: 11,
      payload: '{"version":1}',
      privatePayload: Buffer.from('existing private input'),
    });

    expect(() =>
      repo.appendMany('run-empty-private', [
        {
          seq: 2,
          kind: 'assistant_text',
          step: 1,
          emittedAt: 12,
          payload: '{"version":2}',
          privatePayload: Buffer.from('valid private input'),
        },
        {
          seq: 3,
          kind: 'assistant_text',
          step: 1,
          emittedAt: 13,
          payload: '{"version":3}',
          privatePayload: Buffer.alloc(0),
        },
      ]),
    ).toThrow();
    expect(repo.get('run-empty-private')).toMatchObject({ lastSeq: 1 });
    expect(repo.listRecoveryEvents('run-empty-private')).toEqual([
      expect.objectContaining({ seq: 0, privatePayload: null }),
      expect.objectContaining({
        seq: 1,
        emittedAt: 11,
        payload: '{"version":1}',
        privatePayload: Buffer.from('existing private input'),
      }),
    ]);
  });

  it('allows parallel children and shared Canvas authority while keeping one active root', () => {
    const repo = index.repos.commanderRuns;
    const start = (id: string, overrides: Record<string, unknown> = {}) =>
      repo.start({
        id,
        sessionId: 'session-1' as SessionId,
        authorizedCanvasIds: ['canvas-1'],
        intent: id,
        acceptedAt: 10,
        runStartPayload: '{}',
        attachments: [],
        ...overrides,
      });

    start('root', { workType: 'agent' });
    start('child-a', { workType: 'subagent', parentRunId: 'root' });
    start('child-b', { workType: 'tool_program', parentRunId: 'root' });

    expect(repo.listRunHeadsForSession('session-1' as SessionId)).toMatchObject([
      { id: 'child-a', parentRunId: 'root', workType: 'subagent' },
      { id: 'child-b', parentRunId: 'root', workType: 'tool_program' },
      { id: 'root', workType: 'agent' },
    ]);
    expect(() => start('second-root', { workType: 'agent' })).toThrow();
  });

  it('lists only active runs in stable parent-depth and acceptance order', () => {
    for (const sessionId of ['session-2', 'session-3']) {
      index.repos.sessions.upsert({
        id: sessionId as SessionId,
        defaultCanvasId: null,
        title: '',
        messages: '[]',
        createdAt: 1,
        updatedAt: 1,
      });
    }
    const repo = index.repos.commanderRuns;
    const start = (
      id: string,
      acceptedAt: number,
      sessionId: SessionId,
      parentRunId?: string,
    ) => repo.start({
      id,
      sessionId,
      authorizedCanvasIds: [],
      intent: id,
      acceptedAt,
      runStartPayload: '{}',
      attachments: [],
      workType: parentRunId ? 'subagent' : 'agent',
      ...(parentRunId ? { parentRunId } : {}),
    });

    start('terminal-root', 5, 'session-3' as SessionId);
    repo.append('terminal-root', {
      seq: 1,
      kind: 'run_end',
      step: 0,
      emittedAt: 6,
      payload: '{"kind":"run_end","status":"completed"}',
      terminalStatus: 'completed',
    });
    start('other-root', 10, 'session-2' as SessionId);
    start('root', 20, 'session-1' as SessionId);
    start('child-b', 25, 'session-1' as SessionId, 'root');
    start('child-a', 30, 'session-1' as SessionId, 'root');
    start('grandchild', 40, 'session-1' as SessionId, 'child-a');
    repo.append('child-b', {
      seq: 1,
      kind: 'run_paused',
      step: 0,
      emittedAt: 31,
      payload: '{"kind":"run_paused"}',
      runStatus: 'paused',
    });

    expect(repo.listActiveRuns().map(({ id, status }) => [id, status])).toEqual([
      ['other-root', 'accepted'],
      ['root', 'accepted'],
      ['child-b', 'paused'],
      ['child-a', 'accepted'],
      ['grandchild', 'accepted'],
    ]);
  });

  it('enforces parent session and immutable Canvas authority at the repository boundary', () => {
    const repo = index.repos.commanderRuns;
    repo.start({
      id: 'root',
      sessionId: 'session-1' as SessionId,
      authorizedCanvasIds: ['canvas-1'],
      intent: 'root',
      acceptedAt: 10,
      runStartPayload: '{}',
      attachments: [],
      workType: 'agent',
    });
    index.repos.sessions.upsert({
      id: 'session-2' as SessionId,
      defaultCanvasId: null,
      title: '',
      messages: '[]',
      createdAt: 1,
      updatedAt: 1,
    });

    expect(() =>
      repo.start({
        id: 'foreign-child',
        sessionId: 'session-2' as SessionId,
        authorizedCanvasIds: [],
        intent: 'foreign',
        acceptedAt: 11,
        runStartPayload: '{}',
        attachments: [],
        workType: 'subagent',
        parentRunId: 'root',
      }),
    ).toThrow('another session');
    expect(() =>
      repo.start({
        id: 'wider-child',
        sessionId: 'session-1' as SessionId,
        authorizedCanvasIds: ['canvas-1', 'canvas-2'],
        intent: 'wider',
        acceptedAt: 11,
        runStartPayload: '{}',
        attachments: [],
        workType: 'subagent',
        parentRunId: 'root',
      }),
    ).toThrow('Canvas authority');
  });

  it('persists pause and resume as append-only status transitions', () => {
    const repo = index.repos.commanderRuns;
    repo.start({
      id: 'run-control',
      sessionId: 'session-1' as SessionId,
      authorizedCanvasIds: [],
      intent: 'control',
      acceptedAt: 10,
      runStartPayload: '{}',
      attachments: [],
      workType: 'agent',
    });

    repo.append('run-control', {
      seq: 1,
      kind: 'run_paused',
      step: 0,
      emittedAt: 11,
      payload: '{"kind":"run_paused"}',
      runStatus: 'paused',
    });
    expect(repo.get('run-control')?.status).toBe('paused');
    expect(() =>
      repo.append('run-control', {
        seq: 2,
        kind: 'assistant_text',
        step: 1,
        emittedAt: 12,
        payload: '{}',
      }),
    ).toThrow('paused');

    repo.append('run-control', {
      seq: 2,
      kind: 'run_resumed',
      step: 0,
      emittedAt: 13,
      payload: '{"kind":"run_resumed"}',
      runStatus: 'running',
    });
    expect(repo.get('run-control')).toMatchObject({ status: 'running', lastSeq: 2 });
  });

  it('appends one contiguous batch atomically and keeps append as its single-item delegate', () => {
    const repo = index.repos.commanderRuns;
    repo.start({
      id: 'run-1',
      sessionId: 'session-1' as SessionId,
      authorizedCanvasIds: [],
      intent: 'batch',
      acceptedAt: 10,
      runStartPayload: '{}',
      attachments: [],
    });

    expect(() =>
      repo.appendMany('run-1', [
        {
          seq: 1,
          kind: 'assistant_text',
          step: 0,
          emittedAt: 11,
          payload: '{}',
          privatePayload: Buffer.from('private batch input'),
        },
        { seq: 3, kind: 'assistant_text', step: 0, emittedAt: 12, payload: '{}' },
      ]),
    ).toThrow('expected seq 2');
    expect(repo.get('run-1')).toMatchObject({ status: 'accepted', lastSeq: 0 });
    expect(repo.listEvents('run-1').map(({ seq }) => seq)).toEqual([0]);

    expect(() =>
      repo.appendMany('run-1', [
        {
          seq: 1,
          kind: 'run_end',
          step: 0,
          emittedAt: 11,
          payload: '{}',
          terminalStatus: 'completed',
        },
        { seq: 2, kind: 'assistant_text', step: 0, emittedAt: 12, payload: '{}' },
      ]),
    ).toThrow('run_end must be the final event');
    expect(repo.listEvents('run-1').map(({ seq }) => seq)).toEqual([0]);

    expect(
      repo.appendMany('run-1', [
        {
          seq: 1,
          kind: 'assistant_text',
          step: 0,
          emittedAt: 11,
          payload: '{}',
          privatePayload: Buffer.from('private batch input'),
        },
        {
          seq: 2,
          kind: 'run_end',
          step: 0,
          emittedAt: 12,
          payload: '{}',
          terminalStatus: 'completed',
        },
      ]),
    ).toMatchObject({ status: 'completed', lastSeq: 2, startedAt: 10, completedAt: 12 });
    expect(repo.listEvents('run-1').map(({ seq }) => seq)).toEqual([0, 1, 2]);
    expect(repo.listEvents('run-1').every((event) => !('privatePayload' in event))).toBe(true);
    expect(repo.listRecoveryEvents('run-1')[1].privatePayload?.toString()).toBe(
      'private batch input',
    );
    expect(() =>
      repo.appendMany('run-1', [
        { seq: 3, kind: 'assistant_text', step: 1, emittedAt: 13, payload: '{}' },
      ]),
    ).toThrow('already terminal');

    const repo2 = index.repos.commanderRuns;
    index.repos.sessions.upsert({
      id: 'session-2' as SessionId,
      defaultCanvasId: 'canvas-2',
      title: '',
      messages: '[]',
      createdAt: 1,
      updatedAt: 1,
    });
    repo2.start({
      id: 'run-2',
      sessionId: 'session-2' as SessionId,
      authorizedCanvasIds: [],
      intent: 'single',
      acceptedAt: 20,
      runStartPayload: '{}',
      attachments: [],
    });
    const appendMany = vi.spyOn(repo2, 'appendMany');
    repo2.append('run-2', {
      seq: 1,
      kind: 'assistant_text',
      step: 0,
      emittedAt: 21,
      payload: '{}',
    });
    expect(appendMany).toHaveBeenCalledOnce();
    expect(appendMany).toHaveBeenCalledWith('run-2', [
      expect.objectContaining({ seq: 1, kind: 'assistant_text' }),
    ]);
  });

  it('persists accepted run inputs in the same transaction as the run', () => {
    const repo = index.repos.commanderRuns;
    const stored = repo.start({
      id: 'run-input',
      sessionId: 'session-1' as SessionId,
      authorizedCanvasIds: [],
      intent: 'Make a film',
      acceptedAt: 10,
      runStartPayload: JSON.stringify({ kind: 'run_start', seq: 0 }),
      runStartPrivatePayload: Buffer.from('private run input'),
      attachments: [],
      initialEvents: [
        {
          seq: 1,
          kind: 'user_message',
          step: 0,
          emittedAt: 10,
          payload: JSON.stringify({ kind: 'user_message', seq: 1, content: 'Make a film' }),
          privatePayload: Buffer.from('private user input'),
        },
        {
          seq: 2,
          kind: 'context_fact',
          step: 0,
          emittedAt: 10,
          payload: JSON.stringify({ kind: 'context_fact', seq: 2 }),
        },
      ],
    });

    expect(stored).toMatchObject({ status: 'accepted', lastSeq: 2 });
    expect(repo.listEvents('run-input').map(({ seq, kind }) => [seq, kind])).toEqual([
      [0, 'run_start'],
      [1, 'user_message'],
      [2, 'context_fact'],
    ]);
    expect(repo.listEvents('run-input').every((event) => !('privatePayload' in event))).toBe(true);
    expect(
      repo.listRecoveryEvents('run-input').map(({ seq, privatePayload }) => [
        seq,
        privatePayload?.toString() ?? null,
      ]),
    ).toEqual([
      [0, 'private run input'],
      [1, 'private user input'],
      [2, null],
    ]);
  });

  it('does not create a run when its accepted input sequence is invalid', () => {
    const repo = index.repos.commanderRuns;
    expect(() =>
      repo.start({
        id: 'run-invalid-input',
        sessionId: 'session-1' as SessionId,
        authorizedCanvasIds: [],
        intent: 'Make a film',
        acceptedAt: 10,
        runStartPayload: '{}',
        attachments: [],
        initialEvents: [
          {
            seq: 2,
            kind: 'user_message',
            step: 0,
            emittedAt: 10,
            payload: '{}',
          },
        ],
      }),
    ).toThrow('expected seq 1');
    expect(repo.get('run-invalid-input')).toBeUndefined();
  });

  it('reads session run heads and events in stable accepted-run order', () => {
    const repo = index.repos.commanderRuns;
    const persistRun = (id: string, acceptedAt: number) => {
      repo.start({
        id,
        sessionId: 'session-1' as SessionId,
        authorizedCanvasIds: [],
        intent: id,
        acceptedAt,
        runStartPayload: JSON.stringify({ kind: 'run_start', id }),
        attachments: [],
      });
      repo.appendMany(id, [
        {
          seq: 1,
          kind: 'assistant_text',
          step: 0,
          emittedAt: acceptedAt + 1,
          payload: JSON.stringify({ kind: 'assistant_text', id }),
        },
        {
          seq: 2,
          kind: 'run_end',
          step: 0,
          emittedAt: acceptedAt + 2,
          payload: JSON.stringify({ kind: 'run_end', id }),
          terminalStatus: 'completed',
        },
      ]);
    };

    persistRun('run-b', 10);
    persistRun('run-a', 10);
    persistRun('run-c', 9);

    expect(repo.listRunHeadsForSession('session-1' as SessionId).map(({ id }) => id)).toEqual([
      'run-c',
      'run-a',
      'run-b',
    ]);
    expect(
      repo.listEventsForSession('session-1' as SessionId).map(({ runId, seq }) => [runId, seq]),
    ).toEqual([
      ['run-c', 0],
      ['run-c', 1],
      ['run-c', 2],
      ['run-a', 0],
      ['run-a', 1],
      ['run-a', 2],
      ['run-b', 0],
      ['run-b', 1],
      ['run-b', 2],
    ]);
    expect(repo.listRunHeadsForSession('missing' as SessionId)).toEqual([]);
    expect(repo.listEventsForSession('missing' as SessionId)).toEqual([]);
  });

  it('accepts an empty scope and rejects a second active run in the same session', () => {
    const repo = index.repos.commanderRuns;
    repo.start({
      id: 'run-1',
      sessionId: 'session-1' as SessionId,
      authorizedCanvasIds: [],
      intent: 'first',
      acceptedAt: 10,
      runStartPayload: '{}',
      attachments: [],
    });
    expect(() =>
      repo.start({
        id: 'run-2',
        sessionId: 'session-1' as SessionId,
        authorizedCanvasIds: [],
        intent: 'second',
        acceptedAt: 11,
        runStartPayload: '{}',
        attachments: [],
      }),
    ).toThrow();
    expect(repo.get('run-1')?.authorizedCanvasIds).toEqual([]);
    expect(() =>
      repo.append('run-1', {
        seq: 2,
        kind: 'assistant_text',
        step: 0,
        emittedAt: 12,
        payload: '{}',
      }),
    ).toThrow('expected seq 1');
  });

  it('returns the latest run for a session', () => {
    const repo = index.repos.commanderRuns;
    repo.start({
      id: 'run-1',
      sessionId: 'session-1' as SessionId,
      authorizedCanvasIds: [],
      intent: 'first',
      acceptedAt: 10,
      runStartPayload: '{}',
      attachments: [],
    });
    repo.append('run-1', {
      seq: 1,
      kind: 'run_end',
      step: 0,
      emittedAt: 11,
      payload: '{}',
      terminalStatus: 'failed',
    });
    repo.start({
      id: 'run-2',
      sessionId: 'session-1' as SessionId,
      authorizedCanvasIds: [],
      intent: 'second',
      acceptedAt: 12,
      runStartPayload: '{}',
      attachments: [],
    });

    expect(repo.getLatestForSession('session-1' as SessionId)?.id).toBe('run-2');
    expect(repo.getLatestForSession('missing' as SessionId)).toBeUndefined();
  });

  it('atomically rejects overlap while allowing disjoint active scopes', () => {
    for (const [id, defaultCanvasId] of [
      ['session-2', 'canvas-2'],
      ['session-3', 'canvas-3'],
    ] as const) {
      index.repos.sessions.upsert({
        id: id as SessionId,
        defaultCanvasId,
        title: '',
        messages: '[]',
        createdAt: 1,
        updatedAt: 1,
      });
    }
    const repo = index.repos.commanderRuns;
    repo.start({
      id: 'run-1',
      sessionId: 'session-1' as SessionId,
      defaultCanvasId: 'canvas-1',
      authorizedCanvasIds: ['canvas-1', 'canvas-2'],
      intent: 'first',
      acceptedAt: 10,
      runStartPayload: '{}',
      attachments: [],
    });
    expect(() =>
      repo.start({
        id: 'run-overlap',
        sessionId: 'session-2' as SessionId,
        defaultCanvasId: 'canvas-2',
        authorizedCanvasIds: ['canvas-2'],
        intent: 'overlap',
        acceptedAt: 11,
        runStartPayload: '{}',
        attachments: [],
      }),
    ).toThrow();
    expect(repo.get('run-overlap')).toBeUndefined();
    expect(repo.listEvents('run-overlap')).toEqual([]);

    expect(
      repo.start({
        id: 'run-disjoint',
        sessionId: 'session-3' as SessionId,
        defaultCanvasId: 'canvas-3',
        authorizedCanvasIds: ['canvas-3'],
        intent: 'disjoint',
        acceptedAt: 12,
        runStartPayload: '{}',
        attachments: [],
      }).authorizedCanvasIds,
    ).toEqual(['canvas-3']);
  });

  it('releases every canvas claim with the terminal event transaction', () => {
    index.repos.sessions.upsert({
      id: 'session-2' as SessionId,
      defaultCanvasId: 'canvas-1',
      title: '',
      messages: '[]',
      createdAt: 1,
      updatedAt: 1,
    });
    const repo = index.repos.commanderRuns;
    repo.start({
      id: 'run-1',
      sessionId: 'session-1' as SessionId,
      defaultCanvasId: 'canvas-1',
      authorizedCanvasIds: ['canvas-1'],
      intent: 'first',
      acceptedAt: 10,
      runStartPayload: '{}',
      attachments: [],
    });
    repo.append('run-1', {
      seq: 1,
      kind: 'run_end',
      step: 0,
      emittedAt: 11,
      payload: '{}',
      terminalStatus: 'completed',
    });
    expect(
      repo.start({
        id: 'run-2',
        sessionId: 'session-2' as SessionId,
        defaultCanvasId: 'canvas-1',
        authorizedCanvasIds: ['canvas-1'],
        intent: 'second',
        acceptedAt: 12,
        runStartPayload: '{}',
        attachments: [],
      }).id,
    ).toBe('run-2');
  });

  it('writes blocked terminal batches, rejects max_steps writes, and reads legacy max_steps', () => {
    index.repos.sessions.upsert({
      id: 'session-2' as SessionId,
      defaultCanvasId: 'canvas-1',
      title: '',
      messages: '[]',
      createdAt: 1,
      updatedAt: 1,
    });
    const repo = index.repos.commanderRuns;
    repo.start({
      id: 'run-1',
      sessionId: 'session-1' as SessionId,
      defaultCanvasId: 'canvas-1',
      authorizedCanvasIds: ['canvas-1'],
      intent: 'block',
      acceptedAt: 10,
      runStartPayload: '{}',
      attachments: [],
    });

    expect(() =>
      repo.append('run-1', {
        seq: 1,
        kind: 'run_end',
        step: 0,
        emittedAt: 11,
        payload: JSON.stringify({ kind: 'run_end', status: 'blocked' }),
        terminalStatus: 'blocked',
      }),
    ).toThrow('blocker');

    expect(
      repo.appendMany('run-1', [
        {
          seq: 1,
          kind: 'run_end',
          step: 0,
          emittedAt: 12,
          payload: JSON.stringify({
            kind: 'run_end',
            status: 'blocked',
            blocker: { kind: 'resource_budget', metric: 'tokens', reason: 'exhausted' },
          }),
          terminalStatus: 'blocked',
        },
      ]),
    ).toMatchObject({ status: 'blocked', completedAt: 12 });

    repo.start({
      id: 'run-2',
      sessionId: 'session-2' as SessionId,
      defaultCanvasId: 'canvas-1',
      authorizedCanvasIds: ['canvas-1'],
      intent: 'replacement',
      acceptedAt: 13,
      runStartPayload: '{}',
      attachments: [],
    });
    expect(() =>
      repo.append('run-2', {
        seq: 1,
        kind: 'run_end',
        step: 0,
        emittedAt: 14,
        payload: JSON.stringify({ kind: 'run_end', status: 'max_steps' }),
        terminalStatus: 'max_steps' as never,
      }),
    ).toThrow('not writable');

    index.rawDb
      .prepare(
        `INSERT INTO commander_runs (id, session_id, intent, status, accepted_at)
         VALUES ('legacy-run', 'session-1', 'legacy', 'max_steps', 15)`,
      )
      .run();
    expect(repo.get('legacy-run')).toMatchObject({ status: 'max_steps', lastSeq: 0 });
  });

  it('rolls back the run and seq 0 when any attachment cannot be persisted', () => {
    const repo = index.repos.commanderRuns;
    expect(() =>
      repo.start({
        id: 'run-invalid',
        sessionId: 'session-1' as SessionId,
        defaultCanvasId: 'canvas-1',
        authorizedCanvasIds: ['canvas-1'],
        intent: 'invalid reference',
        acceptedAt: 10,
        runStartPayload: '{}',
        runStartPrivatePayload: Buffer.from('must roll back'),
        attachments: [
          {
            ordinal: 0,
            contentHash: 'b'.repeat(64),
            role: 'reference',
            originalName: 'missing.png',
            mimeType: 'image/png',
          },
        ],
      }),
    ).toThrow();
    expect(repo.get('run-invalid')).toBeUndefined();
    expect(repo.listEvents('run-invalid')).toEqual([]);
    expect(
      index.rawDb
        .prepare('SELECT COUNT(*) AS count FROM commander_events WHERE run_id = ?')
        .get('run-invalid'),
    ).toEqual({ count: 0 });
  });

  it('fails interrupted runs after reopen, hydrates the terminal event, and releases scope', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'commander-restart-'));
    const dbPath = path.join(directory, 'commander.db');
    let reopened: SqliteIndex | undefined;
    try {
      const first = new SqliteIndex(dbPath);
      first.repos.sessions.upsert({
        id: 'restart-session' as SessionId,
        defaultCanvasId: 'restart-canvas',
        title: '',
        messages: '[]',
        createdAt: 1,
        updatedAt: 1,
      });
      first.repos.commanderRuns.start({
        id: 'interrupted-run',
        sessionId: 'restart-session' as SessionId,
        defaultCanvasId: 'restart-canvas',
        authorizedCanvasIds: ['restart-canvas'],
        intent: 'interrupted',
        acceptedAt: 10,
        runStartPayload: '{"kind":"run_start"}',
        attachments: [],
      });
      first.close();

      reopened = new SqliteIndex(dbPath);
      expect(reopened.repos.commanderRuns.failInterruptedRuns(20, 'process restarted')).toBe(1);
      expect(reopened.repos.commanderRuns.get('interrupted-run')).toMatchObject({
        status: 'failed',
        completedAt: 20,
        lastSeq: 1,
        errorText: 'process restarted',
      });
      expect(reopened.repos.commanderRuns.listEvents('interrupted-run', 0)).toEqual([
        expect.objectContaining({ seq: 1, kind: 'run_end', emittedAt: 20 }),
      ]);
      expect(
        JSON.parse(reopened.repos.commanderRuns.listEvents('interrupted-run', 0)[0].payload),
      ).toMatchObject({
        kind: 'run_end',
        status: 'failed',
        seq: 1,
        exitDecision: { outcome: 'failed', blocker: 'process restarted' },
      });
      expect(
        reopened.repos.commanderRuns.start({
          id: 'replacement-run',
          sessionId: 'restart-session' as SessionId,
          defaultCanvasId: 'restart-canvas',
          authorizedCanvasIds: ['restart-canvas'],
          intent: 'replacement',
          acceptedAt: 21,
          runStartPayload: '{"kind":"run_start"}',
          attachments: [],
        }).id,
      ).toBe('replacement-run');
    } finally {
      reopened?.close();
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
});
