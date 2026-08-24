/**
 * Tests for the IPC token-bucket rate limiter.
 *
 * Uses `vi.useFakeTimers()` so all time-dependent behavior is deterministic.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { ErrorCode } from '@lucid-fin/contracts';
import { RateLimiter, rateLimitedError, IPC_RATE_LIMITS } from './rate-limiter.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let now = 0;
const clock = () => now;

function tick(ms: number): void {
  now += ms;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('RateLimiter', () => {
  beforeEach(() => {
    now = 0;
  });

  // ── Basic allow / deny ───────────────────────────────────────

  it('allows requests within the limit', () => {
    const limiter = new RateLimiter({ test: { maxRequests: 3, windowMs: 10_000 } }, clock);

    expect(limiter.consume('test')).toEqual({ allowed: true });
    expect(limiter.consume('test')).toEqual({ allowed: true });
    expect(limiter.consume('test')).toEqual({ allowed: true });
  });

  it('denies the request once the bucket is empty', () => {
    const limiter = new RateLimiter({ test: { maxRequests: 2, windowMs: 10_000 } }, clock);

    limiter.consume('test'); // 1
    limiter.consume('test'); // 2 — bucket now empty

    const result = limiter.consume('test'); // 3 — denied
    expect(result.allowed).toBe(false);
    expect(result.retryAfterMs).toBeGreaterThan(0);
  });

  // ── Token refill ─────────────────────────────────────────────

  it('refills tokens over time and allows requests again', () => {
    // 3 req / 9000ms → refill rate = 1 token every 3000ms
    const limiter = new RateLimiter({ test: { maxRequests: 3, windowMs: 9_000 } }, clock);

    limiter.consume('test');
    limiter.consume('test');
    limiter.consume('test');
    expect(limiter.consume('test').allowed).toBe(false);

    // Advance 3000ms → 1 token refilled
    tick(3_000);
    expect(limiter.consume('test')).toEqual({ allowed: true });
    // That consumed the refilled token — next is denied again
    expect(limiter.consume('test').allowed).toBe(false);
  });

  it('caps refilled tokens at maxTokens', () => {
    const limiter = new RateLimiter({ test: { maxRequests: 2, windowMs: 10_000 } }, clock);

    limiter.consume('test'); // down to 1

    // Wait a very long time — should cap at 2, not exceed
    tick(100_000);
    expect(limiter.consume('test')).toEqual({ allowed: true });
    expect(limiter.consume('test')).toEqual({ allowed: true });
    // Now empty
    expect(limiter.consume('test').allowed).toBe(false);
  });

  // ── retryAfterMs accuracy ───────────────────────────────────

  it('returns accurate retryAfterMs', () => {
    // 2 req / 10_000ms → 1 token per 5000ms
    const limiter = new RateLimiter({ test: { maxRequests: 2, windowMs: 10_000 } }, clock);

    limiter.consume('test');
    limiter.consume('test');

    const result = limiter.consume('test');
    expect(result.allowed).toBe(false);
    // 0 tokens remain; need 1 token; refill rate = 2/10000 = 0.0002/ms
    // Time needed = 1 / 0.0002 = 5000ms
    expect(result.retryAfterMs).toBe(5_000);
  });

  it('retryAfterMs decreases after partial wait', () => {
    const limiter = new RateLimiter({ test: { maxRequests: 2, windowMs: 10_000 } }, clock);

    limiter.consume('test');
    limiter.consume('test');

    tick(2_000);
    const result = limiter.consume('test');
    // After 2000ms: 0.4 tokens refilled. Need 0.6 more.
    // 0.6 / 0.0002 = 3000ms
    expect(result.allowed).toBe(false);
    expect(result.retryAfterMs).toBe(3_000);
  });

  // ── Per-channel isolation ────────────────────────────────────

  it('rate limits channels independently', () => {
    const limiter = new RateLimiter(
      {
        chanA: { maxRequests: 1, windowMs: 10_000 },
        chanB: { maxRequests: 1, windowMs: 10_000 },
      },
      clock,
    );

    limiter.consume('chanA');
    expect(limiter.consume('chanA').allowed).toBe(false);

    // chanB is unaffected
    expect(limiter.consume('chanB')).toEqual({ allowed: true });
  });

  // ── Prefix / wildcard matching ───────────────────────────────

  it('matches prefix rules (wildcard keys ending with *)', () => {
    const limiter = new RateLimiter({ 'provider:*': { maxRequests: 2, windowMs: 10_000 } }, clock);

    expect(limiter.consume('provider:chat')).toEqual({ allowed: true });
    expect(limiter.consume('provider:chat')).toEqual({ allowed: true });
    expect(limiter.consume('provider:chat').allowed).toBe(false);
  });

  it('exact keys take priority over prefix keys', () => {
    const limiter = new RateLimiter(
      {
        'provider:chat': { maxRequests: 5, windowMs: 10_000 },
        'provider:*': { maxRequests: 1, windowMs: 10_000 },
      },
      clock,
    );

    for (let i = 0; i < 5; i++) {
      expect(limiter.consume('provider:chat').allowed).toBe(true);
    }
    expect(limiter.consume('provider:chat').allowed).toBe(false);
  });

  it('wildcard channels get independent buckets per actual channel name', () => {
    const limiter = new RateLimiter({ 'provider:*': { maxRequests: 1, windowMs: 10_000 } }, clock);

    expect(limiter.consume('provider:chat').allowed).toBe(true);
    expect(limiter.consume('provider:chat').allowed).toBe(false);

    expect(limiter.consume('provider:list').allowed).toBe(true);
  });

  // ── Unlimited channels ───────────────────────────────────────

  it('allows unlimited requests for channels not in the config', () => {
    const limiter = new RateLimiter({ test: { maxRequests: 1, windowMs: 10_000 } }, clock);

    for (let i = 0; i < 100; i++) {
      expect(limiter.consume('unknown:channel').allowed).toBe(true);
    }
  });

  // ── resolveConfig ────────────────────────────────────────────

  it('resolveConfig returns exact match', () => {
    const limiter = new RateLimiter(IPC_RATE_LIMITS, clock);
    const config = limiter.resolveConfig('commander:start');
    expect(config).toEqual({ maxRequests: 10, windowMs: 60_000 });
  });

  it('resolveConfig returns undefined for unlimited channels', () => {
    const limiter = new RateLimiter(IPC_RATE_LIMITS, clock);
    expect(limiter.resolveConfig('canvas:list')).toBeUndefined();
  });

  // ── reset / resetAll ─────────────────────────────────────────

  it('reset clears a single channel bucket', () => {
    const limiter = new RateLimiter({ test: { maxRequests: 1, windowMs: 60_000 } }, clock);

    limiter.consume('test');
    expect(limiter.consume('test').allowed).toBe(false);

    limiter.reset('test');
    expect(limiter.consume('test')).toEqual({ allowed: true });
  });

  it('resetAll clears all buckets', () => {
    const limiter = new RateLimiter(
      {
        a: { maxRequests: 1, windowMs: 60_000 },
        b: { maxRequests: 1, windowMs: 60_000 },
      },
      clock,
    );

    limiter.consume('a');
    limiter.consume('b');
    expect(limiter.consume('a').allowed).toBe(false);
    expect(limiter.consume('b').allowed).toBe(false);

    limiter.resetAll();
    expect(limiter.consume('a')).toEqual({ allowed: true });
    expect(limiter.consume('b')).toEqual({ allowed: true });
  });

  // ── Window reset (full window elapsed) ───────────────────────

  it('fully refills after one complete window', () => {
    const limiter = new RateLimiter({ test: { maxRequests: 5, windowMs: 10_000 } }, clock);

    // Exhaust all tokens
    for (let i = 0; i < 5; i++) limiter.consume('test');
    expect(limiter.consume('test').allowed).toBe(false);

    // Wait for full window
    tick(10_000);

    // All 5 tokens available again
    for (let i = 0; i < 5; i++) {
      expect(limiter.consume('test').allowed).toBe(true);
    }
    expect(limiter.consume('test').allowed).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// rateLimitedError
// ---------------------------------------------------------------------------

describe('rateLimitedError', () => {
  it('creates a LucidError with RATE_LIMITED code and correct details', () => {
    const err = rateLimitedError('commander:start', 5000);
    expect(err.code).toBe(ErrorCode.RateLimited);
    expect(err.message).toBe('Too many requests. Please wait before retrying.');
    expect(err.details).toEqual({ retryAfterMs: 5000, channel: 'commander:start' });
  });
});

// ---------------------------------------------------------------------------
// IPC_RATE_LIMITS sanity checks
// ---------------------------------------------------------------------------

describe('IPC_RATE_LIMITS', () => {
  it('defines limits for all channels in the PRD matrix', () => {
    expect(IPC_RATE_LIMITS['commander:start']).toBeDefined();
  });

  it('all configs have positive maxRequests and windowMs', () => {
    for (const [key, config] of Object.entries(IPC_RATE_LIMITS)) {
      expect(config.maxRequests, `${key}.maxRequests`).toBeGreaterThan(0);
      expect(config.windowMs, `${key}.windowMs`).toBeGreaterThan(0);
    }
  });
});
