import { describe, expect, it } from 'vitest';
import { buildCommanderHistory } from './history-builder.js';
import type { CommanderMessage } from '../state/types.js';

function userMsg(content: string): CommanderMessage {
  return { id: 'u1', role: 'user', content, timestamp: 0 };
}

function assistantMsg(content: string, partial?: Partial<CommanderMessage>): CommanderMessage {
  return { id: 'a1', role: 'assistant', content, timestamp: 0, ...partial };
}

describe('buildCommanderHistory', () => {
  it('passes through plain user + assistant turns', () => {
    const history = buildCommanderHistory([userMsg('hello'), assistantMsg('hi')]);
    expect(history).toEqual([
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'hi' },
    ]);
  });

  it('skips empty (whitespace-only) turns', () => {
    const history = buildCommanderHistory([userMsg('   '), assistantMsg('real response')]);
    expect(history).toHaveLength(1);
    expect(history[0]).toEqual({ role: 'assistant', content: 'real response' });
  });

  it('emits tool-call entries followed by tool-result entries for completed calls', () => {
    const history = buildCommanderHistory([
      userMsg('do thing'),
      assistantMsg('', {
        toolCalls: [
          {
            name: 'canvas.getNode',
            id: 'tc1',
            arguments: { id: 'n1' },
            startedAt: 0,
            completedAt: 1,
            status: 'done',
            result: { node: 'x' },
          },
        ],
      }),
    ]);

    expect(history).toEqual([
      { role: 'user', content: 'do thing' },
      {
        role: 'assistant',
        content: '',
        toolCalls: [{ id: 'tc1', name: 'canvas.getNode', arguments: { id: 'n1' } }],
      },
      { role: 'tool', content: JSON.stringify({ node: 'x' }), toolCallId: 'tc1' },
    ]);
  });

  it('treats assistant turns with only-pending tool calls as plain text', () => {
    const history = buildCommanderHistory([
      assistantMsg('still thinking', {
        toolCalls: [
          {
            name: 'canvas.getNode',
            id: 'tc1',
            arguments: {},
            startedAt: 0,
            status: 'pending',
          },
        ],
      }),
    ]);

    expect(history).toEqual([{ role: 'assistant', content: 'still thinking' }]);
  });

  it('emits string tool results verbatim (no double JSON-encode)', () => {
    const history = buildCommanderHistory([
      assistantMsg('', {
        toolCalls: [
          {
            name: 'log.read',
            id: 'tc1',
            arguments: {},
            startedAt: 0,
            completedAt: 1,
            status: 'done',
            result: 'line one\nline two',
          },
        ],
      }),
    ]);

    expect(history[1]).toEqual({
      role: 'tool',
      content: 'line one\nline two',
      toolCallId: 'tc1',
    });
  });
});
