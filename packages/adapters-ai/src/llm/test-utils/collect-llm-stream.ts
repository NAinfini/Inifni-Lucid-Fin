import type { LLMStreamEvent, LLMFinishReason, LLMToolCall } from '@lucid-fin/contracts';

export interface CollectedLLMStream {
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
 * Drain an LLMStreamEvent stream into the legacy flat shape. Used by
 * adapter tests that predate the streaming rewrite — replicates what the
 * orchestrator does internally in `drainLLMStream`.
 */
export async function collectLLMStream(
  stream: Promise<AsyncIterable<LLMStreamEvent>> | AsyncIterable<LLMStreamEvent>,
): Promise<CollectedLLMStream> {
  const iter = await stream;
  let content = '';
  let reasoning = '';
  const toolCallsById = new Map<string, LLMToolCall>();
  const toolOrder: string[] = [];
  let finishReason: LLMFinishReason = 'stop';
  let usage: CollectedLLMStream['usage'];

  for await (const event of iter) {
    switch (event.kind) {
      case 'reasoning_delta':
        reasoning += event.delta;
        break;
      case 'text_delta':
        content += event.delta;
        break;
      case 'tool_call_started':
        if (!toolCallsById.has(event.id)) {
          toolOrder.push(event.id);
          toolCallsById.set(event.id, { id: event.id, name: event.name, arguments: {} });
        }
        break;
      case 'tool_call_args_delta':
        // Tests don't depend on the raw arg-delta stream — the final
        // arguments land via `tool_call_complete`.
        break;
      case 'tool_call_complete': {
        const existing = toolCallsById.get(event.id);
        if (existing) {
          existing.name = event.name || existing.name;
          existing.arguments = event.arguments;
        } else {
          toolOrder.push(event.id);
          toolCallsById.set(event.id, {
            id: event.id,
            name: event.name,
            arguments: event.arguments,
          });
        }
        break;
      }
      case 'usage':
        usage = {
          promptTokens: event.promptTokens,
          completionTokens: event.completionTokens,
          reasoningTokens: event.reasoningTokens,
        };
        break;
      case 'finished':
        finishReason = event.finishReason;
        break;
    }
  }

  return {
    content,
    reasoning: reasoning || undefined,
    toolCalls: toolOrder.map((id) => toolCallsById.get(id)!),
    finishReason,
    usage,
  };
}
