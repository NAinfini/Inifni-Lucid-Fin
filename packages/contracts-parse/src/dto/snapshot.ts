/**
 * StoredSnapshot DTO schema — Phase G1-2.10.
 *
 * The `data` column stays a serialized JSON blob string (not re-parsed at
 * read time) so the repository's read path doesn't tax every snapshot
 * lookup. Callers that need to introspect snapshot contents must parse
 * `data` themselves.
 */

import { z } from 'zod';

export const StoredSnapshotSchema = z.object({
  id: z.string().min(1),
  sessionId: z.string().min(1),
  label: z.string(),
  trigger: z.enum(['auto', 'manual']),
  data: z.string(),
  createdAt: z.number(),
});
export type StoredSnapshotDto = z.infer<typeof StoredSnapshotSchema>;
