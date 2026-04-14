/**
 * Shared error-building utilities for LLM adapters.
 *
 * Extracts identical helper functions that were duplicated across
 * OpenAI-compatible and Claude adapters.
 */
import { ErrorCode } from '@lucid-fin/contracts';

/**
 * Attempt to parse a string as JSON. Returns `undefined` if the string is
 * empty or not valid JSON (never throws).
 */
export function tryParseJson(value: string): unknown {
  if (!value.trim()) {
    return undefined;
  }

  try {
    return JSON.parse(value) as unknown;
  } catch { /* malformed JSON -- return undefined so caller can fall back */
    return undefined;
  }
}

/**
 * Serialize an error value into a shape suitable for LucidError details.
 * Error instances are decomposed into `{ name, message, stack? }`;
 * strings pass through; everything else is JSON-stringified.
 */
export function serializeError(error: unknown): Record<string, unknown> | string {
  if (error instanceof Error) {
    const serialized: Record<string, unknown> = {
      name: error.name,
      message: error.message,
    };
    if (error.stack) {
      serialized.stack = error.stack;
    }
    return serialized;
  }
  return typeof error === 'string' ? error : JSON.stringify(error);
}

/**
 * Measure diagnostic metrics from a request body for error reporting.
 *
 * Supports both OpenAI-style (system messages in the messages array) and
 * Claude-style (top-level `system` string field) request bodies.
 */
export function measureRequestDiagnostics(requestBody: Record<string, unknown>): Record<string, unknown> {
  const messages = Array.isArray(requestBody.messages)
    ? requestBody.messages as Array<Record<string, unknown>>
    : [];
  const tools = Array.isArray(requestBody.tools)
    ? requestBody.tools as Array<Record<string, unknown>>
    : [];

  // OpenAI-style: system messages in the messages array
  const systemMessageChars = messages
    .filter((message) => message.role === 'system' && typeof message.content === 'string')
    .reduce((sum, message) => sum + String(message.content).length, 0);

  // Claude-style: top-level system string
  const topLevelSystemChars = typeof requestBody.system === 'string'
    ? requestBody.system.length
    : 0;

  return {
    requestBytes: Buffer.byteLength(JSON.stringify(requestBody), 'utf8'),
    messageCount: messages.length,
    toolCount: tools.length,
    systemPromptChars: systemMessageChars + topLevelSystemChars,
  };
}

/**
 * Truncate a string for inclusion in error diagnostics.
 * Appends `"..."` if the value exceeds `maxChars`.
 */
export function truncateForDiagnostics(value: string, maxChars = 4000): string {
  if (value.length <= maxChars) {
    return value;
  }
  return `${value.slice(0, maxChars)}...`;
}

/**
 * Resolve the final ErrorCode from an HTTP status and a fallback code.
 * 404 always maps to NotFound; everything else uses the fallback.
 */
export function resolveErrorCode(status: number, fallback: ErrorCode): ErrorCode {
  if (status === 404) {
    return ErrorCode.NotFound;
  }
  return fallback;
}
