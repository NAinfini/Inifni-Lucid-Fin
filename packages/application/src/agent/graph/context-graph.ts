/**
 * ContextGraph — Phase G2a-2.
 *
 * Typed graph of ContextItem nodes with stable identity. Provides:
 *  - add/get/findLatest operations
 *  - identity-based tool-result dedup (same toolKey+paramsHash → supersede)
 *  - entity-level invalidation (invalidateByEntity)
 *  - compaction (compact — pure policy evaluation, delegates to compaction.ts)
 *  - serialize/hydrate for persistence
 *
 * Internal storage: Map<ContextItemId, ContextItem> + insertion-order array.
 * The array maintains the canonical ordering for serialization.
 */

import type {
  ContextItem,
  ContextItemId,
  EntityRef,
  ToolResultItem,
  CompactionPolicy,
  CompactionResult,
} from '@lucid-fin/contracts';
import { evaluate } from './compaction.js';
import { getToolCompactionCategory } from '@lucid-fin/shared-utils';

/**
 * Tool categories where identity-based dedup is SAFE. These are read-only
 * (idempotent) operations — the newest result always supersedes prior calls
 * with the same args. Mutations/logs must NOT dedup: two `create` calls with
 * identical args are two distinct state changes the model needs to see.
 */
const DEDUP_SAFE_CATEGORIES = new Set(['get', 'list', 'query']);

/** Approximate token count for a single ContextItem (content chars / chars-per-token). */
function estimateItemChars(item: ContextItem): number {
  switch (item.kind) {
    case 'user-message':
    case 'guide':
    case 'system-message':
    case 'session-summary':
      return item.content.length;
    case 'assistant-turn':
      return item.content.length + (item.reasoning?.length ?? 0);
    case 'tool-result':
      return JSON.stringify(item.content).length;
    case 'entity-snapshot':
      return JSON.stringify(item.snapshot).length;
    case 'reference':
      return item.referencedItemId.length;
    default:
      return 0;
  }
}

function entityRefKey(ref: EntityRef): string {
  return `${ref.entityType}:${ref.entityId}`;
}

export class ContextGraph {
  /** Canonical storage: itemId → item. */
  private readonly _map = new Map<ContextItemId, ContextItem>();
  /** Insertion-ordered IDs (for serialize and history-order traversal). */
  private readonly _order: ContextItemId[] = [];
  /**
   * Dedup index for tool-result items: `toolKey|paramsHash` → itemId.
   * Only the NEWEST item per identity is tracked; superseded items are removed.
   */
  private readonly _toolResultIndex = new Map<string, ContextItemId>();

  // ── Core operations ─────────────────────────────────────────

  /**
   * Add an item to the graph.
   *
   * If the item is a `tool-result` and an earlier item has the same
   * `(toolKey, paramsHash)`, the earlier item is removed and the new one
   * supersedes it. This replaces the ToolResultCache dedup semantics.
   */
  add(item: ContextItem): void {
    if (item.kind === 'tool-result') {
      this._addToolResult(item);
      return;
    }
    this._mapSet(item);
  }

  get(id: ContextItemId): ContextItem | undefined {
    return this._map.get(id);
  }

  /**
   * Find the most recently added item of a given kind matching the predicate.
   * Traverses insertion order in reverse.
   */
  findLatest<K extends ContextItem['kind']>(
    kind: K,
    predicate: (i: Extract<ContextItem, { kind: K }>) => boolean,
  ): Extract<ContextItem, { kind: K }> | undefined {
    for (let i = this._order.length - 1; i >= 0; i--) {
      const id = this._order[i]!;
      const item = this._map.get(id)!;
      if (item.kind !== kind) continue;
      if (predicate(item as Extract<ContextItem, { kind: K }>)) {
        return item as Extract<ContextItem, { kind: K }>;
      }
    }
    return undefined;
  }

  /**
   * Remove all `entity-snapshot` items for the given entity ref, and all
   * `tool-result` items whose `entityRef` matches. Returns the list of
   * dropped item IDs.
   */
  invalidateByEntity(ref: EntityRef): ContextItemId[] {
    const refKey = entityRefKey(ref);
    const dropped: ContextItemId[] = [];

    for (const id of [...this._order]) {
      const item = this._map.get(id);
      if (!item) continue;

      if (item.kind === 'entity-snapshot' && entityRefKey(item.entityRef) === refKey) {
        this._mapDelete(id);
        dropped.push(id);
        continue;
      }

      if (
        item.kind === 'tool-result' &&
        item.entityRef &&
        entityRefKey(item.entityRef) === refKey
      ) {
        this._mapDelete(id);
        // Also clean up the dedup index
        const dedupKey = this._toolResultDedupKey(item);
        const indexedId = this._toolResultIndex.get(dedupKey);
        if (indexedId === id) {
          this._toolResultIndex.delete(dedupKey);
        }
        dropped.push(id);
      }
    }

    return dropped;
  }

