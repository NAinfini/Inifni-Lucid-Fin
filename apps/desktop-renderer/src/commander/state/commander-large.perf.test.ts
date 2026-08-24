import { describe, expect, it } from 'vitest';
import type { TimelineEvent } from '@lucid-fin/contracts';
import type { CommanderMessage, CommanderToolCall } from './types.js';
import { computeContextUsage } from './context-usage.js';
import { deriveActiveRunView } from './run-derivation.js';

function makeMessages(messageCount: number, callsPerMessage: number): CommanderMessage[] {
  return Array.from({ length: messageCount }, (_, messageIndex) => ({
    id: `message-${messageIndex}`,
    role: messageIndex % 2 === 0 ? ('user' as const) : ('assistant' as const),
    content: `message ${messageIndex} ${'x'.repeat(120)}`,
    timestamp: messageIndex,
    toolCalls: Array.from({ length: callsPerMessage }, (_, callIndex): CommanderToolCall => ({
      id: `call-${messageIndex}-${callIndex}`,
      name: 'canvas.getNode',
      summary: `Read node ${callIndex}`,
      details: { nodeId: `node-${callIndex}` },
      artifacts: [{ kind: 'canvas_node', id: `node-${callIndex}` }],
      startedAt: callIndex,
      completedAt: callIndex + 1,
      status: 'done',
    })),
  }));
}

function referenceContextUsage(messages: CommanderMessage[]): number {
  let chars = 0;
  for (const message of messages) {
    chars += message.content.length;
    for (const call of message.toolCalls ?? []) {
      chars += JSON.stringify({ summary: call.summary, details: call.details }).length;
      chars += JSON.stringify({ artifacts: call.artifacts, errorCode: call.errorCode }).length;
    }
  }
  return chars;
}

function medianMs(run: () => unknown): number {
  const durations: number[] = [];
  for (let sample = 0; sample < 9; sample++) {
    const startedAt = performance.now();
    run();
    durations.push(performance.now() - startedAt);
  }
  durations.sort((a, b) => a - b);
  return durations[4] ?? 0;
}

describe('Commander large-session performance', () => {
  it('does not re-stringify an unchanged transcript for every stream update', () => {
    const messages = makeMessages(1_000, 10);
    computeContextUsage({
      messages,
      currentStreamContent: '',
      currentToolCalls: [],
      contextWindowTokens: 200_000,
      backendContextUsage: null,
    });

    const referenceMs = medianMs(() => referenceContextUsage(messages));
    const cachedMs = medianMs(() =>
      computeContextUsage({
        messages,
        currentStreamContent: 'next delta',
        currentToolCalls: [],
        contextWindowTokens: 200_000,
        backendContextUsage: null,
      }),
    );

    console.info('Commander context usage', { referenceMs, cachedMs });
    expect(cachedMs).toBeLessThan(referenceMs * 0.2);
  });

  it('reports active-run projection growth under streamed deltas', () => {
    const events: TimelineEvent[] = [
      {
        kind: 'run_start',
        workType: 'agent',
        runId: 'run-1',
        intent: 'benchmark',
        resourceBudget: {},
        step: 0,
        seq: 0,
        emittedAt: 0,
      },
      ...Array.from({ length: 5_000 }, (_, index): TimelineEvent => ({
        kind: 'assistant_text',
        runId: 'run-1',
        content: 'x',
        isDelta: true,
        step: 1,
        seq: index + 1,
        emittedAt: index + 1,
      })),
    ];
    const startedAt = performance.now();
    let view = deriveActiveRunView(events.slice(0, 1), [], []);
    for (let length = 2; length <= events.length; length++) {
      view = deriveActiveRunView(events.slice(0, length), [], []);
    }
    const cumulativeMs = performance.now() - startedAt;

    console.info('Commander cumulative timeline projection', { events: events.length, cumulativeMs });
    expect(view.streamContent).toHaveLength(5_000);
  });
});
