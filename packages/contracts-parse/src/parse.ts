import { z, type ZodError, type ZodType } from 'zod';

/**
 * Telemetry callback invoked when `parseOrDegrade` has to return the
 * fallback. Features wire this to their logger/metrics so degraded reads
 * surface in dashboards without forcing every callsite to handle telemetry
 * inline.
 *
 * Kept as a mutable module-level binding rather than passed per-call because
 * degrade events are global observability concerns and we want consistent
 * wiring (similar to how `console` is global). `setDegradeReporter(null)`
 * disables reporting — useful in tests.
 */
export type DegradeReporter = (info: {
  schema: string;
  error: ZodError;
  rawValue: unknown;
  context?: string;
}) => void;

let degradeReporter: DegradeReporter | null = null;

export function setDegradeReporter(reporter: DegradeReporter | null): void {
  degradeReporter = reporter;
}

export interface ParseContext {
  /** Short human label so degrade/strict errors can name the origin. */
  name: string;
}

function schemaName(schema: ZodType<unknown>, ctx?: ParseContext): string {
  if (ctx?.name !== undefined) return ctx.name;
  // Zod schemas carry a `.description()` chain we can use when a caller
  // doesn't supply an explicit label.
  const desc = (schema as { description?: string }).description;
  return typeof desc === 'string' && desc.length > 0 ? desc : 'schema';
}

/**
 * Strict parse: for **transient** boundaries (IPC request bodies, tool args,
 * network responses) where malformed data indicates a bug upstream. We throw
 * so callers can surface the error.
 *
 * Never use this for persisted reads — corrupt legacy rows should not take
 * the whole app down. Use {@link parseOrDegrade} instead.
 */
export function parseStrict<T>(
  schema: ZodType<T>,
  raw: unknown,
  ctx?: ParseContext,
): T {
  const result = schema.safeParse(raw);
  if (result.success) return result.data;
  const name = schemaName(schema, ctx);
  const err = new Error(
    `parseStrict failed for ${name}: ${result.error.message}`,
  );
  (err as { cause?: unknown }).cause = result.error;
  throw err;
}

/**
 * Degrade-or-parse: for **persisted** reads (DB rows, snapshot JSON, Redux
 * rehydration) where a corrupt record must not crash the app. Returns the
 * parsed value when valid, otherwise returns `fallback` and fires the
 * registered degrade reporter with the underlying ZodError.
 *
 * Callers can opt into strict mode per-call (e.g. in tests) by passing
 * `{ throwOnDegrade: true }`.
 */
export function parseOrDegrade<T>(
  schema: ZodType<T>,
  raw: unknown,
  fallback: T,
  options?: { ctx?: ParseContext; throwOnDegrade?: boolean },
): T {
  const result = schema.safeParse(raw);
  if (result.success) return result.data;
  const name = schemaName(schema, options?.ctx);
  if (options?.throwOnDegrade === true) {
    const err = new Error(
      `parseOrDegrade strict-mode failure for ${name}: ${result.error.message}`,
    );
    (err as { cause?: unknown }).cause = result.error;
    throw err;
  }
  degradeReporter?.({
    schema: name,
    error: result.error,
    rawValue: raw,
    context: options?.ctx?.name,
  });
  return fallback;
}

/**
 * Partial parse: keep the valid shape of an object, drop or defaults fields
 * that fail. Used when a DTO gains a new required field and we want old
 * persisted records to rehydrate with defaults rather than fail whole.
 *
 * `schema` must be the full schema; `defaults` provides per-field defaults
 * for any key that zod rejects. This helper is deliberately shallow —
 * callers composing nested partial parses do so explicitly.
 */
export function parsePartial<T extends Record<string, unknown>>(
  schema: ZodType<T>,
  raw: unknown,
  defaults: T,
  options?: { ctx?: ParseContext },
): T {
  if (raw === null || typeof raw !== 'object') return defaults;
  const merged = { ...defaults, ...(raw as Record<string, unknown>) };
  const result = schema.safeParse(merged);
  if (result.success) return result.data;

  // Iteratively apply defaults only for failing fields. For each default key,
  // check if swapping just that key into the current candidate makes the
  // parse succeed or at least reduces the error. If it doesn't help, keep
  // the user-supplied value.
  let candidate = { ...merged } as Record<string, unknown>;
  for (const key of Object.keys(defaults)) {
    // Try replacing this one key with the default
    const withDefault = { ...candidate, [key]: defaults[key] };
    const probe = schema.safeParse(withDefault);
    if (probe.success) return probe.data;
    // Even if not fully valid yet, check if this key was part of the problem
    // by comparing error counts. If replacing the key reduces errors, keep it.
    const currentErrors = schema.safeParse(candidate);
    const currentCount = currentErrors.success
      ? 0
      : currentErrors.error.issues.length;
    const withDefaultErrors = probe.success ? 0 : probe.error.issues.length;
    if (withDefaultErrors < currentCount) {
      candidate = withDefault;
    }
  }
  // Last attempt with all accumulated fixes
  const final = schema.safeParse(candidate);
  if (final.success) return final.data;
  return parseOrDegrade(schema, candidate, defaults, options);
}

/**
 * Compose a brand parser from a zod schema — the canonical pattern repeated
 * per-brand in `./brands/`.
 *
 * @example
 *   export const parseProviderId = makeBrandParser(
 *     z.string().min(1).regex(/^[a-z0-9-]+$/),
 *     'ProviderId',
 *   );
 */
export function makeBrandParser<B, Raw = string>(
  schema: ZodType<Raw>,
  brandName: string,
): (raw: unknown) => B {
  const named = schema.describe(brandName);
  return (raw: unknown): B => parseStrict(named, raw, { name: brandName }) as unknown as B;
}

/**
 * Narrower `tryBrand` — return `undefined` on invalid input. Useful in
 * renderer code where a failed parse maps to "disable this button" rather
 * than "throw".
 */
export function makeTryBrand<B, Raw = string>(
  schema: ZodType<Raw>,
): (raw: unknown) => B | undefined {
  return (raw: unknown): B | undefined => {
    const result = schema.safeParse(raw);
    return result.success ? (result.data as unknown as B) : undefined;
  };
}

// Re-export zod so callers in this package share a single version.
export { z };
