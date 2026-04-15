/**
 * Structured tool result cache for the agent orchestrator.
 *
 * Instead of keeping 40+ individual `{role:'tool'}` messages with full
 * JSON payloads in the conversation, this cache absorbs get/list results
 * into deduplicated maps and serializes one compact snapshot at LLM
 * request time, appended to the system prompt.
 *
 * Lifecycle: created once per `execute()` session, lives as a class
 * field on AgentOrchestrator. Survives LLM compaction.
 */

import type { LLMMessage } from '@lucid-fin/contracts';
import type { ToolResult } from './tool-registry.js';
import { getToolCompactionCategory } from './tool-compaction-class.js';
import type { TranscriptIndex } from './transcript-index.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CacheEntry {
  toolName: string;
  serialized: string;
  charSize: number;
  step: number;
  lastAccessStep: number;
}

interface ListItemCacheEntry {
  serialized: string;
  charSize: number;
}

/** Internal representation for list caches, items keyed by entity key. */
interface ListCacheEntry {
  toolName: string;
  items: Map<string, ListItemCacheEntry>; // entityKey -> item snapshot
  step: number;
  lastAccessStep: number;
}

// Pagination keys to exclude from list cache key building
const PAGINATION_KEYS = new Set(['offset', 'limit', 'page', 'pageSize']);

// Entity ID fields to check in mutation args (ordered by specificity)
const ENTITY_ID_FIELDS = ['id', 'nodeId', 'characterId', 'equipmentId', 'locationId', 'presetId', 'templateId'] as const;

// ---------------------------------------------------------------------------
// Cold storage types
// ---------------------------------------------------------------------------

export interface CacheColdState {
  entities: Array<{ key: string; toolName: string; data: unknown }>;
  lists: Array<{ key: string; toolName: string; items: Array<{ entityKey: string; data: unknown }> }>;
}

// ---------------------------------------------------------------------------
// ToolResultCache
// ---------------------------------------------------------------------------

export class ToolResultCache {
  static readonly MAX_CACHE_CHARS = 80_000; // ~20K tokens hard cap
  static readonly STUB_CONTENT = '{"_cached":true}';

  private entities = new Map<string, CacheEntry>();     // "toolName:entityKey" -> entity
  private lists = new Map<string, ListCacheEntry>();    // cache key -> merged items
  private domainIndex = new Map<string, Set<string>>(); // domain -> cache keys
  private _totalChars = 0;
  private _dirty = false;
  private _serializedCache = '';

  // Getters

  get sizeChars(): number { return this._totalChars; }
  get entryCount(): number { return this.entities.size + this.lists.size; }

  /** Look up a specific entity cache entry by tool name and entity key. */
  getEntity(toolName: string, entityKey: string): CacheEntry | undefined {
    return this.entities.get(`${toolName}:${entityKey}`);
  }

  /** Look up a list cache entry by tool name and args. */
  getList(toolName: string, args: Record<string, unknown>): ListCacheEntry | undefined {
    const cacheKey = this.buildListCacheKey(toolName, args);
    return this.lists.get(cacheKey);
  }

  // Payload extraction

  /**
   * Extract the collection items from a list tool result.
   * List results follow: `{ total, offset?, limit?, [collectionKey]: T[] }`
   * We find the first array-valued property, skipping pagination/meta keys.
   */
  extractListItems(data: unknown): unknown[] {
    if (!data || typeof data !== 'object') return [];
    const record = data as Record<string, unknown>;
    const skipKeys = new Set(['total', 'offset', 'limit', 'success', 'error', 'page', 'pageSize']);
    for (const [key, value] of Object.entries(record)) {
      if (skipKeys.has(key)) continue;
      if (Array.isArray(value)) return value;
    }
    return [];
  }

  /**
   * Extract entity key from a data object.
   * Tries: id -> hash -> code -> "singleton"
   */
  extractEntityKey(entity: unknown): string {
    if (!entity || typeof entity !== 'object') return 'singleton';
    const record = entity as Record<string, unknown>;
    if (typeof record.id === 'string' && record.id) return record.id;
    if (typeof record.hash === 'string' && record.hash) return record.hash;
    if (typeof record.code === 'string' && record.code) return record.code;
    return 'singleton';
  }

