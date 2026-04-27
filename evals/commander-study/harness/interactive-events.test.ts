import { describe, expect, it } from 'vitest';

import {
  getConfirmationPromptToolCallId,
  getQuestionPromptId,
  getToolCall,
} from './interactive-events.js';

describe('interactive event compatibility', () => {
  it('recognizes current question_prompt events', () => {
    expect(getQuestionPromptId({ kind: 'question_prompt', questionId: 'q-1' })).toBe('q-1');
  });

  it('recognizes current tool_confirm_prompt events', () => {
    expect(
      getConfirmationPromptToolCallId({ kind: 'tool_confirm_prompt', toolCallId: 'tc-1' }),
    ).toBe('tc-1');
  });

  it('extracts current tool_call names and args', () => {
    expect(
      getToolCall({
        kind: 'tool_call',
        toolCallId: 'tc-2',
        toolRef: { domain: 'guide', action: 'get' },
        args: { ids: ['workflow'] },
      }),
    ).toEqual({
      id: 'tc-2',
      name: 'guide.get',
      args: { ids: ['workflow'] },
    });
  });
});
