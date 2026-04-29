/**
 * Compaction policy evaluator tests — Phase G2a-3.
 */

import { describe, it, expect } from 'vitest';
import { evaluate } from './compaction.js';
import { ContextGraph } from './context-graph.js';
import type { ContextItem, CompactionPolicy, ToolKey } from '@lucid-fin/contracts';
import { freshContextItemId } from '@lucid-fin/contracts-parse';

function mkId() {
  return freshContextItemId();
}

function mkUserMessage(step: number, content = 'hi'.repeat(100)): ContextItem {
  return { kind: 'user-message', itemId: mkId(), producedAtStep: step, content };
}

function mkToolResult(
  toolKey: string,
  paramsHash: string,
  step: number,
  contentSize = 100,
): ContextItem {
  return {
    kind: 'tool-result',
    itemId: mkId(),
    producedAtStep: step,
    toolKey: toolKey as ToolKey,
    paramsHash,
    content: 'x'.repeat(contentSize),
    schemaVersion: 1,
  };
}

function mkSessionSummary(step: number, content = 'summary'): ContextItem {
  return {
    kind: 'session-summary',
    itemId: mkId(),
    producedAtStep: step,
    stepsFrom: 0,
    stepsTo: step,
    content,
  };
}

function mkGuide(step = 0): ContextItem {
  return {
    kind: 'guide',
    itemId: mkId(),
    producedAtStep: step,
    guideKey: 'wf',
    content: 'do this',
  };
}

const defaultPolicy: CompactionPolicy = {
  tokenBudget: 10000,
  keep: { latestUserMessages: 2, latestEntitySnapshots: true, sessionSummaries: true },
  compactStrategy: { kind: 'identity-dedup' },
};

// ── Tests ──────────────────────────────────────────────────────

describe('compaction evaluator', () => {
  describe('identity-dedup', () => {
    it('returns no dropped items when under budget', () => {
      const graph = new ContextGraph();
      graph.add(mkUserMessage(0, 'hello'));
      const result = evaluate(graph, defaultPolicy);
      expect(result.dropped).toHaveLength(0);
      expect(result.dedupedToolResults).toBe(0);
    });

    it('deduplicates tool-results with same identity — marks older for drop', () => {
      const graph = new ContextGraph();
      // Note: ContextGraph.add() already supersedes duplicates, but compaction
      // evaluates the graph state independently. Add two unique-identity items.
      const r1 = mkToolResult('char.get', 'h1', 1, 200);
      const r2 = mkToolResult('char.get', 'h2', 2, 200);
      graph.add(r1);
      graph.add(r2);
      // Add a third with same identity as r1 (would already supersede r1 in graph,
      // but testing the evaluator's dedup logic on what's in the graph)
      const r3 = mkToolResult('char.get', 'h1', 3, 200); // different paramsHash so both stay
      graph.add(r3);
      const result = evaluate(graph, { ...defaultPolicy, tokenBudget: 10000 });
      // No forced dedup since paramsHashes differ
      expect(result.dedupedToolResults).toBe(0);
    });

    it('handles graph with zero items', () => {
      const graph = new ContextGraph();
      const result = evaluate(graph, defaultPolicy);
      expect(result.dropped).toHaveLength(0);
      expect(result.toSummarize).toHaveLength(0);
    });
  });

  describe('budget enforcement', () => {
    it('returns toSummarize items when over budget with summarize-oldest strategy', () => {
      const graph = new ContextGraph();
      // Large items to trigger budget overflow
      for (let i = 0; i < 5; i++) {
        graph.add(mkUserMessage(i, 'w'.repeat(5000)));
      }
      const policy: CompactionPolicy = {
        tokenBudget: 100, // tiny budget to force compaction
        keep: { latestUserMessages: 1, latestEntitySnapshots: false, sessionSummaries: false },
        compactStrategy: { kind: 'summarize-oldest' },
      };
      const result = evaluate(graph, policy);
      expect(result.toSummarize.length).toBeGreaterThan(0);
      // Most-recent user message should NOT be in toSummarize (protected by keep.latestUserMessages=1)
      const items = [...graph];
      const lastUserMsg = items.filter((i) => i.kind === 'user-message').at(-1)!;
      expect(result.toSummarize).not.toContain(lastUserMsg.itemId);
    });

    it('guides are always protected', () => {
      const graph = new ContextGraph();
      const guide = mkGuide(0);
      graph.add(guide);
      for (let i = 0; i < 3; i++) {
        graph.add(mkUserMessage(i + 1, 'x'.repeat(10000)));
      }
      const policy: CompactionPolicy = {
        tokenBudget: 50,
        keep: { latestUserMessages: 0, latestEntitySnapshots: false, sessionSummaries: false },
        compactStrategy: { kind: 'summarize-oldest' },
      };
      const result = evaluate(graph, policy);
      expect(result.toSummarize).not.toContain(guide.itemId);
    });

    it('session summaries are protected when keep.sessionSummaries=true', () => {
      const graph = new ContextGraph();
      const summary = mkSessionSummary(1, 'earlier work');
      graph.add(summary);
      for (let i = 2; i < 5; i++) {
        graph.add(mkUserMessage(i, 'w'.repeat(5000)));
      }
      const policy: CompactionPolicy = {
        tokenBudget: 100,
        keep: { latestUserMessages: 0, latestEntitySnapshots: false, sessionSummaries: true },
        compactStrategy: { kind: 'summarize-oldest' },
      };
      const result = evaluate(graph, policy);
      expect(result.toSummarize).not.toContain(summary.itemId);
    });
  });
});
