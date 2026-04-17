import { assertNever } from './assert-never.js';

/**
 * Exhaustive pattern match on a discriminated union by its `kind`-style tag.
 *
 * @example
 *   type Event = { type: 'click'; x: number } | { type: 'keydown'; key: string };
 *   const label = match(evt, 'type', {
 *     click:   (e) => `click at ${e.x}`,
 *     keydown: (e) => `key ${e.key}`,
 *   });
 *
 * The `tag` parameter lets callers pick the discriminant field explicitly —
 * some repos use `kind`, some `type`, some `role`. Passing it here means the
 * helper stays one definition rather than copies per discriminant name.
 *
 * If a runtime value carries a tag that no handler in `handlers` covers (e.g.
 * legacy data predating a new variant), we throw via `assertNever` so the
 * failure is loud instead of silently wrong.
 */
export function match<
  T extends Record<string, unknown>,
  K extends keyof T,
  R,
>(
  value: T,
  tag: K,
  handlers: {
    [V in Extract<T[K], string | number | symbol>]: (
      v: Extract<T, Record<K, V>>,
    ) => R;
  },
): R {
  const key = value[tag] as Extract<T[K], string | number | symbol>;
  const handler = handlers[key];
  if (handler === undefined) {
    return assertNever(value as never, `match on ${String(tag)}=${String(key)}`);
  }
  return handler(value as never);
}

/**
 * `match` specialised for DUs with a conventional `kind` discriminant — the
 * most common shape in this codebase, so we save callers from repeating the
 * literal every time.
 */
export function matchKind<T extends { kind: string }, R>(
  value: T,
  handlers: { [V in T['kind']]: (v: Extract<T, { kind: V }>) => R },
): R {
  return match(value, 'kind', handlers as never);
}

/**
 * `match` specialised for DUs discriminated by `mode` — used by tool params
 * where `mode: 'create' | 'update' | ...` is the conventional tag.
 */
export function matchParams<T extends { mode: string }, R>(
  value: T,
  handlers: { [V in T['mode']]: (v: Extract<T, { mode: V }>) => R },
): R {
  return match(value, 'mode', handlers as never);
}
