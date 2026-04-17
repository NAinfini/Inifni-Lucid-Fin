/**
 * StoredSession DTO — Phase G1-2.1.
 *
 * Zod schema mirrors the `commander_sessions` row shape (post-rowToSession).
 * Used by `SessionRepository` reads via `parseOrDegrade` so a row with
 * (say) a non-numeric created_at surfaces as a degraded-read telemetry
 * event rather than crashing commander history listing.
 *
 * Kept in contracts-parse (zod runtime) per the package pact —
 * contracts stays type-only.
 */

import { z } from 'zod';

export const StoredSessionSchema = z.object({
  id: z.string().min(1),
  canvasId: z.string().nullable(),
  title: z.string(),
  messages: z.string(),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
});

export type StoredSessionDto = z.infer<typeof StoredSessionSchema>;
