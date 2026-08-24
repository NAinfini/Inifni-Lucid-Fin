import { describe, expect, it, vi } from 'vitest';
import { ToolRegistry } from '@lucid-fin/application';
import type { CommanderContextCache, SessionId } from '@lucid-fin/contracts';
import type { StoredCommanderRun, StoredCommanderRunEvent } from '@lucid-fin/storage';
import {
  buildModelViewFromCommanderContextCache,
  loadCommanderContextCache,
} from './commander-context-cache.service.js';

const sessionId = 'session-1' as SessionId;

function run(overrides: Partial<StoredCommanderRun> = {}): StoredCommanderRun {
  return {
    id: 'run-1',
    sessionId,
    authorizedCanvasIds: [],
    intent: 'Make a film',
    status: 'completed',
    acceptedAt: 10,
    completedAt: 20,
    lastSeq: 3,
    attachments: [],
    ...overrides,
  };
}

function event(
  seq: number,
  value: Record<string, unknown>,
  runId = 'run-1',
): StoredCommanderRunEvent {
  const payload = {
    runId,
    step: seq === 0 ? 0 : 1,
    seq,
    emittedAt: 10 + seq,
    ...value,
  };
  return {
    sessionId,
    runId,
    seq,
    kind: String(payload.kind),
    step: Number(payload.step),
    emittedAt: Number(payload.emittedAt),
    payload: JSON.stringify(payload),
  };
}

function events(text = 'Done'): StoredCommanderRunEvent[] {
  return [
    event(0, { kind: 'run_start', intent: 'Make a film' }),
    event(1, { kind: 'user_message', content: 'Make a film' }),
    event(2, { kind: 'assistant_text', content: text, isDelta: false }),
    event(3, { kind: 'run_end', status: 'completed' }),
  ];
}

