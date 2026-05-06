/**
 * Token-bucket rate limiter for IPC channels.
 *
 * Each channel gets an independent bucket that starts full (at `maxTokens`)
 * and refills at a constant rate of `maxTokens / windowMs` tokens per
 * millisecond. A request consumes one token. When the bucket is empty the
 * request is rejected with the number of milliseconds until a token becomes
 * available.
 *
 * The implementation is fully synchronous — no timers, no async. Tokens are
 * lazily refilled on every `consume()` call based on elapsed wall-clock time.
 */

import { ErrorCode, LucidError } from '@lucid-fin/contracts';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface RateLimitConfig {
  /** Maximum requests allowed within the time window. */
  readonly maxRequests: number;
  /** Time window in milliseconds. */
  readonly windowMs: number;
}

export interface ConsumeResult {
  readonly allowed: boolean;
  /** Present only when `allowed === false`. Milliseconds until the next
   *  token becomes available. */
  readonly retryAfterMs?: number;
}

// ---------------------------------------------------------------------------
// Per-channel rate limit definitions
// ---------------------------------------------------------------------------

/**
 * Channels that should be rate-limited. Channels not listed here (and not
 * matching a prefix rule) are unlimited.
 *
 * Prefix keys end with `*` and match any channel that starts with the prefix
 * (minus the `*`). Exact keys take priority over prefix keys.
 */
export const IPC_RATE_LIMITS: Readonly<Record<string, RateLimitConfig>> = {
  // AI generation channels — expensive, rate limit aggressively
  'commander:chat': { maxRequests: 10, windowMs: 60_000 },
  'canvas:generate': { maxRequests: 5, windowMs: 60_000 },
  'entity:generateReferenceImage': { maxRequests: 5, windowMs: 60_000 },

  // Embedding — cheaper but still external API
  'asset:generateEmbedding': { maxRequests: 20, windowMs: 60_000 },

  // Catch-all for any AI channel not explicitly listed
  'ai:*': { maxRequests: 15, windowMs: 60_000 },
};

// ---------------------------------------------------------------------------
// Token bucket
// ---------------------------------------------------------------------------

interface Bucket {
  tokens: number;
  lastRefillAt: number;
  readonly maxTokens: number;
  readonly refillRate: number; // tokens per ms
}

function createBucket(config: RateLimitConfig, now: number): Bucket {
  return {
    tokens: config.maxRequests,
    lastRefillAt: now,
    maxTokens: config.maxRequests,
    refillRate: config.maxRequests / config.windowMs,
  };
}

function refill(bucket: Bucket, now: number): void {
  const elapsed = now - bucket.lastRefillAt;
  if (elapsed <= 0) return;
  bucket.tokens = Math.min(bucket.maxTokens, bucket.tokens + elapsed * bucket.refillRate);
  bucket.lastRefillAt = now;
}

// ---------------------------------------------------------------------------
// RateLimiter class
// ---------------------------------------------------------------------------

export class RateLimiter {
  private readonly buckets = new Map<string, Bucket>();
  private readonly limits: Readonly<Record<string, RateLimitConfig>>;
  /** Injected clock for testability; defaults to `Date.now`. */
  private readonly now: () => number;

  constructor(
    limits: Readonly<Record<string, RateLimitConfig>> = IPC_RATE_LIMITS,
    clock?: () => number,
  ) {
    this.limits = limits;
    this.now = clock ?? Date.now;
  }

  /**
   * Look up the rate limit config for a channel. Exact match takes priority;
   * if none, try prefix matches (keys ending in `*`).
   */
  resolveConfig(channel: string): RateLimitConfig | undefined {
    const exact = this.limits[channel];
    if (exact) return exact;

    // Prefix match — iterate over wildcard entries
    for (const key of Object.keys(this.limits)) {
      if (key.endsWith('*') && channel.startsWith(key.slice(0, -1))) {
        return this.limits[key];
      }
    }

    return undefined;
  }

  /**
   * Attempt to consume one token for `channel`.
   *
   * Returns `{ allowed: true }` if the request is within limits.
   * Returns `{ allowed: false, retryAfterMs }` if the bucket is empty.
   *
   * Channels without a matching rate limit config are always allowed.
   */
  consume(channel: string): ConsumeResult {
    const config = this.resolveConfig(channel);
    if (!config) return { allowed: true };

    const now = this.now();
    let bucket = this.buckets.get(channel);
    if (!bucket) {
      bucket = createBucket(config, now);
      this.buckets.set(channel, bucket);
    }

    refill(bucket, now);

    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      return { allowed: true };
    }

    // Not enough tokens — calculate how long until one token refills
    const deficit = 1 - bucket.tokens;
    const retryAfterMs = Math.ceil(deficit / bucket.refillRate);
    return { allowed: false, retryAfterMs };
  }

  /** Reset the bucket for a specific channel (useful in tests). */
  reset(channel: string): void {
    this.buckets.delete(channel);
  }

  /** Reset all buckets. */
  resetAll(): void {
    this.buckets.clear();
  }
}

// ---------------------------------------------------------------------------
// Singleton for production use
// ---------------------------------------------------------------------------

let defaultInstance: RateLimiter | undefined;

/** Get or create the module-level singleton rate limiter. */
export function getIpcRateLimiter(): RateLimiter {
  if (!defaultInstance) {
    defaultInstance = new RateLimiter();
  }
  return defaultInstance;
}

/** Replace the singleton (used by tests). */
export function setIpcRateLimiter(limiter: RateLimiter): void {
  defaultInstance = limiter;
}

// ---------------------------------------------------------------------------
// Helper: throw a structured LucidError when rate-limited
// ---------------------------------------------------------------------------

/**
 * Build the `LucidError` thrown when an IPC call is rate-limited.
 * The `details` object matches the contract defined in the PRD:
 * `{ code: 'RATE_LIMITED', retryAfterMs, channel }`.
 */
export function rateLimitedError(channel: string, retryAfterMs: number): LucidError {
  return new LucidError(
    ErrorCode.RateLimited,
    'Too many requests. Please wait before retrying.',
    { retryAfterMs, channel },
  );
}
