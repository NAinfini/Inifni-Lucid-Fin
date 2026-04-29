/**
 * Shared SSE (Server-Sent Events) stream parser for LLM adapters.
 *
 * Extracts JSON objects from `data: ` lines in an SSE response stream.
 * Handles buffering, line splitting, and the `[DONE]` sentinel.
 *
 * Used by OpenAI-compatible, Claude, and Gemini adapters.
 */

/**
 * Async generator that reads an SSE response stream and yields parsed JSON
 * objects from each `data: ` line. Skips `data: [DONE]` sentinels and
 * silently ignores malformed JSON lines.
 */
export async function* parseSseStream(response: Response): AsyncGenerator<unknown> {
  const reader = response.body?.getReader();
  if (!reader) return;

  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.startsWith('data: ') || line === 'data: [DONE]') continue;
        try {
          yield JSON.parse(line.slice(6));
        } catch {
          console.warn('[sse-parser] malformed JSON line (content redacted)');
        }
      }
    }
  } finally {
    try {
      reader.cancel();
    } catch {
      /* best-effort */
    }
    try {
      reader.releaseLock();
    } catch {
      /* best-effort */
    }
  }
}
