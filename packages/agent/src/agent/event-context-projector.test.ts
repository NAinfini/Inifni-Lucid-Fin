import { createHash } from 'node:crypto';
import type { CommanderRunStatus, TimelineEvent } from '@lucid-fin/contracts';
import { describe, expect, it } from 'vitest';
import {
  PROJECTOR_VERSION,
  canonicalJson,
  hashCommanderContextProjection,
  hashEventChain,
  projectCommanderContext,
  type EventContextProjectionRun,
} from './event-context-projector.js';

type EventStamp = Pick<TimelineEvent, 'runId' | 'step' | 'seq' | 'emittedAt'>;
type EventBody = TimelineEvent extends infer Event
  ? Event extends TimelineEvent
    ? Omit<Event, keyof EventStamp>
    : never
  : never;

const SECRET = 'PRIVATE_SENTINEL_7f30d9';

function timelineEvent(
  runId: string,
  seq: number,
  body: EventBody,
  step = 0,
  emittedAt = 1_000 + seq,
): TimelineEvent {
  return { runId, step, seq, emittedAt, ...body } as TimelineEvent;
}

function projectionRun(
  id: string,
  acceptedAt: number,
  status: CommanderRunStatus,
  intent: string,
  events: TimelineEvent[],
): EventContextProjectionRun {
  return {
    run: { id, sessionId: 'session-1', acceptedAt, status, intent },
    events,
  };
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

describe('event context projector', () => {
  it('projects deterministic public history in acceptedAt/id order without mutating input', () => {
    const runB = projectionRun('run-b', 20, 'completed', SECRET, [
      timelineEvent('run-b', 0, { kind: 'run_start', intent: SECRET }),
      timelineEvent('run-b', 1, {
        kind: 'catalog_frozen',
        catalogHash: 'catalog-hash',
        tools: [
          {
            name: 'private.tool',
            description: SECRET,
            tier: 1,
            tags: [],
            contexts: [],
            inputSchemaHash: 'schema-hash',
            outputSchemaHash: 'output-schema-hash',
          },
        ],
      }),
      timelineEvent('run-b', 2, { kind: 'user_message', content: 'Build the scene' }),
      timelineEvent('run-b', 3, {
        kind: 'public_progress',
        operationId: 'model:1',
        status: 'running',
        summary: SECRET,
      }),
      timelineEvent('run-b', 4, {
        kind: 'resource_usage',
        operationId: 'model:1',
        source: 'model',
        reasoningTokens: 99,
      }),
      Object.assign(
        timelineEvent('run-b', 5, { kind: 'assistant_text', content: 'Hel', isDelta: true }, 1),
        { reasoning: SECRET, providerPayload: SECRET },
      ),
      timelineEvent('run-b', 6, {
        kind: 'assistant_text',
        content: 'Hello',
        isDelta: false,
      }, 1),
      timelineEvent('run-b', 7, {
        kind: 'question_prompt',
        questionId: 'question-1',
        prompt: 'Choose a color',
        allowFreeText: true,
      }, 1),
      timelineEvent('run-b', 8, {
        kind: 'user_answer',
        questionId: 'question-1',
        answer: 'Blue',
      }, 1),
      timelineEvent('run-b', 9, {
        kind: 'user_confirmation',
        toolCallId: 'call-1',
        approved: true,
      }, 1),
      timelineEvent('run-b', 10, { kind: 'run_end', status: 'completed' }, 1),
    ]);
    const runA = projectionRun('run-a', 20, 'failed', 'Legacy request', [
      timelineEvent('run-a', 0, { kind: 'run_start', intent: 'Legacy request' }),
      timelineEvent('run-a', 1, { kind: 'run_start', intent: 'Duplicate legacy request' }),
      timelineEvent('run-a', 2, { kind: 'run_end', status: 'failed' }),
    ]);
    const source = deepFreeze({ sessionId: 'session-1', runs: [runB, runA] });
    const before = structuredClone(source);

    const first = projectCommanderContext(source);
    const second = projectCommanderContext(source);

    expect(first).toEqual(second);
    expect(source).toEqual(before);
    expect(first.projectorVersion).toBe(PROJECTOR_VERSION);
    expect(first.runs.map((run) => run.runId)).toEqual(['run-a', 'run-b']);
    expect(first.runs[0]?.items).toEqual([
      { kind: 'user_input', runId: 'run-a', seq: 0, content: 'Legacy request' },
      {
        kind: 'terminal_summary',
        runId: 'run-a',
        status: 'failed',
        summary: 'Run failed.',
      },
    ]);
    expect(first.runs[1]?.items).toEqual([
      { kind: 'user_input', runId: 'run-b', seq: 2, content: 'Build the scene' },
      { kind: 'assistant_text', runId: 'run-b', step: 1, content: 'Hello' },
      {
        kind: 'interaction',
        runId: 'run-b',
        seq: 7,
        interaction: 'question',
        content: 'Choose a color',
      },
      {
        kind: 'interaction',
        runId: 'run-b',
        seq: 8,
        interaction: 'answer',
        content: 'Blue',
      },
      {
        kind: 'interaction',
        runId: 'run-b',
        seq: 9,
        interaction: 'confirmation',
        content: 'Approved',
      },
      {
        kind: 'terminal_summary',
        runId: 'run-b',
        status: 'completed',
        summary: 'Run completed.',
      },
    ]);
    const { projectionHash: _projectionHash, ...envelope } = first;
    expect(first.projectionHash).toBe(hashCommanderContextProjection(envelope));
    expect(JSON.stringify(first)).not.toContain(SECRET);
  });

  it('keeps only assistant attempts terminated by authoritative non-delta text', () => {
    const events = [
      timelineEvent('run-1', 0, { kind: 'run_start', intent: 'Request' }),
      timelineEvent('run-1', 1, { kind: 'user_message', content: 'Request' }),
      timelineEvent('run-1', 2, { kind: 'assistant_text', content: 'discard ', isDelta: true }, 1),
      timelineEvent('run-1', 3, {
        kind: 'phase_note',
        note: 'llm_retry',
        params: { attempt: 2, totalAttempts: 3, delayMs: 0, stall: false },
      }, 1),
      timelineEvent('run-1', 4, { kind: 'assistant_text', content: 'keep ', isDelta: true }, 1),
      timelineEvent('run-1', 5, { kind: 'assistant_text', content: 'me', isDelta: true }, 1),
      timelineEvent('run-1', 6, { kind: 'assistant_text', content: 'keep me', isDelta: false }, 1),
      timelineEvent('run-1', 7, {
        kind: 'assistant_text',
        content: 'unterminated',
        isDelta: true,
      }, 2),
      timelineEvent('run-1', 8, { kind: 'run_end', status: 'completed' }, 2),
    ];

    const cache = projectCommanderContext({
      sessionId: 'session-1',
      runs: [projectionRun('run-1', 10, 'completed', 'Request', events)],
    });

    expect(cache.runs[0]?.items.filter((item) => item.kind === 'assistant_text')).toEqual([
      { kind: 'assistant_text', runId: 'run-1', step: 1, content: 'keep me' },
    ]);
  });

  it('associates run facts and exact tool-result facts without exposing raw payloads', () => {
    const rawCall = Object.assign(
      timelineEvent('run-1', 3, {
        kind: 'tool_call',
        toolCallId: 'call-a',
        toolRef: { domain: 'canvas', action: 'get', version: 2 },
        status: 'started',
        summary: 'Reading',
        details: { requested: true },
      }, 1),
      { args: { secret: SECRET } },
    );
    const rawResult = Object.assign(
      timelineEvent('run-1', 4, {
        kind: 'tool_result',
        toolCallId: 'call-a',
        status: 'succeeded',
        summary: 'Read canvas',
        details: { nodeCount: 2 },
        artifacts: [{ kind: 'canvas_node', id: 'node-1' }],
      }, 1),
      { result: { secret: SECRET } },
    );
    const events = [
      timelineEvent('run-1', 0, { kind: 'run_start', intent: 'Request' }),
      timelineEvent('run-1', 1, { kind: 'user_message', content: 'Request' }),
      timelineEvent('run-1', 2, {
        kind: 'context_fact',
        schemaVersion: 1,
        source: { kind: 'run_input' },
        completeness: 'complete',
        facts: [
          {
            kind: 'authority_ref',
            authority: 'canvas',
            relation: 'selected_input',
            id: 'canvas-1',
          },
        ],
      }),
      rawCall,
      rawResult,
      timelineEvent('run-1', 5, {
        kind: 'tool_call',
        toolCallId: 'call-b',
        toolRef: { domain: 'asset', action: 'read' },
        status: 'started',
      }, 1),
      timelineEvent('run-1', 6, {
        kind: 'tool_result',
        toolCallId: 'call-b',
        status: 'failed',
        errorCode: 'TOOL_RUNTIME',
      }, 1),
      timelineEvent('run-1', 7, {
        kind: 'context_fact',
        schemaVersion: 1,
        source: { kind: 'tool_result', toolCallId: 'call-b', toolResultSeq: 6 },
        completeness: 'complete',
        facts: [{ kind: 'value', key: 'available', value: false }],
      }, 1),
      timelineEvent('run-1', 8, {
        kind: 'context_fact',
        schemaVersion: 1,
        source: { kind: 'tool_result', toolCallId: 'call-a', toolResultSeq: 4 },
        completeness: 'complete',
        facts: [
          { kind: 'authority_ref', authority: 'canvas', relation: 'read', id: 'canvas-1' },
        ],
      }, 1),
      timelineEvent('run-1', 9, { kind: 'run_end', status: 'failed' }, 1),
    ];

    const cache = projectCommanderContext({
      sessionId: 'session-1',
      runs: [projectionRun('run-1', 10, 'failed', 'Request', events)],
    });

    expect(cache.runs[0]?.items).toEqual([
      { kind: 'user_input', runId: 'run-1', seq: 1, content: 'Request' },
      {
        kind: 'run_context',
        runId: 'run-1',
        seq: 2,
        facts: [
          {
            kind: 'authority_ref',
            authority: 'canvas',
            relation: 'selected_input',
            id: 'canvas-1',
          },
        ],
      },
      {
        kind: 'tool_observation',
        runId: 'run-1',
        toolCallId: 'call-a',
        toolName: 'canvas.get@2',
        status: 'completed',
        summary: 'Read canvas',
        details: { nodeCount: 2 },
        artifacts: [{ kind: 'canvas_node', id: 'node-1' }],
        contextFacts: [
          { kind: 'authority_ref', authority: 'canvas', relation: 'read', id: 'canvas-1' },
        ],
      },
      {
        kind: 'tool_observation',
        runId: 'run-1',
        toolCallId: 'call-b',
        toolName: 'asset.read',
        status: 'failed',
        contextFacts: [{ kind: 'value', key: 'available', value: false }],
      },
      {
        kind: 'terminal_summary',
        runId: 'run-1',
        status: 'failed',
        summary: 'Run failed.',
        errorCode: 'TOOL_RUNTIME',
      },
    ]);
    expect(JSON.stringify(cache)).not.toContain(SECRET);
  });

  it('rejects unavailable facts as an incomplete public-history boundary', () => {
    const events = [
      timelineEvent('run-1', 0, { kind: 'run_start', intent: 'Request' }),
      timelineEvent('run-1', 1, {
        kind: 'context_fact',
        schemaVersion: 1,
        source: { kind: 'run_input' },
        completeness: 'unavailable',
        facts: [],
      }),
    ];

    expect(() =>
      projectCommanderContext({
        sessionId: 'session-1',
        runs: [projectionRun('run-1', 10, 'running', 'Request', events)],
      }),
    ).toThrow(/unavailable context_fact.*run-1.*seq 1/i);
  });

  it('does not project a typed host intent as user-authored input', () => {
    const events = [
      timelineEvent('run-1', 0, { kind: 'run_start', intent: 'Continue media assembly' }),
      timelineEvent('run-1', 1, {
        kind: 'context_fact',
        schemaVersion: 1,
        source: { kind: 'run_input' },
        completeness: 'complete',
        facts: [{ kind: 'value', key: 'request_kind', value: 'media_prompt_assembly' }],
      }),
    ];

    const cache = projectCommanderContext({
      sessionId: 'session-1',
      runs: [projectionRun('run-1', 10, 'running', 'Continue media assembly', events)],
    });

    expect(cache.runs[0]?.items).toEqual([
      {
        kind: 'run_context',
        runId: 'run-1',
        seq: 1,
        facts: [{ kind: 'value', key: 'request_kind', value: 'media_prompt_assembly' }],
      },
    ]);
  });

  it('rejects non-contiguous or cross-run event sequences', () => {
    const start = timelineEvent('run-1', 0, { kind: 'run_start', intent: 'Request' });
    const gap = timelineEvent('run-1', 2, { kind: 'run_end', status: 'completed' });
    const foreign = timelineEvent('run-2', 1, { kind: 'run_end', status: 'completed' });

    expect(() =>
      projectCommanderContext({
        sessionId: 'session-1',
        runs: [projectionRun('run-1', 10, 'completed', 'Request', [start, gap])],
      }),
    ).toThrow(/run-1.*expected seq 1.*received 2/i);
    expect(() =>
      projectCommanderContext({
        sessionId: 'session-1',
        runs: [projectionRun('run-1', 10, 'completed', 'Request', [start, foreign])],
      }),
    ).toThrow(/run-1.*event for run-2/i);
  });

  it('uses canonical JSON and the specified SHA-256 event chain including emittedAt', () => {
    expect(canonicalJson({ z: 1, a: { y: 2, x: 'three' } })).toBe(
      '{"a":{"x":"three","y":2},"z":1}',
    );
    const events = [
      timelineEvent('run-1', 0, { kind: 'run_start', intent: 'Request' }, 0, 100),
      timelineEvent('run-1', 1, { kind: 'run_end', status: 'completed' }, 1, 90),
    ];
    const firstHash = createHash('sha256')
      .update('commander-context-event-v1\0' + canonicalJson(events[0]))
      .digest('hex');
    const expected = createHash('sha256')
      .update(firstHash + '\0' + canonicalJson(events[1]))
      .digest('hex');

    expect(hashEventChain(events)).toBe(expected);
    const changedTimestamp = [events[0]!, { ...events[1]!, emittedAt: 91 }];
    expect(hashEventChain(changedTimestamp)).not.toBe(expected);
  });
});
