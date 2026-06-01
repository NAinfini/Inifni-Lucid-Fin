import { describe, it, expect, vi } from 'vitest';
import { parseSseStream } from './sse-parser.js';

function mockSseResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
  return new Response(stream);
}

async function collectAll(gen: AsyncGenerator<unknown>): Promise<unknown[]> {
  const results: unknown[] = [];
  for await (const item of gen) {
    results.push(item);
  }
  return results;
}

describe('parseSseStream', () => {
  it('yields parsed JSON objects from data lines', async () => {
    const response = mockSseResponse([
      'data: {"id":"1","text":"hello"}\n',
      'data: {"id":"2","text":"world"}\n',
    ]);

    const results = await collectAll(parseSseStream(response));

    expect(results).toEqual([
      { id: '1', text: 'hello' },
      { id: '2', text: 'world' },
    ]);
  });

  it('skips data: [DONE] sentinel', async () => {
    const response = mockSseResponse([
      'data: {"id":"1"}\n',
      'data: [DONE]\n',
    ]);

    const results = await collectAll(parseSseStream(response));

    expect(results).toEqual([{ id: '1' }]);
  });

  it('skips non-data lines (comments, event:, id:, empty lines)', async () => {
    const response = mockSseResponse([
      ': this is a comment\n',
      'event: message\n',
      'id: 123\n',
      '\n',
      'data: {"val":42}\n',
    ]);

    const results = await collectAll(parseSseStream(response));

    expect(results).toEqual([{ val: 42 }]);
  });

  it('handles multi-chunk data (JSON split across ReadableStream chunks)', async () => {
    // The JSON `{"split":"value"}` is split across two chunks
    const response = mockSseResponse([
      'data: {"spl',
      'it":"value"}\n',
    ]);

    const results = await collectAll(parseSseStream(response));

    expect(results).toEqual([{ split: 'value' }]);
  });

  it('skips malformed JSON lines silently', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const response = mockSseResponse([
      'data: {invalid json}\n',
      'data: {"valid":true}\n',
    ]);

    const results = await collectAll(parseSseStream(response));

    expect(results).toEqual([{ valid: true }]);
    warnSpy.mockRestore();
  });

  it('returns immediately if response.body is null', async () => {
    const response = new Response(null);
    // Override body to be explicitly null
    Object.defineProperty(response, 'body', { value: null });

    const results = await collectAll(parseSseStream(response));

    expect(results).toEqual([]);
  });
});
