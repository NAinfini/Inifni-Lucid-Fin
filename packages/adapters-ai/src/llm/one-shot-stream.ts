import type { LLMStreamEvent, LLMToolCall, LLMFinishReason } from '@lucid-fin/contracts';

export interface OneShotStreamInput {
  content: string;
  reasoning?: string;
  toolCalls: LLMToolCall[];
  finishReason: LLMFinishReason;
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    reasoningTokens?: number;
  };
}

/**
 * Wrap a fully-materialized non-streaming completion into the
 * LLMStreamEvent sequence expected by the orchestrator. Used by adapters
 * that don't yet stream token-by-token (Claude, Gemini, Cohere, Ollama,
 * OpenAI Responses). The orchestrator builds its OrchestratorCompletion by
 * folding this same event sequence, so non-streaming adapters stay wire-
 * compatible with streaming ones.
 */
export async function* oneShotStream(input: OneShotStreamInput): AsyncIterable<LLMStreamEvent> {
  if (input.reasoning) {
    yield { kind: 'reasoning_delta', delta: input.reasoning };
  }
  if (input.content) {
    yield { kind: 'text_delta', delta: input.content };
  }
  for (const tc of input.toolCalls) {
    yield { kind: 'tool_call_started', id: tc.id, name: tc.name };
    yield { kind: 'tool_call_args_delta', id: tc.id, delta: JSON.stringify(tc.arguments) };
    yield { kind: 'tool_call_complete', id: tc.id, name: tc.name, arguments: tc.arguments };
  }
  if (input.usage) {
    yield {
      kind: 'usage',
      promptTokens: input.usage.promptTokens,
      completionTokens: input.usage.completionTokens,
      reasoningTokens: input.usage.reasoningTokens,
    };
  }
  yield {
    kind: 'finished',
    finishReason: input.toolCalls.length > 0 ? 'tool_calls' : input.finishReason,
  };
}
