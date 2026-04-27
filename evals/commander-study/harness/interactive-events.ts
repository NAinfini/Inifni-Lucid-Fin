type AnyEvent = Record<string, unknown>;

export interface HarnessToolCallEvent {
  id: string;
  name?: string;
  args?: Record<string, unknown>;
}

function asRecord(event: unknown): AnyEvent {
  return event && typeof event === 'object' ? (event as AnyEvent) : {};
}

function toolRefName(value: unknown): string | undefined {
  const ref = asRecord(value);
  if (typeof ref.domain !== 'string' || typeof ref.action !== 'string') return undefined;
  const version = typeof ref.version === 'number' ? `@${ref.version}` : '';
  return `${ref.domain}.${ref.action}${version}`;
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export function getQuestionPromptId(event: unknown): string | null {
  const rec = asRecord(event);
  if (rec.kind === 'question_prompt' && typeof rec.questionId === 'string') {
    return rec.questionId;
  }
  if (rec.kind === 'tool_question' && typeof rec.toolCallId === 'string') {
    return rec.toolCallId;
  }
  return null;
}

export function getToolCall(event: unknown): HarnessToolCallEvent | null {
  const rec = asRecord(event);
  if (rec.kind === 'tool_call' && typeof rec.toolCallId === 'string') {
    return {
      id: rec.toolCallId,
      name: toolRefName(rec.toolRef),
      args: recordValue(rec.args),
    };
  }
  if (rec.kind === 'tool_call_started' && typeof rec.toolCallId === 'string') {
    const rawName = rec.toolName ?? rec.name;
    return {
      id: rec.toolCallId,
      name: typeof rawName === 'string' ? rawName : undefined,
    };
  }
  if (rec.kind === 'tool_call_args_complete' && typeof rec.toolCallId === 'string') {
    return {
      id: rec.toolCallId,
      args: recordValue(rec.arguments ?? rec.args),
    };
  }
  return null;
}

export function getConfirmationPromptToolCallId(event: unknown): string | null {
  const rec = asRecord(event);
  if (rec.kind === 'tool_confirm_prompt' && typeof rec.toolCallId === 'string') {
    return rec.toolCallId;
  }
  if (rec.kind === 'tool_confirm' && typeof rec.toolCallId === 'string') {
    return rec.toolCallId;
  }
  return null;
}
