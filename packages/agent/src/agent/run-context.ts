/**
 * RunContext — per-execute() session state for the AgentOrchestrator.
 *
 * All mutable state that was previously scattered as instance fields
 * on the orchestrator is consolidated here. This makes it clear what
 * belongs to a single run vs. the orchestrator's lifetime config.
 *
 * P3 introduces the type and structured Scratchpad; incremental
 * migration of orchestrator fields happens over subsequent PRs.
 */
import type { LLMMessage, ContextItem } from '@lucid-fin/contracts';
import type { EvidenceLedger, RunIntent } from './exit-contract/index.js';
import type { ContextGraph } from './graph/context-graph.js';
import type { TranscriptIndex } from './transcript-index.js';
import type { ToolCallDeduplicator } from './tool-call-deduplicator.js';
import type { ContextManager } from './context-manager.js';
import type { ToolExecutor } from './tool-executor.js';
import type { StampedStreamEvent } from './stream-emit.js';

// ---------------------------------------------------------------------------
// Scratchpad (v2 — structured, 2KB budget)
// ---------------------------------------------------------------------------

export interface Scratchpad {
  todos: string[];
  decisions: string[];
  failures: string[];
  context: Map<string, string>;
}

export const SCRATCHPAD_MAX_CHARS = 2000;
export const SCRATCHPAD_SECTION_BUDGETS = {
  todos: 600,
  decisions: 500,
  failures: 300,
  context: 600,
} as const;

export function createEmptyScratchpad(): Scratchpad {
  return { todos: [], decisions: [], failures: [], context: new Map() };
}

export function serializeScratchpad(pad: Scratchpad): string {
  const parts: string[] = [];
  if (pad.todos.length > 0) {
    parts.push(`[todos]\n${pad.todos.join('\n')}`);
  }
  if (pad.decisions.length > 0) {
    parts.push(`[decisions]\n${pad.decisions.join('\n')}`);
  }
  if (pad.failures.length > 0) {
    parts.push(`[failures]\n${pad.failures.join('\n')}`);
  }
  if (pad.context.size > 0) {
    const entries = Array.from(pad.context.entries())
      .map(([k, v]) => `${k}=${v}`)
      .join('\n');
    parts.push(`[context]\n${entries}`);
  }
  const full = parts.join('\n\n');
  return full.length > SCRATCHPAD_MAX_CHARS
    ? full.slice(0, SCRATCHPAD_MAX_CHARS - 3) + '...'
    : full;
}

// ---------------------------------------------------------------------------
// RunContext interface
// ---------------------------------------------------------------------------

export interface RunContext {
  runId: string;
  step: number;
  messages: LLMMessage[];
  intent: RunIntent;
  ledger: EvidenceLedger;
  scratchpad: Scratchpad;
  activeToolNames: Set<string>;
  discoveredToolNames: Set<string>;
  toolLastUsedStep: Map<string, number>;
  emit: (event: StampedStreamEvent) => void;
  isAborted: () => boolean;
  contextManager: ContextManager;
  toolExecutor: ToolExecutor;
  contextGraph: ContextGraph | null;
  transcriptIndex: TranscriptIndex;
  deduplicator: ToolCallDeduplicator;
  lastAssistantText: string;
  lastAskUserAnsweredStep: number | null;
  forceAskUserNextTurn: boolean;
  pendingGraphSeed: ContextItem[];
}
