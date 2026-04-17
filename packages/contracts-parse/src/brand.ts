/**
 * Construct a branded value without validation.
 *
 * Intersection-brand IDs (declared in `@lucid-fin/contracts`) are nominal at
 * the type level only — there is no runtime wrapper. To create a fresh brand
 * we need a single, reviewed escape hatch that converts the structural type
 * to the branded type. That escape hatch is this function, and it lives here
 * because `@lucid-fin/contracts` is type-only (zero runtime by pact).
 *
 * **Call sites are lint-restricted**: only parsers (e.g. `parseProviderId`),
 * fresh-ID factories (e.g. `freshJobId`), and zod `.transform(...)` bodies
 * should import this. Everything else must parse through a typed gateway.
 */
export function unsafeBrand<T>(value: unknown): T {
  return value as T;
}
