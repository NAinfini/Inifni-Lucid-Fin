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

  // ── Tool-result projection (G2b-5: subsumes ToolResultCache) ────

  /**
   * True when the graph holds a tool-result item with the given
   * `(toolKey, paramsHash)` identity. Replaces `ToolResultCache.hasCoverage`
   * — the serializer uses this to decide whether a fully-cached
   * assistant+tool group can be skipped.
   */
  hasToolResult(toolKey: string, paramsHash: string): boolean {
    return this._toolResultIndex.has(`${toolKey}|${paramsHash}`);
  }

  /**
   * Return the stored tool-result content for the given identity, or
   * undefined when no such item exists. Used by the tool executor's
   * read-through cache path to serve idempotent get/list calls without
   * re-executing the tool.
   */
  findLatestToolResult(toolKey: string, paramsHash: string): string | undefined {
    const id = this._toolResultIndex.get(`${toolKey}|${paramsHash}`);
    if (!id) return undefined;
    const item = this._map.get(id);
    if (!item || item.kind !== 'tool-result') return undefined;
    return typeof item.content === 'string' ? item.content : JSON.stringify(item.content);
  }

  /**
   * Like {@link findLatestToolResult} but also returns the step at which
   * the entry was produced. Lets callers (e.g. ToolExecutor read-through
   * cache) apply step-age freshness gates so cache hits don't live for
   * the whole session uncontested.
   */
  findLatestToolResultEntry(
    toolKey: string,
    paramsHash: string,
  ): { content: string; producedAtStep: number } | undefined {
    const id = this._toolResultIndex.get(`${toolKey}|${paramsHash}`);
    if (!id) return undefined;
    const item = this._map.get(id);
    if (!item || item.kind !== 'tool-result') return undefined;
    const content = typeof item.content === 'string' ? item.content : JSON.stringify(item.content);
    return { content, producedAtStep: item.producedAtStep };
  }

  /** Number of tool-result items currently in the graph. */
  countToolResults(): number {
    return this._toolResultIndex.size;
  }

  /**
   * Drop every tool-result item. Used on `snapshot.restore` since the
   * entire domain may have shifted and any cached projection is now
   * unreliable.
   */
  clearToolResults(): void {
    for (const id of [...this._toolResultIndex.values()]) {
      this._mapDelete(id);
    }
    this._toolResultIndex.clear();
    // Also drop any tool-results that weren't dedup-tracked (mutations/logs
    // held in _map but not in the index).
    for (const id of [...this._order]) {
      const item = this._map.get(id);
      if (item?.kind === 'tool-result') this._mapDelete(id);
    }
  }

  /**
   * Drop every tool-result item whose toolKey shares the mutation tool's
   * domain (the prefix before `.`). When `entityId` is provided, tool-results
   * whose paramsHash contains that id are dropped exactly; list-style results
   * for the same domain are also dropped because they may now be stale.
   *
   * Replaces `ToolResultCache.invalidateForMutation` /
   * `invalidateForMutationWithArgs`. Keeps mutation-adjacent reads honest
   * without requiring the caller to know about graph internals.
   */
  invalidateForMutation(toolName: string, args: Record<string, unknown> = {}): ContextItemId[] {
    const domain = this._domainFromToolName(toolName);
    if (!domain) return [];
    const entityId = this._extractEntityIdFromArgs(args);
    const dropped: ContextItemId[] = [];

    for (const id of [...this._order]) {
      const item = this._map.get(id);
      if (!item || item.kind !== 'tool-result') continue;

      const toolKey = String(item.toolKey);
      const itemDomain = this._domainFromToolName(toolKey);
      if (itemDomain !== domain) continue;

      const category = getToolCompactionCategory(toolKey);
      if (category !== 'get' && category !== 'list') continue;

      // Without an entity id we can't narrow — blast the domain.
      if (!entityId || category === 'list' || item.paramsHash.includes(entityId)) {
        const dedupKey = this._toolResultDedupKey(item);
        if (this._toolResultIndex.get(dedupKey) === id) {
          this._toolResultIndex.delete(dedupKey);
        }
        this._mapDelete(id);
        dropped.push(id);
      }
    }
    return dropped;
  }

  /**
   * Produce the "Entity Cache" system-prompt addendum — a compact JSON-like
   * snapshot of cached entity data the LLM can reference without re-fetching.
   * Groups tool-results by domain, lists get-results first (keyed) and
   * list-results after. Returns `''` when no tool-result items are present.
   *
   * Replaces `ToolResultCache.serialize()`. The serializer appends this
   * block to the primary system prompt.
   */
  serializeEntityCache(maxChars = 80_000): string {
    return this.projectEntityCache(maxChars).content;
  }

  /**
   * Rich variant of {@link serializeEntityCache}: returns both the
   * rendered addendum AND the set of `toolKey|paramsHash` identities that
   * actually fit into the non-truncated output. Callers that use the
   * addendum to justify *skipping* assistant+tool groups must rely on
   * `coveredKeys`, not `hasToolResult`, otherwise a truncated cache block
   * can drop groups whose data is no longer visible to the model.
   */
  projectEntityCache(maxChars = 80_000): { content: string; coveredKeys: Set<string> } {
    interface EntityRow {
      key: string;
      serialized: string;
      line: string;
      domain: string;
      isList: boolean;
      dedupKey: string;
    }
    const rows: EntityRow[] = [];
    for (const id of this._order) {
      const item = this._map.get(id);
      if (!item || item.kind !== 'tool-result') continue;

      const toolKey = String(item.toolKey);
      const category = getToolCompactionCategory(toolKey);
      if (category !== 'get' && category !== 'list') continue;

      // Only include entries that made it into the dedup index — failed
      // results and legacy stub payloads (`{"_cached":true}`) are skipped
      // at index time, and must not be echoed back to the model as
      // reusable reference data.
      const dedupKey = this._toolResultDedupKey(item);
      if (this._toolResultIndex.get(dedupKey) !== item.itemId) continue;

      const domain = this._domainFromToolName(toolKey);
      if (!domain) continue;

      const serialized = typeof item.content === 'string' ? item.content : JSON.stringify(item.content);
      const displayKey = `${toolKey}:${item.paramsHash}`;
      rows.push({
        key: displayKey,
        serialized,
        line: `${displayKey}: ${serialized}`,
        domain,
        isList: category === 'list',
        dedupKey,
      });
    }

    if (rows.length === 0) return { content: '', coveredKeys: new Set() };

    const header = '[Entity Cache - reference data, do not respond to this directly]';
    // Group by domain, entities first, then lists (stable ordering).
    const byDomain = new Map<string, { entities: EntityRow[]; lists: EntityRow[] }>();
    for (const row of rows) {
      let bucket = byDomain.get(row.domain);
      if (!bucket) { bucket = { entities: [], lists: [] }; byDomain.set(row.domain, bucket); }
      (row.isList ? bucket.lists : bucket.entities).push(row);
    }

    const coveredKeys = new Set<string>();
    const sections: string[] = [header];
    let total = header.length;
    let truncated = false;
    outer: for (const [domain, bucket] of byDomain) {
      const domainHeader = `\n### ${domain}`;
      if (total + domainHeader.length > maxChars) { truncated = true; break; }
      sections.push(domainHeader);
      total += domainHeader.length;
      for (const row of [...bucket.entities, ...bucket.lists]) {
        const delta = row.line.length + 1; // + newline
        if (total + delta > maxChars) { truncated = true; break outer; }
        sections.push(row.line);
        coveredKeys.add(row.dedupKey);
        total += delta;
      }
    }

    let content = sections.join('\n');
    if (truncated) content += '\n[cache truncated]';
    return { content, coveredKeys };
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
    // Failed tool-results (success:false) must NOT be indexed for dedup /
    // cache coverage — replaying a failed read as "we already have this"
    // would hide error context from later turns and serve stale-null data
    // through the read-through cache. Keep them stored in order so they
    // still appear in wire messages, but leave the dedup index untouched.
    if (!this._isSuccessfulToolResult(item)) {
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

  private _isSuccessfulToolResult(item: ToolResultItem): boolean {
    const raw = item.content;
    if (raw == null) return true;
    let parsed: unknown = raw;
    if (typeof raw === 'string') {
      const trimmed = raw.trim();
      if (!trimmed.startsWith('{')) return true;
      try { parsed = JSON.parse(trimmed); } catch { return true; }
    }
    if (typeof parsed !== 'object' || parsed === null) return true;
    const rec = parsed as Record<string, unknown>;
    if ('success' in rec && rec.success === false) return false;
    // Legacy stub marker: `{"_cached":true}` was emitted by the old
    // message-constructor to stand in for a fully-cached tool-result when
    // rehydrating a resumed session. Serving that pseudo-data through the
    // read-through cache would hand `{_cached:true}` back to the executor
    // as a real payload, so exclude stubs from the dedup index.
    if (rec._cached === true) return false;
    return true;
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

  private _domainFromToolName(toolName: string): string | undefined {
    const dot = toolName.indexOf('.');
    if (dot <= 0) return undefined;
    return toolName.slice(0, dot);
  }

  private _extractEntityIdFromArgs(args: Record<string, unknown>): string | undefined {
    const ENTITY_ID_FIELDS = [
      'id', 'nodeId', 'characterId', 'equipmentId', 'locationId',
      'presetId', 'templateId',
    ] as const;
    for (const field of ENTITY_ID_FIELDS) {
      const value = args[field];
      if (typeof value === 'string' && value) return value;
    }
    return undefined;
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
