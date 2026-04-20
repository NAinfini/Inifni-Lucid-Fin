import { ErrorCode, LucidError } from '@lucid-fin/contracts';
import { describe, it, expect } from 'vitest';
import { withStallTimeout } from './stall-timeout.js';

async function* never(): AsyncIterable<string> {
  // A producer that never yields. We rely on the watchdog to cut it off.
  await new Promise(() => {});
  yield 'unreachable';
}

async function* deferredNext(sleepMs: number): AsyncIterable<string> {
  await new Promise((r) => setTimeout(r, sleepMs));
  yield 'late';
}

describe('withStallTimeout', () => {
  it('throws a SERVICE_UNAVAILABLE LucidError when no event arrives within stallMs', async () => {
    const iter = withStallTimeout(never(), { stallMs: 50, adapterName: 'Test' });
    const drain = (async () => {
      const collected: string[] = [];
      for await (const v of iter) collected.push(v);
      return collected;
    })();
    await expect(drain).rejects.toMatchObject<Partial<LucidError>>({
      code: ErrorCode.ServiceUnavailable,
      message: 'Test stream stalled: no byte for 0s',
    });
  });

  it('passes events through as long as they arrive within the window', async () => {
    async function* producer(): AsyncIterable<string> {
      yield 'a';
      yield 'b';
      yield 'c';
    }
    const collected: string[] = [];
    for await (const v of withStallTimeout(producer(), { stallMs: 1000 })) {
      collected.push(v);
    }
    expect(collected).toEqual(['a', 'b', 'c']);
  });

  it('short-circuits with CANCELLED when the signal fires mid-stream', async () => {
    const controller = new AbortController();
    const iter = withStallTimeout(deferredNext(500), {
      stallMs: 5000,
      signal: controller.signal,
      adapterName: 'Test',
    });
    const drain = (async () => {
      const collected: string[] = [];
      for await (const v of iter) collected.push(v);
      return collected;
    })();
    setTimeout(() => controller.abort(new Error('user cancel')), 20);
    await expect(drain).rejects.toMatchObject<Partial<LucidError>>({
      code: ErrorCode.Cancelled,
      message: 'Test request aborted',
    });
  });

  it('throws CANCELLED immediately if signal is already aborted on entry', async () => {
    const controller = new AbortController();
    controller.abort();
    const iter = withStallTimeout(deferredNext(0), {
      stallMs: 1000,
      signal: controller.signal,
      adapterName: 'Test',
    });
    await expect(
      (async () => {
        for await (const _ of iter) {
          /* no-op */
        }
      })(),
    ).rejects.toMatchObject<Partial<LucidError>>({
      code: ErrorCode.Cancelled,
      message: 'Test request aborted before start',
    });
  });
});
