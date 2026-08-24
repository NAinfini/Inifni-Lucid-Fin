import { describe, expect, it, vi } from 'vitest';
import { ToolRegistry, type StampedStreamEvent } from '@lucid-fin/application';

const logger = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  fatal: vi.fn(),
}));

vi.mock('../../logger.js', () => ({ default: logger }));

import { createEmitHandler } from './commander-emit.js';
import {
  openCommanderRecoveryPayload,
  type CommanderRecoveryCodec,
} from './commander-recovery.service.js';

function stamped(event: Record<string, unknown>): StampedStreamEvent {
  return {
    runId: 'run-1',
    step: 1,
    emittedAt: 1,
    ...event,
  } as StampedStreamEvent;
}

describe('createEmitHandler atomic projection', () => {
  it('persists an adjacent tool result and context fact once before broadcasting', () => {
    const order: string[] = [];
    const persist = vi.fn((events: readonly { event: { seq: number } }[]) => {
      order.push(`persist:${events.map(({ event }) => event.seq).join(',')}`);
    });
    const gateway = {
      emit: vi.fn((_channel: string, payload: { event?: { seq?: number } }) => {
        if (payload.event?.seq !== undefined) order.push(`send:${payload.event.seq}`);
      }),
    };
    const handler = createEmitHandler(
      () => null,
      'session-1',
      undefined,
      [],
      { get: vi.fn() } as never,
      new ToolRegistry(),
      new Set(),
      new Set(),
      gateway as never,
      persist as never,
    );

    handler.batch([
      stamped({
        kind: 'tool_result',
        seq: 4,
        toolCallId: 'call-1',
        status: 'succeeded',
        projection: {
          summary: 'Done',
          artifacts: [{ kind: 'asset', id: 'asset-public', mediaType: 'video' }],
        },
        durationMs: 2,
      }),
      stamped({
        kind: 'context_fact',
        seq: 5,
        schemaVersion: 1,
        source: { kind: 'tool_result', toolCallId: 'call-1', toolResultSeq: 4 },
        completeness: 'complete',
        facts: [{
          kind: 'authority_ref',
          authority: 'canvas',
          relation: 'read',
          id: 'canvas-1',
        }],
      }),
    ]);

    expect(persist).toHaveBeenCalledOnce();
    expect(order).toEqual(['persist:4,5', 'send:4', 'send:5']);
    expect(persist.mock.calls[0]?.[0]?.[0]?.event).toMatchObject({
      kind: 'tool_result',
      summary: 'Done',
      artifacts: [{ kind: 'asset', id: 'asset-public', mediaType: 'video' }],
    });
  });

  it('persists private recovery in the public batch before broadcasting without logging it', () => {
    const sentinel = 'SECRET_TOOL_RESULT_AND_REASONING';
    const order: string[] = [];
    const codec: CommanderRecoveryCodec = {
      assertAvailable: vi.fn(),
      encrypt: (value) => Buffer.from(value, 'utf8').reverse(),
      decrypt: (value) => Buffer.from(value).reverse().toString('utf8'),
    };
    const persisted: Array<{ event: { seq: number }; privatePayload?: Buffer }> = [];
    const gateway = {
      emit: vi.fn((_channel: string, payload: { event?: { seq?: number } }) => {
        if (payload.event?.seq !== undefined) order.push(`send:${payload.event.seq}`);
      }),
    };
    const registry = new ToolRegistry();
    const handler = createEmitHandler(
      () => null,
      'session-1',
      undefined,
      [],
      { get: vi.fn() } as never,
      registry,
      new Set(),
      new Set(),
      gateway as never,
      (events) => {
        persisted.push(...events);
        order.push(`persist:${events.map(({ event }) => event.seq).join(',')}`);
      },
      { codec, previousHash: null },
    );

    handler.batch([{
      event: stamped({
        kind: 'tool_result', seq: 4, toolCallId: 'call-1', status: 'succeeded',
        projection: { summary: 'Done' }, durationMs: 2,
      }),
      recovery: { kind: 'tool_result', result: { secret: sentinel } },
    }]);

    expect(order).toEqual(['persist:4', 'send:4']);
    expect(JSON.stringify(persisted.map(({ event }) => event))).not.toContain(sentinel);
    expect(gateway.emit.mock.calls.flat()).not.toContain(sentinel);
    expect(JSON.stringify(Object.values(logger).flatMap((method) => method.mock.calls)))
      .not.toContain(sentinel);
    expect(openCommanderRecoveryPayload(codec, persisted[0]!.privatePayload!)).toMatchObject({
      kind: 'tool_result',
      result: { secret: sentinel },
    });
  });

  it('seals a completed model checkpoint with the strict recovery field names', () => {
    const sentinel = 'PRIVATE_MODEL_CHECKPOINT_CONTENT';
    const codec: CommanderRecoveryCodec = {
      assertAvailable: vi.fn(),
      encrypt: (value) => Buffer.from(value, 'utf8').reverse(),
      decrypt: (value) => Buffer.from(value).reverse().toString('utf8'),
    };
    const persisted: Array<{ event: { seq: number }; privatePayload?: Buffer }> = [];
    const gateway = { emit: vi.fn() };
    const handler = createEmitHandler(
      () => null,
      'session-1',
      undefined,
      [],
      { get: vi.fn() } as never,
      new ToolRegistry(),
      new Set(),
      new Set(),
      gateway as never,
      (events) => persisted.push(...events),
      { codec, previousHash: null },
    );

    handler({
      event: stamped({
        kind: 'public_progress',
        seq: 5,
        operationId: 'model:1',
        status: 'completed',
        summary: 'Completed safely',
      }),
      recovery: {
        kind: 'model_checkpoint',
        content: sentinel,
        finishReason: 'stop',
        toolCalls: [],
        completedStep: 1,
      },
    });

    expect(JSON.stringify(persisted.map(({ event }) => event))).not.toContain(sentinel);
    expect(JSON.stringify(gateway.emit.mock.calls)).not.toContain(sentinel);
    expect(openCommanderRecoveryPayload(codec, persisted[0]!.privatePayload!)).toMatchObject({
      kind: 'model_checkpoint',
      content: sentinel,
      finishReason: 'stop',
      toolCalls: [],
      completedStep: 1,
    });
  });

  it('does not persist or broadcast any item when one batch projection is invalid', () => {
    const persist = vi.fn();
    const gateway = { emit: vi.fn() };
    const handler = createEmitHandler(
      () => null,
      'session-1',
      undefined,
      [],
      { get: vi.fn() } as never,
      new ToolRegistry(),
      new Set(),
      new Set(),
      gateway as never,
      persist,
    );

    expect(() => handler.batch([
      stamped({ kind: 'assistant_text', seq: 4, content: 'safe', isDelta: false }),
      stamped({
        kind: 'context_fact',
        seq: 5,
        schemaVersion: 1,
        source: { kind: 'tool_result', toolCallId: 'call-1', toolResultSeq: 4 },
        completeness: 'complete',
        facts: [{
          kind: 'authority_ref',
          authority: 'canvas',
          relation: 'read',
          id: 'canvas-1',
          ignored: 'private-extra',
        }],
      }),
    ])).toThrow(/unrecognized/i);
    expect(persist).not.toHaveBeenCalled();
    expect(gateway.emit).not.toHaveBeenCalled();
  });
});