  /**
   * Build a stable cache key for a list tool call.
   * Includes tool name + sorted non-pagination args.
   */
  buildListCacheKey(toolName: string, args: Record<string, unknown>): string {
    const filteredEntries = Object.entries(args)
      .filter(([key]) => !PAGINATION_KEYS.has(key))
      .sort(([a], [b]) => a.localeCompare(b));
    if (filteredEntries.length === 0) return toolName;
    const params = filteredEntries.map(([key, value]) => `${key}=${JSON.stringify(value)}`).join('&');
    return `${toolName}?${params}`;
  }

  // toolCallId -> toolName resolution

  /**
   * Walk backwards from a tool message to find the preceding assistant
   * message's toolCalls[], then match toolCallId to get the tool name.
   */
  static resolveToolName(messages: readonly LLMMessage[], toolMsgIndex: number): string | undefined {
    const targetId = messages[toolMsgIndex].toolCallId;
    if (!targetId) return undefined;
    for (let i = toolMsgIndex - 1; i >= 0; i--) {
      const msg = messages[i];
      if (msg.role === 'assistant' && msg.toolCalls?.length) {
        const tc = msg.toolCalls.find((toolCall) => toolCall.id === targetId);
        if (tc) return tc.name;
      }
      if (msg.role !== 'tool' && msg.role !== 'assistant') break;
    }
    return undefined;
  }

  // Core operations

  /**
   * Absorb a raw tool result into the cache.
   * Called from the emit wrapper in the orchestrator (hot path).
   */
  absorbResult(
    toolName: string,
    args: Record<string, unknown>,
    result: ToolResult,
    step: number,
  ): boolean {
    const category = getToolCompactionCategory(toolName);
    if (category !== 'get' && category !== 'list') return false;
    if (result.success === false) return false;

    const data = result.data;
    if (data === undefined || data === null) return false;

    if (category === 'list') {
      return this._absorbList(toolName, args, data, step);
    }
    return this._absorbGet(toolName, data, step);
  }

  private _absorbList(
    toolName: string,
    args: Record<string, unknown>,
    data: unknown,
    step: number,
  ): boolean {
    const items = this.extractListItems(data);
    if (items.length === 0) return false;

    const cacheKey = this.buildListCacheKey(toolName, args);
    let entry = this.lists.get(cacheKey);
    if (!entry) {
      entry = { toolName, items: new Map(), step, lastAccessStep: step };
      this.lists.set(cacheKey, entry);
      this._addCacheKeyToDomainIndex(toolName, cacheKey);
    }

    let changed = false;
    for (const item of items) {
      const entityKey = this.extractEntityKey(item);
      const serialized = JSON.stringify(item);
      const charSize = serialized.length;
      const existing = entry.items.get(entityKey);
      if (existing) {
        this._totalChars -= existing.charSize;
      }
      entry.items.set(entityKey, { serialized, charSize });
      this._totalChars += charSize;
      changed = true;
    }

    if (changed) {
      entry.step = step;
      entry.lastAccessStep = step;
      this._dirty = true;
      this._evictIfOverBudget();
    }

    if (this._totalChars < 0) this._totalChars = 0;
    return changed;
  }

  private _absorbGet(toolName: string, data: unknown, step: number): boolean {
    let changed = false;

    if (Array.isArray(data)) {
      for (const item of data) {
        this._absorbSingleEntity(toolName, item, step);
        changed = true;
      }
    } else {
      this._absorbSingleEntity(toolName, data, step);
      changed = true;
    }

    if (changed) {
      this._evictIfOverBudget();
    }
    return changed;
  }

  private _absorbSingleEntity(toolName: string, entity: unknown, step: number): void {
    const entityKey = this.extractEntityKey(entity);
    const cacheKey = `${toolName}:${entityKey}`;
    const serialized = JSON.stringify(entity);
    const charSize = serialized.length;

    this._deleteEntity(cacheKey);
    this.entities.set(cacheKey, { toolName, serialized, charSize, step, lastAccessStep: step });
    this._addCacheKeyToDomainIndex(toolName, cacheKey);
    this._totalChars += charSize;
    this._dirty = true;

    if (this._totalChars < 0) this._totalChars = 0;
  }

