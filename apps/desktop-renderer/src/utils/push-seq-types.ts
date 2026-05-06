/**
 * `utils/push-seq-types.ts` — Shared types for the push envelope with
 * sequence numbers. Mirrors the shape defined in the main process
 * push-gateway but is importable from renderer code without pulling
 * in Electron dependencies.
 */

/** Envelope sent over the wire for every push event (R29). */
export interface PushEnvelope<P = unknown> {
  readonly seq: number;
  readonly channel: string;
  readonly data: P;
}
