/**
 * Compaction policy evaluator — Phase G2a-3.
 *
 * Pure function: `evaluate(graph, policy): CompactionResult`.
 * Does NOT mutate the graph. Returns what should be dropped or summarized.
 * Callers apply the result via `graph.applyCompactionResult(result)`.
 *
 * Policy ordering (deterministic):
 *   1. identity-dedup: remove superseded tool-result items (keeping newest).
 *   2. budget check: if still over, collect oldest non-protected items.
 *   3. summarize-oldest: flag oldest chunk for summarization (caller's LLM call).
 */

import type {
  ContextItem,
  ContextItemId,
  CompactionPolicy,
  CompactionResult,
  EntityRef,
} from '@lucid-fin/contracts';
import type { ContextGraph } from './context-graph.js';
import { getToolCompactionCategory } from '@lucid-fin/shared-utils';

const DEDUP_SAFE_CATEGORIES = new Set(['get', 'list', 'query']);

type ToolResultIdentityKey = string;

function toolResultKey(item: Extract<ContextItem, { kind: 'tool-result' }>): ToolResultIdentityKey {
  return `${item.toolKey}|${item.paramsHash}`;
}

function entityRefKey(ref: EntityRef): string {
  return `${ref.entityType}:${ref.entityId}`;
}

function estimateItemTokens(item: ContextItem, charsPerToken = 4): number {
  switch (item.kind) {
    case 'user-message':
    case 'guide':
    case 'system-message':
    case 'session-summary':
    case 'scratchpad':
      return Math.ceil(item.content.length / charsPerToken);
    case 'assistant-turn':
      return Math.ceil((item.content.length + (item.reasoning?.length ?? 0)) / charsPerToken);
    case 'tool-result':
      return Math.ceil(JSON.stringify(item.content).length / charsPerToken);
    case 'entity-snapshot':
      return Math.ceil(JSON.stringify(item.snapshot).length / charsPerToken);
    case 'reference':
      return 10; // minimal overhead
    default:
      return 0;
  }
}

/**
 * Evaluate a CompactionPolicy against the graph.
 * Returns a CompactionResult — caller decides how to apply it.
 */
export function evaluate(graph: ContextGraph, policy: CompactionPolicy): CompactionResult {
  const dropped: ContextItemId[] = [];
  let dedupedToolResults = 0;

  const items = [...graph];
  const charsPerToken = 4;

  // ── Step 1: identity-dedup (always run first) ──────────────

  // Find tool-result items. For each (toolKey, paramsHash) pair, keep only the
  // newest (last in insertion order). Earlier ones are superseded — but ONLY
  // for read-only/idempotent tool categories. Mutations and logs must not
  // dedup: distinct calls represent distinct state changes.
  const toolResultByKey = new Map<ToolResultIdentityKey, Extract<ContextItem, { kind: 'tool-result' }>[]>();
  for (const item of items) {
    if (item.kind !== 'tool-result') continue;
    const category = getToolCompactionCategory(String(item.toolKey));
    if (!category || !DEDUP_SAFE_CATEGORIES.has(category)) continue;
    const key = toolResultKey(item);
    let arr = toolResultByKey.get(key);
    if (!arr) {
      arr = [];
      toolResultByKey.set(key, arr);
    }
    arr.push(item);
  }

  const dedupDropped = new Set<ContextItemId>();
  for (const [, group] of toolResultByKey) {
    if (group.length <= 1) continue;
    // Keep the last (newest); drop the rest
    for (let i = 0; i < group.length - 1; i++) {
      dedupDropped.add(group[i]!.itemId);
      dedupedToolResults++;
    }
  }

  for (const id of dedupDropped) {
    dropped.push(id);
  }

  // ── Step 2: budget enforcement ─────────────────────────────

  // Items remaining after dedup
  const surviving = items.filter((item) => !dedupDropped.has(item.itemId));

  // Compute total tokens
  const totalTokens = surviving.reduce((sum, item) => sum + estimateItemTokens(item, charsPerToken), 0);

  if (totalTokens <= policy.tokenBudget) {
    // Under budget — no further compaction needed
    return { dropped, toSummarize: [], dedupedToolResults };
  }

  // ── Step 3: Identify protected items ──────────────────────

  // Find latest entity snapshots per entityRef (protected if keep.latestEntitySnapshots)
  const latestEntitySnapshotIds = new Set<ContextItemId>();
  if (policy.keep.latestEntitySnapshots) {
    const latestByEntityRef = new Map<string, ContextItemId>();
    for (const item of surviving) {
      if (item.kind !== 'entity-snapshot') continue;
      const key = entityRefKey(item.entityRef);
      latestByEntityRef.set(key, item.itemId);
    }
    for (const id of latestByEntityRef.values()) {
      latestEntitySnapshotIds.add(id);
    }
  }

  // Find latest N user messages (protected)
  const latestUserMessageIds = new Set<ContextItemId>();
  let userMsgCount = 0;
  for (let i = surviving.length - 1; i >= 0; i--) {
    const item = surviving[i]!;
    if (item.kind !== 'user-message') continue;
    if (userMsgCount >= policy.keep.latestUserMessages) break;
    latestUserMessageIds.add(item.itemId);
    userMsgCount++;
  }

  // Session summaries (protected if keep.sessionSummaries)
  const sessionSummaryIds = new Set<ContextItemId>();
  if (policy.keep.sessionSummaries) {
    for (const item of surviving) {
      if (item.kind === 'session-summary') sessionSummaryIds.add(item.itemId);
    }
  }

  function isProtected(item: ContextItem): boolean {
    if (latestUserMessageIds.has(item.itemId)) return true;
    if (latestEntitySnapshotIds.has(item.itemId)) return true;
    if (sessionSummaryIds.has(item.itemId)) return true;
    // Guides and system-messages are always protected (they're active
    // system instructions that must reach the model verbatim).
    if (item.kind === 'guide') return true;
    if (item.kind === 'system-message') return true;
    // Scratchpad items always survive compaction — they carry persistent
    // state (todo progress, decisions, failure traces) across turns.
    if (item.kind === 'scratchpad') return true;
    return false;
  }

  // ── Step 4: Strategy-based compaction ─────────────────────

  const toSummarize: ContextItemId[] = [];

  if (policy.compactStrategy.kind === 'identity-dedup') {
    // Dedup already done in step 1. No further removal for this strategy.
    // (Caller can choose to drop more aggressively by re-running with summarize strategy.)
  } else if (policy.compactStrategy.kind === 'summarize-oldest') {
    // Identify the oldest contiguous chunk of non-protected items to summarize.
    // Stop when we're under budget or run out of candidates.
    let tokensToFree = totalTokens - policy.tokenBudget;
    for (const item of surviving) {
      if (tokensToFree <= 0) break;
      if (isProtected(item)) continue;
      toSummarize.push(item.itemId);
      tokensToFree -= estimateItemTokens(item, charsPerToken);
    }
  }

  return { dropped, toSummarize, dedupedToolResults };
}
