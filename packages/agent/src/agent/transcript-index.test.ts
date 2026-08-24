import { describe, expect, it } from 'vitest';
import type { LLMMessage } from '@lucid-fin/contracts';
import { TranscriptIndex } from './transcript-index.js';

describe('TranscriptIndex', () => {
  it('indexes repeated fallback ids against their nearest preceding assistant call', () => {
    const messages: LLMMessage[] = [
      {
        role: 'assistant',
        content: '',
        toolCalls: [{ id: 'tool-call-0', name: 'canvas.getNode', arguments: { nodeId: 'n1' } }],
      },
      { role: 'tool', toolCallId: 'tool-call-0', content: '{"success":true}' },
      {
        role: 'assistant',
        content: '',
        toolCalls: [{ id: 'tool-call-0', name: 'canvas.getNode', arguments: { nodeId: 'n2' } }],
      },
      { role: 'tool', toolCallId: 'tool-call-0', content: '{"success":true}' },
      {
        role: 'assistant',
        content: '',
        toolCalls: [{ id: 'tool-call-0', name: 'canvas.getNode', arguments: { nodeId: 'n2' } }],
      },
      { role: 'tool', toolCallId: 'tool-call-0', content: '{"success":true}' },
    ];

    const index = new TranscriptIndex();
    index.rebuild(messages);

    expect(index.toolMessageAt(1)).toMatchObject({
      toolName: 'canvas.getNode',
      paramsHash: '{"nodeId":"n1"}',
      compositeKey: 'tool-call-0|canvas.getNode|{"nodeId":"n1"}#1',
    });
    expect(index.toolMessageAt(3)).toMatchObject({
      toolName: 'canvas.getNode',
      paramsHash: '{"nodeId":"n2"}',
      compositeKey: 'tool-call-0|canvas.getNode|{"nodeId":"n2"}#1',
    });
    expect(index.toolMessageAt(5)?.compositeKey).toBe(
      'tool-call-0|canvas.getNode|{"nodeId":"n2"}#2',
    );
    expect(index.latestToolMessageIndex('tool-call-0')).toBe(5);
    expect(index.firstToolMessageIndex('tool-call-0')).toBe(1);
  });

  it('indexes appended tool messages without rebuilding the prior transcript', () => {
    const messages: LLMMessage[] = [
      {
        role: 'assistant',
        content: '',
        toolCalls: [{ id: 'call-1', name: 'entity.list', arguments: { page: 1 } }],
      },
    ];
    const index = new TranscriptIndex();
    index.rebuild(messages);

    messages.push({ role: 'tool', toolCallId: 'call-1', content: '{"success":true}' });
    index.sync(messages);

    expect(index.toolMessages()).toHaveLength(1);
    expect(index.toolMessageAt(1)).toMatchObject({
      toolName: 'entity.list',
      paramsHash: '{"page":1}',
    });
  });
});