describe('Commander context cache service', () => {
  it('rebuilds from immutable events, persists the cache, then reuses an unchanged run', () => {
    let stored: CommanderContextCache | undefined;
    const listEvents = vi.fn(() => events());
    const repositories = {
      commanderRuns: {
        listRunHeadsForSession: vi.fn(() => [run()]),
        listEvents,
      },
      sessions: {
        readContextCache: vi.fn(() =>
          stored ? ({ state: 'valid', cache: stored } as const) : ({ state: 'missing' } as const),
        ),
        saveContextCache: vi.fn((_id: SessionId, cache: CommanderContextCache) => {
          stored = cache;
        }),
      },
    };

    const first = loadCommanderContextCache(repositories, sessionId, new ToolRegistry());
    expect(first.rebuiltRunIds).toEqual(['run-1']);
    expect(first.cache.runs[0]?.items).toEqual([
      { kind: 'user_input', runId: 'run-1', seq: 1, content: 'Make a film' },
      { kind: 'assistant_text', runId: 'run-1', step: 1, content: 'Done' },
      { kind: 'terminal_summary', runId: 'run-1', status: 'completed', summary: 'Run completed.' },
    ]);

    listEvents.mockClear();
    const second = loadCommanderContextCache(repositories, sessionId, new ToolRegistry());
    expect(second.reusedRunIds).toEqual(['run-1']);
    expect(listEvents).not.toHaveBeenCalled();
  });

  it('reprojects only a changed run and derives public conversation history', () => {
    const oldRun = run({ id: 'run-1', acceptedAt: 10 });
    const changedRun = run({ id: 'run-2', acceptedAt: 20, lastSeq: 3 });
    let stored: CommanderContextCache | undefined;
    const rowsByRun = new Map([
      ['run-1', events('First')],
      ['run-2', events('Second').map((row) => ({ ...row, runId: 'run-2', payload: row.payload.replaceAll('run-1', 'run-2') }))],
    ]);
    const listEvents = vi.fn((runId: string) => rowsByRun.get(runId) ?? []);
    const repositories = {
      commanderRuns: {
        listRunHeadsForSession: vi.fn(() => [oldRun, changedRun]),
        listEvents,
      },
      sessions: {
        readContextCache: vi.fn(() =>
          stored ? ({ state: 'valid', cache: stored } as const) : ({ state: 'missing' } as const),
        ),
        saveContextCache: vi.fn((_id: SessionId, cache: CommanderContextCache) => {
          stored = cache;
        }),
      },
    };

    const first = loadCommanderContextCache(repositories, sessionId, new ToolRegistry());
    expect(first.rebuiltRunIds).toEqual(['run-1', 'run-2']);
    changedRun.status = 'running';
    listEvents.mockClear();
    const second = loadCommanderContextCache(repositories, sessionId, new ToolRegistry());
    expect(second.reusedRunIds).toEqual(['run-1']);
    expect(second.rebuiltRunIds).toEqual(['run-2']);
    expect(listEvents).toHaveBeenCalledTimes(1);
    expect(buildModelViewFromCommanderContextCache(second.cache, 'run-2')).toEqual([
      { role: 'user', content: 'Make a film' },
      { role: 'assistant', content: 'First' },
      {
        role: 'system',
        content: '{"kind":"terminal_summary","runId":"run-1","status":"completed","summary":"Run completed."}',
      },
    ]);
  });

  it('builds a complete deterministic model view without mutating the public cache', () => {
    const cache: CommanderContextCache = {
      kind: 'commander_context_cache',
      version: 2,
      projectorVersion: 1,
      sessionId,
      projectionHash: 'hash',
      runs: [{
        runId: 'run-1',
        acceptedAt: 10,
        status: 'completed',
        throughSeq: 7,
        eventHash: 'event-hash',
        items: [
          { kind: 'user_input', runId: 'run-1', seq: 1, content: 'Create a scene' },
          {
            kind: 'run_context',
            runId: 'run-1',
            seq: 2,
            facts: [{
              kind: 'authority_ref',
              authority: 'canvas',
              relation: 'read',
              id: 'canvas-1',
            }],
          },
          {
            kind: 'tool_observation',
            runId: 'run-1',
            toolCallId: 'call-1',
            toolName: 'canvas.inspect',
            status: 'completed',
            summary: 'Canvas inspected',
          },
          {
            kind: 'interaction',
            runId: 'run-1',
            seq: 5,
            interaction: 'question',
            content: 'Which direction?',
          },
          {
            kind: 'interaction',
            runId: 'run-1',
            seq: 6,
            interaction: 'answer',
            content: 'Quiet and intimate',
          },
          { kind: 'assistant_text', runId: 'run-1', step: 2, content: 'Done' },
          {
            kind: 'terminal_summary',
            runId: 'run-1',
            status: 'completed',
            summary: 'Run completed.',
          },
        ],
      }],
    };
    const before = JSON.stringify(cache);

    const view = buildModelViewFromCommanderContextCache(cache);

    expect(view.map((entry) => entry.role)).toEqual([
      'user',
      'system',
      'system',
      'assistant',
      'user',
      'assistant',
      'system',
    ]);
    expect(JSON.parse(view[1]?.content ?? '')).toMatchObject({
      kind: 'run_context',
      facts: [expect.objectContaining({ authority: 'canvas', id: 'canvas-1' })],
    });
    expect(JSON.parse(view[2]?.content ?? '')).toMatchObject({
      kind: 'tool_observation',
      toolName: 'canvas.inspect',
      summary: 'Canvas inspected',
    });
    expect(JSON.stringify(cache)).toBe(before);
  });

  it('rejects corrupt event payloads instead of silently dropping context', () => {
    const repositories = {
      commanderRuns: {
        listRunHeadsForSession: vi.fn(() => [run({ lastSeq: 0 })]),
        listEvents: vi.fn(() => [{ ...event(0, { kind: 'run_start', intent: 'x' }), payload: '{' }]),
      },
      sessions: {
        readContextCache: vi.fn(() => ({ state: 'missing' } as const)),
        saveContextCache: vi.fn(),
      },
    };
    expect(() => loadCommanderContextCache(repositories, sessionId, new ToolRegistry())).toThrow(
      'contains invalid JSON',
    );
    expect(repositories.sessions.saveContextCache).not.toHaveBeenCalled();
  });

  it('rebuilds legacy tool results without rewriting immutable events', () => {
    const rows = [
      event(0, { kind: 'run_start', intent: 'Continue' }),
      event(1, {
        kind: 'tool_call',
        toolCallId: 'call-1',
        toolRef: { domain: 'canvas', action: 'inspect' },
        args: { canvasId: 'canvas-1' },
      }),
      event(2, {
        kind: 'tool_result',
        toolCallId: 'call-1',
        result: { success: true, data: { id: 'canvas-1' } },
        durationMs: 4,
      }),
      event(3, { kind: 'assistant_text', content: 'Ready', isDelta: false }),
      event(4, { kind: 'run_end', status: 'completed' }),
    ];
    const before = rows.map((row) => row.payload);
    const repositories = {
      commanderRuns: {
        listRunHeadsForSession: vi.fn(() => [run({ lastSeq: 4 })]),
        listEvents: vi.fn(() => rows),
      },
      sessions: {
        readContextCache: vi.fn(() => ({ state: 'missing' } as const)),
        saveContextCache: vi.fn(),
      },
    };

    const result = loadCommanderContextCache(repositories, sessionId, new ToolRegistry());

    expect(result.cache.runs[0]?.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'tool_observation',
          toolCallId: 'call-1',
          status: 'completed',
        }),
      ]),
    );
    expect(rows.map((row) => row.payload)).toEqual(before);
  });
});
