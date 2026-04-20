import type { CompletionEvidence, ReadonlyCompletionEvidenceList } from './types.js';

/**
 * Append-only record of `CompletionEvidence` entries emitted during a
 * single agent run. Created at `execute()` start, discarded at terminal.
 *
 * Design points:
 *   - Append-only: `record()` is the only mutator. There is no delete,
 *     edit, or splice. History of a run is immutable once the run ends.
 *   - `entries()` returns a `readonly` slice; callers cannot mutate the
 *     backing array through the returned reference.
 *   - Zero I/O: the ledger is purely in-memory. Stream events (Phase B
 *     adds them under `evidence_appended`) are emitted by the caller,
 *     not the ledger.
 *   - Cheap to construct; no heap pressure until first `record()`.
 */
export class EvidenceLedger {
  private readonly items: CompletionEvidence[] = [];

  /** Append a new evidence entry. Order of calls = order in the ledger. */
  record(evidence: CompletionEvidence): void {
    this.items.push(evidence);
  }

  /**
   * Immutable view of the ledger. The returned array is frozen at the
   * call site, but callers should still treat it as read-only — future
   * `record()` calls will grow the underlying storage, and a cached
   * reference from an earlier snapshot will not see the growth.
   */
  entries(): ReadonlyCompletionEvidenceList {
    // Returning a copy (not the live array) keeps snapshots stable for
    // pure consumers like SuccessSignal.check and the decision engine.
    return this.items.slice();
  }

  /** Convenience count by variant — used by report aggregation. */
  countByKind(): Record<CompletionEvidence['kind'], number> {
    const counts = {
      guide_loaded: 0,
      ask_user_asked: 0,
      ask_user_answered: 0,
      mutation_commit: 0,
      validation_error: 0,
      process_prompt_activated: 0,
      generation_started: 0,
      settings_write: 0,
      user_refused: 0,
      budget_exhausted: 0,
    } as Record<CompletionEvidence['kind'], number>;
    for (const e of this.items) counts[e.kind]++;
    return counts;
  }

  /** True iff at least one successful `mutation_commit` is on the ledger. */
  hasAnySuccessfulCommit(): boolean {
    return this.items.some((e) => e.kind === 'mutation_commit' && e.resultOk);
  }

  /** Current entry count. Cheaper than `entries().length` when the caller only needs size. */
  size(): number {
    return this.items.length;
  }
}
