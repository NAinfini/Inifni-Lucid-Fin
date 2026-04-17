/**
 * Pure type shapes for the `health:*` channels. Runtime zod schemas live in
 * `@lucid-fin/contracts-parse`; this file is consumed by the generated
 * `lucid-api.generated.ts` for typing `window.lucidAPI`.
 */

export interface HealthPingRequest {
  // Phase A ping is payload-free — kept as an interface rather than an alias
  // so Phase-later additions land as an optional field without breaking
  // consumers that spread `{} as HealthPingRequest`.
  _?: never;
}

export interface HealthPingResponse {
  ok: true;
  uptime: number;
}
