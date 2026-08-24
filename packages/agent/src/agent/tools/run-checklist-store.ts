/**
 * Run-scoped store backing the transient Commander checklist tool.
 *
 * One instance is created per agent run. The orchestrator owns the
 * lifecycle; tool handlers read/write via the methods below. Evidence
 * recording and stream emission are driven by caller-supplied hooks so
 * the store stays agnostic of orchestrator internals.
 *
 * Semantics:
 * - `set` replaces any active checklist wholesale and generates a fresh
 *   `checklistId`. If called twice in one run, the second call wins.
 * - `update` refuses to apply when its `checklistId` does not match the
 *   active checklist (drift guard — catches replay-after-replace bugs).
 * - At most one item may be `in_progress`. `set` auto-marks the first
 *   item `in_progress`; `update` rejects batches that would leave more
 *   than one item in that state.
 */

export type RunChecklistItemStatus = 'pending' | 'in_progress' | 'done';

export interface RunChecklistItem {
  readonly id: string;
  readonly label: string;
  readonly status: RunChecklistItemStatus;
}

export interface RunChecklistSnapshot {
  readonly checklistId: string;
  readonly items: ReadonlyArray<RunChecklistItem>;
}

export interface RunChecklistSetInput {
  /** Human-facing labels, model-authored. Length must be in [2, 10]. */
  items: ReadonlyArray<{ label: string }>;
}

export interface RunChecklistUpdateInput {
  checklistId: string;
  updates: ReadonlyArray<{ id: string; status: RunChecklistItemStatus }>;
}

export interface RunChecklistStoreOptions {
  /** Nanoid-like id generator. Caller injects for determinism in tests. */
  generateId: (kind: 'checklist' | 'item') => string;
  /** Called after a successful `set`. */
  onSnapshot?: (snapshot: RunChecklistSnapshot, kind: 'set') => void;
  /** Called after a successful `update`. Carries delta plus full snapshot. */
  onUpdate?: (
    snapshot: RunChecklistSnapshot,
    updates: ReadonlyArray<{ id: string; status: RunChecklistItemStatus }>,
  ) => void;
}

const MIN_ITEMS = 2;
const MAX_ITEMS = 10;
const MAX_LABEL_CHARS = 120;

export class RunChecklistStoreError extends Error {
  constructor(
    message: string,
    readonly kind:
      | 'items_range'
      | 'empty_label'
      | 'unknown_id'
      | 'mismatched_checklist'
      | 'duplicate_in_progress'
      | 'no_active_checklist',
  ) {
    super(message);
    this.name = 'RunChecklistStoreError';
  }
}

export class RunChecklistStore {
  private snapshot: RunChecklistSnapshot | null = null;

  constructor(private readonly opts: RunChecklistStoreOptions) {}

  /** Current active snapshot, or null if no `runChecklist.manage { action: 'set' }` has fired yet. */
  current(): RunChecklistSnapshot | null {
    return this.snapshot;
  }

  set(input: RunChecklistSetInput): RunChecklistSnapshot {
    const trimmed = input.items
      .map((i) => ({ label: (i.label ?? '').trim().slice(0, MAX_LABEL_CHARS) }))
      .filter((i) => i.label.length > 0);

    if (trimmed.length < MIN_ITEMS || trimmed.length > MAX_ITEMS) {
      throw new RunChecklistStoreError(
        `runChecklist.manage { action: 'set' } requires between ${MIN_ITEMS} and ${MAX_ITEMS} non-empty items (got ${trimmed.length}).`,
        'items_range',
      );
    }

    const checklistId = this.opts.generateId('checklist');
    const items: RunChecklistItem[] = trimmed.map((t, idx) => ({
      id: this.opts.generateId('item'),
      label: t.label,
      // Model owns "current step" UX; first item starts in_progress so
      // the UI has something to highlight immediately.
      status: idx === 0 ? 'in_progress' : 'pending',
    }));

    this.snapshot = { checklistId, items };
    this.opts.onSnapshot?.(this.snapshot, 'set');
    return this.snapshot;
  }

  toStreamPayload(): { runChecklist: RunChecklistSnapshot } | null {
    if (!this.snapshot) return null;
    return { runChecklist: this.snapshot };
  }

  update(input: RunChecklistUpdateInput): {
    snapshot: RunChecklistSnapshot;
    applied: ReadonlyArray<{ id: string; status: RunChecklistItemStatus }>;
  } {
    if (!this.snapshot) {
      throw new RunChecklistStoreError(
        "runChecklist.manage { action: 'update' } called before runChecklist.manage { action: 'set' }. Call runChecklist.manage { action: 'set' } first to author the list.",
        'no_active_checklist',
      );
    }
    if (this.snapshot.checklistId !== input.checklistId) {
      throw new RunChecklistStoreError(
        `runChecklist.manage { action: 'update' } targeted checklistId "${input.checklistId}" but the active checklist is "${this.snapshot.checklistId}". Re-read the active id via a recent snapshot and retry.`,
        'mismatched_checklist',
      );
    }

    // Simulate the post-update item set before committing so invalid
    // batches don't leave partial state.
    const next = new Map(this.snapshot.items.map((i) => [i.id, i] as const));
    for (const upd of input.updates) {
      const existing = next.get(upd.id);
      if (!existing) {
        throw new RunChecklistStoreError(
          `runChecklist.manage { action: 'update' } referenced item id "${upd.id}" which is not in the active list.`,
          'unknown_id',
        );
      }
      next.set(upd.id, { ...existing, status: upd.status });
    }

    const inProgressCount = Array.from(next.values()).filter(
      (i) => i.status === 'in_progress',
    ).length;
    if (inProgressCount > 1) {
      throw new RunChecklistStoreError(
        "runChecklist.manage { action: 'update' } would leave more than one item in_progress. Mark prior items done or pending first.",
        'duplicate_in_progress',
      );
    }

    const items: RunChecklistItem[] = this.snapshot.items.map((i) => next.get(i.id) ?? i);
    this.snapshot = { checklistId: this.snapshot.checklistId, items };
    this.opts.onUpdate?.(this.snapshot, input.updates);
    return { snapshot: this.snapshot, applied: input.updates };
  }
}
