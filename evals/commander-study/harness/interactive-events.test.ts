import { describe, expect, it } from 'vitest';

import {
  getConfirmationPromptToolCallId,
  getQuestionPromptId,
  getToolCall,
} from './interactive-events.js';

// ---------------------------------------------------------------------------
// getQuestionPromptId
// ---------------------------------------------------------------------------

describe('getQuestionPromptId', () => {
  it('extracts id from question_prompt event', () => {
    expect(getQuestionPromptId({ kind: 'question_prompt', questionId: 'q-1' })).toBe('q-1');
  });

  it('extracts id from tool_question event', () => {
    expect(getQuestionPromptId({ kind: 'tool_question', toolCallId: 'tc-42' })).toBe('tc-42');
  });

  it('returns null for unrecognized event kind', () => {
    expect(getQuestionPromptId({ kind: 'tool_result', toolCallId: 'tc-1' })).toBeNull();
  });

  it('returns null when questionId is missing on question_prompt', () => {
    expect(getQuestionPromptId({ kind: 'question_prompt' })).toBeNull();
  });

  it('returns null when toolCallId is missing on tool_question', () => {
    expect(getQuestionPromptId({ kind: 'tool_question' })).toBeNull();
  });

  it('returns null for non-string questionId', () => {
    expect(getQuestionPromptId({ kind: 'question_prompt', questionId: 42 })).toBeNull();
  });

  it('returns null for null input', () => {
    expect(getQuestionPromptId(null)).toBeNull();
  });

  it('returns null for undefined input', () => {
    expect(getQuestionPromptId(undefined)).toBeNull();
  });

  it('returns null for primitive input', () => {
    expect(getQuestionPromptId('not-an-event')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// getConfirmationPromptToolCallId
// ---------------------------------------------------------------------------

describe('getConfirmationPromptToolCallId', () => {
  it('extracts from tool_confirm_prompt event', () => {
    expect(
      getConfirmationPromptToolCallId({ kind: 'tool_confirm_prompt', toolCallId: 'tc-1' }),
    ).toBe('tc-1');
  });

  it('extracts from tool_confirm event', () => {
    expect(
      getConfirmationPromptToolCallId({ kind: 'tool_confirm', toolCallId: 'tc-2' }),
    ).toBe('tc-2');
  });

  it('returns null for unrecognized event kind', () => {
    expect(getConfirmationPromptToolCallId({ kind: 'tool_result', toolCallId: 'tc-1' })).toBeNull();
  });

  it('returns null when toolCallId is missing', () => {
    expect(getConfirmationPromptToolCallId({ kind: 'tool_confirm_prompt' })).toBeNull();
  });

  it('returns null for non-string toolCallId', () => {
    expect(
      getConfirmationPromptToolCallId({ kind: 'tool_confirm_prompt', toolCallId: 123 }),
    ).toBeNull();
  });

  it('returns null for null input', () => {
    expect(getConfirmationPromptToolCallId(null)).toBeNull();
  });

  it('returns null for undefined input', () => {
    expect(getConfirmationPromptToolCallId(undefined)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// getToolCall
// ---------------------------------------------------------------------------

describe('getToolCall', () => {
  describe('v2 tool_call format', () => {
    it('extracts name from toolRef domain.action', () => {
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

    it('includes version suffix when toolRef has version', () => {
      expect(
        getToolCall({
          kind: 'tool_call',
          toolCallId: 'tc-3',
          toolRef: { domain: 'canvas', action: 'generate', version: 2 },
          args: { nodeId: 'n-1' },
        }),
      ).toEqual({
        id: 'tc-3',
        name: 'canvas.generate@2',
        args: { nodeId: 'n-1' },
      });
    });

    it('handles tool_call without args', () => {
      const result = getToolCall({
        kind: 'tool_call',
        toolCallId: 'tc-4',
        toolRef: { domain: 'meta', action: 'inspect' },
      });
      expect(result).toEqual({
        id: 'tc-4',
        name: 'meta.inspect',
        args: undefined,
      });
    });

    it('handles tool_call without toolRef', () => {
      const result = getToolCall({
        kind: 'tool_call',
        toolCallId: 'tc-5',
      });
      expect(result).toEqual({
        id: 'tc-5',
        name: undefined,
        args: undefined,
      });
    });

    it('ignores array args (not a record)', () => {
      const result = getToolCall({
        kind: 'tool_call',
        toolCallId: 'tc-6',
        toolRef: { domain: 'canvas', action: 'list' },
        args: [1, 2, 3],
      });
      expect(result?.args).toBeUndefined();
    });
  });

  describe('legacy tool_call_started format', () => {
    it('extracts name from toolName field', () => {
      expect(
        getToolCall({
          kind: 'tool_call_started',
          toolCallId: 'tc-10',
          toolName: 'canvas.createNodes',
        }),
      ).toEqual({
        id: 'tc-10',
        name: 'canvas.createNodes',
        args: undefined,
      });
    });

    it('falls back to name field when toolName is absent', () => {
      expect(
        getToolCall({
          kind: 'tool_call_started',
          toolCallId: 'tc-11',
          name: 'canvas.deleteNode',
        }),
      ).toEqual({
        id: 'tc-11',
        name: 'canvas.deleteNode',
        args: undefined,
      });
    });

    it('returns undefined name when neither toolName nor name is present', () => {
      const result = getToolCall({
        kind: 'tool_call_started',
        toolCallId: 'tc-12',
      });
      expect(result).toEqual({
        id: 'tc-12',
        name: undefined,
        args: undefined,
      });
    });
  });

  describe('tool_call_args_complete format', () => {
    it('extracts args from arguments field', () => {
      const result = getToolCall({
        kind: 'tool_call_args_complete',
        toolCallId: 'tc-20',
        arguments: { nodeId: 'n-1', type: 'image' },
      });
      expect(result).toEqual({
        id: 'tc-20',
        args: { nodeId: 'n-1', type: 'image' },
      });
    });

    it('falls back to args field', () => {
      const result = getToolCall({
        kind: 'tool_call_args_complete',
        toolCallId: 'tc-21',
        args: { id: 'char-1' },
      });
      expect(result).toEqual({
        id: 'tc-21',
        args: { id: 'char-1' },
      });
    });

    it('handles missing arguments and args', () => {
      const result = getToolCall({
        kind: 'tool_call_args_complete',
        toolCallId: 'tc-22',
      });
      expect(result).toEqual({
        id: 'tc-22',
        args: undefined,
      });
    });
  });

  describe('edge cases', () => {
    it('returns null for unrecognized event kind', () => {
      expect(getToolCall({ kind: 'model_streaming', active: true })).toBeNull();
    });

    it('returns null for tool_call without toolCallId', () => {
      expect(getToolCall({ kind: 'tool_call' })).toBeNull();
    });

    it('returns null for non-string toolCallId', () => {
      expect(getToolCall({ kind: 'tool_call', toolCallId: 123 })).toBeNull();
    });

    it('returns null for null input', () => {
      expect(getToolCall(null)).toBeNull();
    });

    it('returns null for undefined input', () => {
      expect(getToolCall(undefined)).toBeNull();
    });

    it('returns null for primitive input', () => {
      expect(getToolCall(42)).toBeNull();
    });

    it('returns null for empty object', () => {
      expect(getToolCall({})).toBeNull();
    });
  });
});