  private _evictIfOverBudget(): void {
    while (this._totalChars > ToolResultCache.MAX_CACHE_CHARS) {
      let oldestStep = Infinity;
      let oldestKey: string | undefined;
      let oldestMap: 'entities' | 'lists' | undefined;

      for (const [key, entry] of this.entities) {
        if (entry.lastAccessStep < oldestStep) {
          oldestStep = entry.lastAccessStep;
          oldestKey = key;
          oldestMap = 'entities';
        }
      }

      for (const [key, entry] of this.lists) {
        if (entry.lastAccessStep < oldestStep) {
          oldestStep = entry.lastAccessStep;
          oldestKey = key;
          oldestMap = 'lists';
        }
      }

      if (!oldestKey || !oldestMap) break;

      if (oldestMap === 'entities') {
        this._deleteEntity(oldestKey);
      } else {
        this._deleteList(oldestKey);
      }
    }
  }

  // processRound - stub old messages, invalidate for mutations

  /**
   * After each tool execution round, stub older cached results and
   * invalidate cache entries for mutations.
   */
  processRound(messages: LLMMessage[], currentStep: number, transcriptIndex?: TranscriptIndex): void {
    let latestAssistantIdx = -1;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'assistant' && messages[i].toolCalls?.length) {
        latestAssistantIdx = i;
        break;
      }
    }

    if (latestAssistantIdx >= 0 && messages[latestAssistantIdx].toolCalls) {
      let hasSnapshotRestore = false;
      for (const tc of messages[latestAssistantIdx].toolCalls!) {
        if (tc.name === 'snapshot.restore') {
          hasSnapshotRestore = true;
          break;
        }
        const category = getToolCompactionCategory(tc.name);
        if (category === 'mutation') {
          const args = (tc.arguments as Record<string, unknown>) ?? {};
          this.invalidateForMutationWithArgs(tc.name, args);
        }
      }
      if (hasSnapshotRestore) {
        this.clearAll();
      }
    }

    const latestRoundIds = new Set<string>();
    if (latestAssistantIdx >= 0 && messages[latestAssistantIdx].toolCalls) {
      for (const tc of messages[latestAssistantIdx].toolCalls!) {
        latestRoundIds.add(tc.id);
      }
    }

    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      if (msg.role !== 'tool' || !msg.toolCallId) continue;
      if (latestRoundIds.has(msg.toolCallId)) continue;
      if (msg.content === ToolResultCache.STUB_CONTENT) continue;
      if (msg.content.length <= 100) continue;

      const toolName = transcriptIndex?.resolveToolName(msg.toolCallId!) ?? ToolResultCache.resolveToolName(messages, i);
      if (!toolName) continue;

      const category = getToolCompactionCategory(toolName);
      if (category !== 'get' && category !== 'list') continue;

      if (!this._hasToolDataInCache(toolName)) continue;

      messages[i] = { ...msg, content: ToolResultCache.STUB_CONTENT };
    }
  }

  /** Check if any cache data exists for a given tool name's domain. */
  private _hasToolDataInCache(toolName: string): boolean {
    return this.domainIndex.has(this._getDomain(toolName));
  }

  // Invalidation

  invalidateForMutation(toolName: string): void {
    const domain = this._getDomain(toolName);
    const keys = this.domainIndex.get(domain);
    if (!keys) return;

    for (const cacheKey of [...keys]) {
      if (this.entities.has(cacheKey)) {
        this._deleteEntity(cacheKey);
      } else if (this.lists.has(cacheKey)) {
        this._deleteList(cacheKey);
      }
    }

    if (this._totalChars < 0) this._totalChars = 0;
  }

  /**
   * Entity-level invalidation. If the mutation args contain a recognizable
   * entity ID, only invalidate that entity's cache entry + all list entries
   * for the domain (lists may be stale). Falls back to full domain wipe
   * when no entity ID can be extracted.
   */
  invalidateForMutationWithArgs(toolName: string, args: Record<string, unknown>): void {
    const entityId = this._extractEntityIdFromArgs(args);
    if (!entityId) {
      this.invalidateForMutation(toolName);
      return;
    }

    const domain = this._getDomain(toolName);
    const keys = this.domainIndex.get(domain);
    if (!keys) return;

    for (const cacheKey of [...keys]) {
      // Always invalidate lists for the domain (may contain stale data)
      if (this.lists.has(cacheKey)) {
        this._deleteList(cacheKey);
        continue;
      }
      // For entities, only invalidate if the cache key contains the entity ID
      if (this.entities.has(cacheKey) && cacheKey.includes(entityId)) {
        this._deleteEntity(cacheKey);
      }
    }

    if (this._totalChars < 0) this._totalChars = 0;
  }

  /**
   * Extract an entity ID from mutation tool call arguments.
   * Checks common ID field names in priority order.
   */
  private _extractEntityIdFromArgs(args: Record<string, unknown>): string | undefined {
    for (const field of ENTITY_ID_FIELDS) {
      const value = args[field];
      if (typeof value === 'string' && value) return value;
    }
    return undefined;
  }

  /**
   * Bump `lastAccessStep` for a cached entry, implementing LRU behavior.
   * Called when the LLM references cached data in its response.
   */
  touchEntry(toolName: string, entityKey: string | undefined, currentStep: number): void {
    if (entityKey) {
      const cacheKey = `${toolName}:${entityKey}`;
      const entry = this.entities.get(cacheKey);
      if (entry) {
        entry.lastAccessStep = currentStep;
        return;
      }
    }
    // Try list entries for this tool
    for (const [, listEntry] of this.lists) {
      if (listEntry.toolName === toolName) {
        listEntry.lastAccessStep = currentStep;
      }
    }
  }

  clearAll(): void {
    this.entities.clear();
    this.lists.clear();
    this.domainIndex.clear();
    this._totalChars = 0;
    this._serializedCache = '';
    this._dirty = false;
  }

  // History prewarm

  /**
   * Best-effort: parse existing history messages and absorb get/list results.
   * Skips stubs and unparseable content.
   */
  warmFromHistory(messages: readonly LLMMessage[], transcriptIndex?: TranscriptIndex): void {
    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      if (msg.role !== 'tool' || !msg.toolCallId) continue;
      if (msg.content === ToolResultCache.STUB_CONTENT) continue;

      const toolName = transcriptIndex?.resolveToolName(msg.toolCallId) ?? ToolResultCache.resolveToolName(messages, i);
      if (!toolName) continue;

      const category = getToolCompactionCategory(toolName);
      if (category !== 'get' && category !== 'list') continue;

      try {
        const parsed = JSON.parse(msg.content);
        if (parsed && typeof parsed === 'object' && parsed.success !== false) {
          this.absorbResult(toolName, {}, parsed as ToolResult, 0);
        }
      } catch {
        // Unparseable -> skip
      }
    }
  }

  // Serialization

  /**
   * Serialize cache contents for injection into the system prompt.
   * Groups by domain, produces JSON sections.
   */
  serialize(): string {
    if (!this._dirty) return this._serializedCache;

    if (this.entryCount === 0) {
      this._serializedCache = '';
      this._dirty = false;
      return '';
    }

    let output = this._buildSerializedOutput();

    if (output.length > ToolResultCache.MAX_CACHE_CHARS) {
      while (this.entryCount > 0) {
        let oldestStep = Infinity;
        let oldestKey: string | undefined;
        let oldestMap: 'entities' | 'lists' | undefined;

        for (const [key, entry] of this.entities) {
          if (entry.lastAccessStep < oldestStep) {
            oldestStep = entry.lastAccessStep;
            oldestKey = key;
            oldestMap = 'entities';
          }
        }
        for (const [key, entry] of this.lists) {
          if (entry.lastAccessStep < oldestStep) {
            oldestStep = entry.lastAccessStep;
            oldestKey = key;
            oldestMap = 'lists';
          }
        }
        if (!oldestKey || !oldestMap) break;

        if (oldestMap === 'entities') {
          this._deleteEntity(oldestKey);
        } else {
          this._deleteList(oldestKey);
        }

        if (this._totalChars < ToolResultCache.MAX_CACHE_CHARS * 0.7) break;
      }

      if (this.entryCount === 0) {
        this._serializedCache = '';
        this._dirty = false;
        return '';
      }
      output = this._buildSerializedOutput();
    }

    this._serializedCache = output;
    this._dirty = false;
    return output;
  }

  // Cold storage — cross-session persistence

  /**
   * Serialize cache to a plain-object format suitable for JSON storage.
   * Used to persist cache across Commander sessions for the same canvas.
   */
  toColdStorage(): CacheColdState {
    const entities: CacheColdState['entities'] = [];
    for (const [key, entry] of this.entities) {
      try {
        entities.push({ key, toolName: entry.toolName, data: JSON.parse(entry.serialized) });
      } catch {
        // Skip entries that can't be parsed back
      }
    }

    const lists: CacheColdState['lists'] = [];
    for (const [key, entry] of this.lists) {
      const items: Array<{ entityKey: string; data: unknown }> = [];
      for (const [entityKey, itemEntry] of entry.items) {
        try {
          items.push({ entityKey, data: JSON.parse(itemEntry.serialized) });
        } catch {
          // Skip unparseable items
        }
      }
      if (items.length > 0) {
        lists.push({ key, toolName: entry.toolName, items });
      }
    }

    return { entities, lists };
  }

  /**
   * Reconstruct a cache from cold storage state.
   * All entries start at step 0 with lastAccessStep 0 (will be updated on use).
   */
  static fromColdStorage(state: CacheColdState): ToolResultCache {
    const cache = new ToolResultCache();

    for (const { key, toolName, data } of state.entities) {
      const serialized = JSON.stringify(data);
      const charSize = serialized.length;
      cache.entities.set(key, { toolName, serialized, charSize, step: 0, lastAccessStep: 0 });
      cache._addCacheKeyToDomainIndex(toolName, key);
      cache._totalChars += charSize;
    }

    for (const { key, toolName, items } of state.lists) {
      const itemMap = new Map<string, ListItemCacheEntry>();
      let totalItemChars = 0;
      for (const { entityKey, data } of items) {
        const serialized = JSON.stringify(data);
        const charSize = serialized.length;
        itemMap.set(entityKey, { serialized, charSize });
        totalItemChars += charSize;
      }
      if (itemMap.size > 0) {
        cache.lists.set(key, { toolName, items: itemMap, step: 0, lastAccessStep: 0 });
        cache._addCacheKeyToDomainIndex(toolName, key);
        cache._totalChars += totalItemChars;
      }
    }

    cache._dirty = true;
    cache._evictIfOverBudget();
    return cache;
  }

  private _buildSerializedOutput(): string {
    const sections: string[] = [];
    sections.push('[Entity Cache - reference data, do not respond to this directly]');

    const entityByDomain = new Map<string, Array<{ key: string; serialized: string }>>();
    for (const [key, entry] of this.entities) {
      const domain = this._getDomain(entry.toolName);
      let group = entityByDomain.get(domain);
      if (!group) {
        group = [];
        entityByDomain.set(domain, group);
      }
      group.push({ key, serialized: entry.serialized });
    }

    const listByDomain = new Map<string, Array<{ key: string; serialized: string }>>();
    for (const [key, entry] of this.lists) {
      const domain = this._getDomain(entry.toolName);
      let group = listByDomain.get(domain);
      if (!group) {
        group = [];
        listByDomain.set(domain, group);
      }
      const itemsSerialized = `[${[...entry.items.values()].map((item) => item.serialized).join(',')}]`;
      group.push({ key, serialized: itemsSerialized });
    }

    const allDomains = new Set([...entityByDomain.keys(), ...listByDomain.keys()]);

    for (const domain of allDomains) {
      const entityGroup = entityByDomain.get(domain) ?? [];
      const listGroup = listByDomain.get(domain) ?? [];

      sections.push(`\n### ${domain}`);

      for (const { key, serialized } of entityGroup) {
        sections.push(`${key}: ${serialized}`);
      }
      for (const { key, serialized } of listGroup) {
        sections.push(`${key}: ${serialized}`);
      }
    }

    return sections.join('\n');
  }

  private _getDomain(toolName: string): string {
    return toolName.split('.')[0] ?? toolName;
  }

  private _addCacheKeyToDomainIndex(toolName: string, cacheKey: string): void {
    const domain = this._getDomain(toolName);
    let keys = this.domainIndex.get(domain);
    if (!keys) {
      keys = new Set();
      this.domainIndex.set(domain, keys);
    }
    keys.add(cacheKey);
  }

  private _removeCacheKeyFromDomainIndex(toolName: string, cacheKey: string): void {
    const domain = this._getDomain(toolName);
    const keys = this.domainIndex.get(domain);
    if (!keys) return;
    keys.delete(cacheKey);
    if (keys.size === 0) {
      this.domainIndex.delete(domain);
    }
  }

  private _deleteEntity(cacheKey: string): void {
    const entry = this.entities.get(cacheKey);
    if (!entry) return;
    this._totalChars -= entry.charSize;
    this.entities.delete(cacheKey);
    this._removeCacheKeyFromDomainIndex(entry.toolName, cacheKey);
    this._dirty = true;
  }

  private _deleteList(cacheKey: string): void {
    const entry = this.lists.get(cacheKey);
    if (!entry) return;
    for (const item of entry.items.values()) {
      this._totalChars -= item.charSize;
    }
    this.lists.delete(cacheKey);
    this._removeCacheKeyFromDomainIndex(entry.toolName, cacheKey);
    this._dirty = true;
  }
}
