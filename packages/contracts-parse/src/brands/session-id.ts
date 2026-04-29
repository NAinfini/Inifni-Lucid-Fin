/**
 * `SessionId` brand parsers — Phase G1-2.1.
 *
 * IPC handlers receive `args.id` as raw unknown. `SessionRepository`
 * accepts only `SessionId`, so every hop from IPC into storage is
 * validated exactly once at the boundary via `parseSessionId`.
 */

import { z } from 'zod';
import type { SessionId } from '@lucid-fin/contracts';
import { makeBrandParser, makeTryBrand } from '../parse.js';

const SessionIdSchema = z
  .string()
  .min(1)
  .transform((v) => v.trim())
  .refine((v) => v.length > 0, { message: 'sessionId must be non-empty after trim' });

export const parseSessionId = makeBrandParser<SessionId, string>(SessionIdSchema, 'SessionId');

export const trySessionId = makeTryBrand<SessionId, string>(SessionIdSchema);
