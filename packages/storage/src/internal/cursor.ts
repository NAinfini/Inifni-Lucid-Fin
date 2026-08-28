import { canonicalJson, parseCanonical, strictObject, z } from '@lucid-fin/contracts';
import { StorageError } from '../kernel/errors.js';

const CursorPayloadSchema = strictObject({
  scope: z.string().trim().min(1).max(80),
  key: z.string().min(1).max(500),
});

export function encodeCursor(scope: string, key: string): string {
  const payload = parseCanonical(CursorPayloadSchema, { scope, key });
  return `cur_${Buffer.from(canonicalJson(payload), 'utf8').toString('base64url')}`;
}

export function decodeCursor(cursor: string | null, scope: string): string | null {
  if (cursor === null) return null;
  try {
    if (!cursor.startsWith('cur_')) throw new Error('Invalid cursor prefix');
    const decoded = Buffer.from(cursor.slice(4), 'base64url').toString('utf8');
    const payload = parseCanonical(CursorPayloadSchema, JSON.parse(decoded) as unknown);
    if (payload.scope !== scope) throw new Error('Cursor scope mismatch');
    return payload.key;
  } catch (cause) {
    throw new StorageError('INVALID_REQUEST', 'Cursor is invalid for this query', { cause });
  }
}
