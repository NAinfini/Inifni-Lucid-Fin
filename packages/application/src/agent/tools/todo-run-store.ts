/**
 * Run-scoped store backing the `todo.set` / `todo.update` tools.
 *
 * One instance is created per agent run. The orchestrator owns the
 * lifecycle; tool handlers read/write via the methods below. Evidence
 * recording and stream emission are driven by caller-supplied hooks so
 * the store stays agnostic of orchestrator internals.
 *
 * Semantics:
 * - `set` replaces any active todo wholesale and generates a fresh
 *   `todoId`. If called twice in one run, the second call wins.
 * - `update` refuses to apply when its `todoId` does not match the
 *   active todo (drift guard — catches replay-after-replace bugs).
 * - At most one item may be `in_progress`. `set` auto-marks the first
 *   item `in_progress`; `update` rejects batches that would leave more
 *   than one item in that state.
 */

export type TodoStatus = 'pending' | 'in_progress' | 'done';

export interface TodoItem {
  readonly id: string;
  readonly label: string;
  readonly status: TodoStatus;
}

export interface TodoSnapshot {
  readonly todoId: string;
  readonly items: ReadonlyArray<TodoItem>;
}

export interface TodoSetInput {
  /** Human-facing labels, model-authored. Length must be in [2, 10]. */
  items: ReadonlyArray<{ label: string }>;
}

export interface TodoUpdateInput {
  todoId: string;
  updates: ReadonlyArray<{ id: string; status: TodoStatus }>;
}

export interface TodoRunStoreOptions {
  /** Nanoid-like id generator. Caller injects for determinism in tests. */
  generateId: (kind: 'todo' | 'item') => string;
  /** Called after a successful `set`. */
  onSnapshot?: (snapshot: TodoSnapshot, kind: 'set') => void;
  /** Called after a successful `update`. Carries delta plus full snapshot. */
  onUpdate?: (
    snapshot: TodoSnapshot,
    updates: ReadonlyArray<{ id: string; status: TodoStatus }>,
  ) => void;
}

const MIN_ITEMS = 2;
const MAX_ITEMS = 10;
const MAX_LABEL_CHARS = 120;

export class TodoRunStoreError extends Error {
  constructor(
    message: string,
    readonly kind:
      | 'items_range'
      | 'empty_label'
      | 'unknown_id'
      | 'mismatched_todo'
      | 'duplicate_in_progress'
      | 'no_active_todo',
  ) {
    super(message);
    this.name = 'TodoRunStoreError';
  }
}

export class TodoRunStore {
  private snapshot: TodoSnapshot | null = null;

  constructor(private readonly opts: TodoRunStoreOptions) {}

  /** Current active snapshot, or null if no `todo.set` has fired yet. */
  current(): TodoSnapshot | null {
    return this.snapshot;
  }

  set(input: TodoSetInput): TodoSnapshot {
    const trimmed = input.items
      .map((i) => ({ label: (i.label ?? '').trim().slice(0, MAX_LABEL_CHARS) }))
      .filter((i) => i.label.length > 0);

    if (trimmed.length < MIN_ITEMS || trimmed.length > MAX_ITEMS) {
      throw new TodoRunStoreError(
        `todo.set requires between ${MIN_ITEMS} and ${MAX_ITEMS} non-empty items (got ${trimmed.length}).`,
        'items_range',
      );
    }

    const todoId = this.opts.generateId('todo');
    const items: TodoItem[] = trimmed.map((t, idx) => ({
      id: this.opts.generateId('item'),
      label: t.label,
      // Model owns "current step" UX; first item starts in_progress so
      // the UI has something to highlight immediately.
      status: idx === 0 ? 'in_progress' : 'pending',
    }));

    this.snapshot = { todoId, items };
    this.opts.onSnapshot?.(this.snapshot, 'set');
    return this.snapshot;
  }

  toStreamPayload(): { todoSnapshot: TodoSnapshot } | null {
    if (!this.snapshot) return null;
    return { todoSnapshot: this.snapshot };
  }

  update(input: TodoUpdateInput): {
    snapshot: TodoSnapshot;
    applied: ReadonlyArray<{ id: string; status: TodoStatus }>;
  } {
    if (!this.snapshot) {
      throw new TodoRunStoreError(
        'todo.update called before todo.set. Call todo.set first to author the list.',
        'no_active_todo',
      );
    }
    if (this.snapshot.todoId !== input.todoId) {
      throw new TodoRunStoreError(
        `todo.update targeted todoId "${input.todoId}" but the active todo is "${this.snapshot.todoId}". Re-read the active id via a recent snapshot and retry.`,
        'mismatched_todo',
      );
    }

    // Simulate the post-update item set before committing so invalid
    // batches don't leave partial state.
    const next = new Map(this.snapshot.items.map((i) => [i.id, i] as const));
    for (const upd of input.updates) {
      const existing = next.get(upd.id);
      if (!existing) {
        throw new TodoRunStoreError(
          `todo.update referenced item id "${upd.id}" which is not in the active list.`,
          'unknown_id',
        );
      }
      next.set(upd.id, { ...existing, status: upd.status });
    }

    const inProgressCount = Array.from(next.values()).filter(
      (i) => i.status === 'in_progress',
    ).length;
    if (inProgressCount > 1) {
      throw new TodoRunStoreError(
        'todo.update would leave more than one item in_progress. Mark prior items done or pending first.',
        'duplicate_in_progress',
      );
    }

    const items: TodoItem[] = this.snapshot.items.map((i) => next.get(i.id) ?? i);
    this.snapshot = { todoId: this.snapshot.todoId, items };
    this.opts.onUpdate?.(this.snapshot, input.updates);
    return { snapshot: this.snapshot, applied: input.updates };
  }
}
