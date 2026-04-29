/**
 * A minimal Result type for code paths that want to surface failure as a
 * value rather than an exception — useful at boundaries (IPC, DB) where the
 * caller wants to branch on success/failure without a try/catch, and for
 * streaming handlers where throwing mid-iterator is awkward.
 *
 * Exceptions are still the primary error mechanism in this codebase; Result
 * is deliberately narrow and lives here so features can opt in per-callsite
 * rather than the whole codebase being forced into Rust-style error flow.
 */
export type Result<T, E = Error> = { ok: true; value: T } | { ok: false; error: E };

export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

export function err<E>(error: E): Result<never, E> {
  return { ok: false, error };
}

export function isOk<T, E>(r: Result<T, E>): r is { ok: true; value: T } {
  return r.ok;
}

export function isErr<T, E>(r: Result<T, E>): r is { ok: false; error: E } {
  return !r.ok;
}

/**
 * Map the success value, passing failures through. Mirrors Rust's
 * `Result::map`. Kept separate from `match` to avoid forcing callers to
 * provide both branches when they only care about the success path.
 */
export function mapOk<T, U, E>(r: Result<T, E>, fn: (value: T) => U): Result<U, E> {
  return r.ok ? { ok: true, value: fn(r.value) } : r;
}

export function mapErr<T, E, F>(r: Result<T, E>, fn: (error: E) => F): Result<T, F> {
  return r.ok ? r : { ok: false, error: fn(r.error) };
}
