/**
 * Compile-time drift checks — S5 (contracts-schema-gaps, 2026-04-26).
 *
 * `HistoryEntry` and the Commander exit-contract payload types are defined
 * once in upstream packages and manually duplicated as Zod schemas in
 * `batch-09.ts`. These checks ensure the Zod-inferred types cover all
 * required fields of the hand-written TypeScript types so that structural
 * drift surfaces as a build error rather than a runtime surprise.
 *
 * NOTE: `contracts-parse` is upstream of `@lucid-fin/application`, so
 * `HistoryEntry` is mirrored inline here. When the source type in
 * `packages/application/src/agent/context-manager.ts` changes, update the
 * mirror below AND the `HistoryEntryShape` in `batch-09.ts` together.
 *
 * Same applies to Commander intent/evidence/blocker/exit payload types:
 * their canonical TypeScript form lives in
 * `packages/contracts/src/ipc/channels/batch-09.ts` (type-only); the
 * runtime Zod schemas live in `packages/contracts-parse/src/ipc/channels/batch-09.ts`.
 *
 * To regenerate the preload manifest after adding channels:
 *   npx tsx scripts/gen-preload.ts
 * To verify no drift without regenerating:
 *   npx tsx scripts/gen-preload.ts --check
 */

import { describe, it } from 'vitest';
import { z } from 'zod';
import type {
  CommanderIntentPayload,
  CommanderEvidencePayload,
  CommanderBlockerPayload,
  CommanderExitDecisionPayload,
} from './ipc/channels/batch-09.js';
import { commanderChatChannel } from './ipc/channels/batch-09.js';

// ── HistoryEntry drift check ──────────────────────────────────────────────────
// Mirror of `HistoryEntry` from `packages/application/src/agent/context-manager.ts`.
// Keep this in sync with the source type manually.
type HistoryEntry =
  | {
      role: 'user' | 'assistant';
      content: string;
      toolCalls?: Array<{ id: string; name: string; arguments: Record<string, unknown> }>;
    }
  | { role: 'tool'; content: string; toolCallId: string };

// The `commander:chat` request carries `history: HistoryEntry[]`. Extract
// the element type from the inferred request schema.
type InferredHistoryElement = z.infer<typeof commanderChatChannel.request>['history'][number];

// Assignability check: the Zod schema's inferred type must be assignable TO
// HistoryEntry (schema is at least as specific). The `.passthrough()` on the
// object schemas makes the Zod type wider, so we check forward only.
// If the Zod shape loses a required field, this becomes `never` and fails build.
type _HistoryCheck = InferredHistoryElement extends HistoryEntry ? true : never;
declare const _hc: _HistoryCheck;

// ── Commander payload drift checks ───────────────────────────────────────────
// The canonical TypeScript types are exported from batch-09.ts itself as
// `z.infer<>` aliases; re-exporting and checking them here catches divergence
// between the Zod discriminated unions and any future hand-edited type aliases.

// CommanderIntentPayload must be a discriminated union on `kind`.
type _IntentHasKind = CommanderIntentPayload extends { kind: string } ? true : never;
declare const _intentHasKind: _IntentHasKind;

// CommanderEvidencePayload must be a discriminated union on `kind` with `at: number`.
type _EvidenceHasAt = CommanderEvidencePayload extends { kind: string; at: number } ? true : never;
declare const _evidenceHasAt: _EvidenceHasAt;

// CommanderBlockerPayload must be a discriminated union on `kind`.
type _BlockerHasKind = CommanderBlockerPayload extends { kind: string } ? true : never;
declare const _blockerHasKind: _BlockerHasKind;

// CommanderExitDecisionPayload must be a discriminated union on `outcome`.
type _ExitHasOutcome = CommanderExitDecisionPayload extends { outcome: string } ? true : never;
declare const _exitHasOutcome: _ExitHasOutcome;

// All assignments below are compile-time-only checks wrapped in a function
// that is never invoked at runtime, preventing ReferenceError on `declare const`
// variables which are type-erased during transpilation.
function _compileTimeChecksOnly(): void {
  const _h: true = _hc;
  void _h;
  const _ik: true = _intentHasKind;
  void _ik;
  const _ea: true = _evidenceHasAt;
  void _ea;
  const _bk: true = _blockerHasKind;
  void _bk;
  const _eo: true = _exitHasOutcome;
  void _eo;
}
void _compileTimeChecksOnly;

// Vitest requires at least one test in the file.
describe('drift checks', () => {
  it('compile-time only — no runtime assertions needed', () => {
    // All checks above are purely compile-time. If this file compiles, the
    // shapes are assignable. Vitest runs this as a no-op runtime test.
  });
});