  /**
   * Evaluate a compaction policy against the graph.
   * Pure — does not mutate the graph. Returns a CompactionResult describing
   * what should be dropped or summarized. Callers that want to apply the
   * result should call `applyCompactionResult`.
   */
  compact(policy: CompactionPolicy): CompactionResult {
    return evaluate(this, policy);
  }

  /**
   * Apply a CompactionResult to the graph (drop listed items).
   * toSummarize items are NOT dropped here — callers replace them with
   * a session-summary item after the LLM call.
   */
  applyCompactionResult(result: CompactionResult): void {
    for (const id of result.dropped) {
      const item = this._map.get(id);
      if (!item) continue;
      if (item.kind === 'tool-result') {
        const dedupKey = this._toolResultDedupKey(item);
        if (this._toolResultIndex.get(dedupKey) === id) {
          this._toolResultIndex.delete(dedupKey);
        }
      }
      this._mapDelete(id);
    }
  }

  size(): { items: number; chars: number; tokens: number } {
    const CHARS_PER_TOKEN = 4;
    let chars = 0;
    for (const id of this._order) {
      const item = this._map.get(id)!;
      chars += estimateItemChars(item);
    }
    return {
      items: this._map.size,
      chars,
      tokens: Math.ceil(chars / CHARS_PER_TOKEN),
    };
  }

  // ── Serialization / hydration ──────────────────────────────

  /**
   * Serialize the graph to an insertion-ordered array (for persistence).
   * Only items still in the map are included (dropped items excluded).
   */
  serialize(): ContextItem[] {
    const result: ContextItem[] = [];
    for (const id of this._order) {
      const item = this._map.get(id);
      if (item) result.push(item);
    }
    return result;
  }

  /**
   * Static constructor that rehydrates a graph from a serialized array.
   * Preserves insertion order and rebuilds all internal indices.
   */
  static hydrate(items: ContextItem[]): ContextGraph {
    const graph = new ContextGraph();
    for (const item of items) {
      graph.add(item);
    }
    return graph;
  }

  // ── Internal helpers ───────────────────────────────────────

  private _addToolResult(item: ToolResultItem): void {
    // Only dedup tools whose category is safe — read-only / idempotent.
    // Mutations and logs must accumulate: two `character.create` calls with
    // identical args are two distinct state changes the model needs to see.
    const category = getToolCompactionCategory(String(item.toolKey));
    if (!category || !DEDUP_SAFE_CATEGORIES.has(category)) {
      this._mapSet(item);
      return;
    }
    const dedupKey = this._toolResultDedupKey(item);
    const existingId = this._toolResultIndex.get(dedupKey);
    if (existingId !== undefined) {
      this._mapDelete(existingId);
    }
    this._toolResultIndex.set(dedupKey, item.itemId);
    this._mapSet(item);
  }

  private _toolResultDedupKey(item: ToolResultItem): string {
    return `${item.toolKey}|${item.paramsHash}`;
  }

  private _mapSet(item: ContextItem): void {
    if (!this._map.has(item.itemId)) {
      this._order.push(item.itemId);
    }
    this._map.set(item.itemId, item);
  }

  private _mapDelete(id: ContextItemId): void {
    this._map.delete(id);
    const idx = this._order.indexOf(id);
    if (idx !== -1) this._order.splice(idx, 1);
  }

  // ── Internal iterators (used by compaction) ─────────────────

  /** Iterate items in insertion order (used by compaction evaluator). */
  [Symbol.iterator](): IterableIterator<ContextItem> {
    const map = this._map;
    const order = this._order;
    let i = 0;
    return {
      [Symbol.iterator]() { return this; },
      next(): IteratorResult<ContextItem> {
        while (i < order.length) {
          const id = order[i++]!;
          const item = map.get(id);
          if (item) return { value: item, done: false };
        }
        return { value: undefined as unknown as ContextItem, done: true };
      },
    };
  }
}
