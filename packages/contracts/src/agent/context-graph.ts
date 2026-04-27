/**
 * ContextItem discriminated union + supporting types — Phase G2a-1.
 *
 * Pure types only. Zero runtime. Zero zod.
 * Brand parsers live in @lucid-fin/contracts-parse/src/brands/context-item-id.ts.
 * Zod schemas live in @lucid-fin/contracts-parse/src/storage/schemas/context-graph.ts.
 */

import type { ToolKey } from '../types/brands.js';

// ── ContextItemId brand ────────────────────────────────────────

export type ContextItemId = string & { readonly __brand: 'ContextItemId' };

// ── EntityRef ──────────────────────────────────────────────────

/**
 * A typed reference to a domain entity (character, location, canvas node, etc.).
 * Used for invalidation: when entity state changes, all items carrying that
 * entityRef can be dropped or superseded.
 */
export interface EntityRef {
  entityType: string;
  entityId: string;
}

// ── ContextItem variants ───────────────────────────────────────

export interface UserMessageItem {
  kind: 'user-message';
  itemId: ContextItemId;
  producedAtStep: number;
  content: string;
}

export interface AssistantTurnItem {
  kind: 'assistant-turn';
  itemId: ContextItemId;
  producedAtStep: number;
  content: string;
  /** Present when the assistant issued tool calls in this turn. */
  toolCalls?: Array<{
    id: string;
    name: string;
    arguments: Record<string, unknown>;
  }>;
  /** Model reasoning/thinking content (if available). */
  reasoning?: string;
}

export interface ToolResultItem {
  kind: 'tool-result';
  itemId: ContextItemId;
  producedAtStep: number;
  /** Branded tool key — matches ToolKey from Phase C. */
  toolKey: ToolKey;
  /** Stable hash of canonical params — used for identity-based dedup. */
  paramsHash: string;
  /** Which entity this result describes (for cascading invalidation). */
  entityRef?: EntityRef;
  /** The raw result payload (unknown until schema-checked). */
  content: unknown;
  schemaVersion: number;
  /** The tool call ID issued by the LLM (for role='tool' response correlation). */
  toolCallId?: string;
}

export interface EntitySnapshotItem {
  kind: 'entity-snapshot';
  itemId: ContextItemId;
  producedAtStep: number;
  entityRef: EntityRef;
  /** Serialized snapshot payload (whatever the domain layer provides). */
  snapshot: unknown;
}

export interface GuideItem {
  kind: 'guide';
  itemId: ContextItemId;
  producedAtStep: number;
  /** Identifies the guide so duplicates can be detected. */
  guideKey: string;
  content: string;
}

/**
 * A mid-conversation system message (process prompt, warning, injected
 * notice). Unlike `guide`, these are position-sensitive — the serializer
 * must emit them inline at their original turn rather than hoisting them
 * to the top of the prompt.
 */
export interface SystemMessageItem {
  kind: 'system-message';
  itemId: ContextItemId;
  producedAtStep: number;
  content: string;
}

export interface SessionSummaryItem {
  kind: 'session-summary';
  itemId: ContextItemId;
  producedAtStep: number;
  /** Steps covered by this summary. */
  stepsFrom: number;
  stepsTo: number;
  content: string;
}

export interface ReferenceItem {
  kind: 'reference';
  itemId: ContextItemId;
  producedAtStep: number;
  /** The item being referenced (for inline expansion at serialization time). */
  referencedItemId: ContextItemId;
}

export interface ScratchpadItem {
  kind: 'scratchpad';
  itemId: ContextItemId;
  producedAtStep: number;
  /** Structured text summarizing current state (~500 chars max). */
  content: string;
}

// ── ContextItem union ──────────────────────────────────────────

export type ContextItem =
  | UserMessageItem
  | AssistantTurnItem
  | ToolResultItem
  | EntitySnapshotItem
  | GuideItem
  | SystemMessageItem
  | SessionSummaryItem
  | ReferenceItem
  | ScratchpadItem;

// ── Compaction policy ──────────────────────────────────────────

export interface CompactionKeepRules {
  /** Always keep N most recent user turns verbatim. */
  latestUserMessages: number;
  /** Keep the current entity snapshots (most recent per entityRef). */
  latestEntitySnapshots: boolean;
  /** Keep all session-summary items. */
  sessionSummaries: boolean;
}

export type CompactStrategy =
  | { kind: 'identity-dedup' }
  | { kind: 'summarize-oldest' };

export interface CompactionPolicy {
  tokenBudget: number;
  keep: CompactionKeepRules;
  compactStrategy: CompactStrategy;
}

// ── TokenBudget ────────────────────────────────────────────────

export interface TokenBudget {
  /** Maximum tokens to include in serialized output. */
  tokens: number;
  /** Estimated chars per token for the target provider (default 4). */
  charsPerToken?: number;
}

// ── CompactionResult ───────────────────────────────────────────

export interface CompactionResult {
  /** Items removed from the graph. */
  dropped: ContextItemId[];
  /** Items that should be summarized (returned for caller to act on). */
  toSummarize: ContextItemId[];
  /** Number of tool-result items deduped by identity. */
  dedupedToolResults: number;
}
