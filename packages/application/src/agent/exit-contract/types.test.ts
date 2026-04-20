import { describe, expect, it } from 'vitest';
import {
  assertNeverBlocker,
  assertNeverDecision,
  assertNeverEvidence,
  assertNeverIntent,
  type BlockerReason,
  type CompletionContract,
  type CompletionEvidence,
  type ExitDecision,
  type RunIntent,
} from './index.js';

/**
 * Phase A tests verify:
 *   1. Every union variant is constructible (catches accidental required-
 *      field breakage).
 *   2. The `assertNever*` helpers trip at runtime when a variant leaks
 *      past a `switch`, and the compile would fail if a new variant were
 *      added without updating every exhaustive switch below.
 *
 * The `describeEvidence` / `describeIntent` / `describeBlocker` /
 * `describeDecision` helpers are the "canary" exhaustive switches. Any
 * new union member will fail TypeScript compilation here until added.
 */

function describeEvidence(e: CompletionEvidence): string {
  switch (e.kind) {
    case 'guide_loaded': return `guide:${e.guideId}`;
    case 'ask_user_asked': return `ask:${e.question}`;
    case 'ask_user_answered': return `answer:${e.answer}`;
    case 'mutation_commit': return `commit:${e.toolName}:${e.resultOk}`;
    case 'validation_error': return `valErr:${e.toolName}`;
    case 'process_prompt_activated': return `prompt:${e.key}`;
    case 'generation_started': return `gen:${e.nodeId}`;
    case 'settings_write': return `settings:${e.canvasId}:${e.keys.join(',')}`;
    case 'user_refused': return `refused:${e.message}`;
    case 'budget_exhausted': return `budget:${e.metric}`;
    default: return assertNeverEvidence(e);
  }
}

function describeIntent(i: RunIntent): string {
  switch (i.kind) {
    case 'informational': return 'info';
    case 'browse': return 'browse';
    case 'execution': return `exec:${i.workflow ?? '-'}`;
    case 'mixed': return `mixed:${i.workflow ?? '-'}`;
    default: return assertNeverIntent(i);
  }
}

function describeBlocker(b: BlockerReason): string {
  switch (b.kind) {
    case 'missing_commit': return `miss:${b.expected.join('|')}:${b.lastTool ?? '-'}`;
    case 'ask_user_loop': return `askLoop:${b.askCount}/${b.limit}`;
    case 'empty_narration': return `narr:${b.lastAssistantText.slice(0, 20)}`;
    default: return assertNeverBlocker(b);
  }
}

function describeDecision(d: ExitDecision): string {
  switch (d.outcome) {
    case 'satisfied': return `ok:${d.contractId}`;
    case 'informational_answered': return `info:${d.reason}`;
    case 'blocked_waiting_user': return `block:${d.question}`;
    case 'refused': return `refused:${d.reason}`;
    case 'budget_exhausted': return `budget:${d.metric}`;
    case 'unsatisfied': return `unsat:${d.contractId}:${describeBlocker(d.blocker)}`;
    case 'error': return `err:${d.message}`;
    default: return assertNeverDecision(d);
  }
}

describe('exit-contract/types — RunIntent', () => {
  const samples: RunIntent[] = [
    { kind: 'informational' },
    { kind: 'browse' },
    { kind: 'execution' },
    { kind: 'execution', workflow: 'story-to-video' },
    { kind: 'mixed' },
    { kind: 'mixed', workflow: 'style-plate' },
  ];
  it.each(samples)('is constructible and describable: %o', (intent) => {
    expect(describeIntent(intent)).toMatch(/^(info|browse|exec:|mixed:)/);
  });
});

describe('exit-contract/types — CompletionEvidence', () => {
  const at = 1776000000000;
  const samples: CompletionEvidence[] = [
    { kind: 'guide_loaded', guideId: 'workflow-story-to-video', at },
    { kind: 'ask_user_asked', question: 'which genre?', at },
    { kind: 'ask_user_answered', answer: 'noir', at },
    { kind: 'mutation_commit', toolName: 'canvas.batchCreate', args: { nodes: [{ type: 'text' }] }, resultOk: true, at },
    { kind: 'validation_error', toolName: 'workflow.expandIdea', errorText: 'prompt is required', at },
    { kind: 'process_prompt_activated', key: 'style-plate-lock', reason: 'canvas has refs', at },
    { kind: 'generation_started', nodeId: 'node-123', at },
    { kind: 'settings_write', canvasId: 'canvas-1', keys: ['stylePlate'], at },
    { kind: 'user_refused', message: 'not now', at },
    { kind: 'budget_exhausted', metric: 'steps', at },
  ];
  it.each(samples)('is constructible and exhaustively describable: %o', (evidence) => {
    expect(describeEvidence(evidence)).toBeTruthy();
  });

  it('is immutable at the list level (readonly type)', () => {
    const list: readonly CompletionEvidence[] = samples;
    // A compile error here would signal we weakened the readonly contract.
    expect(list).toHaveLength(samples.length);
  });
});

describe('exit-contract/types — BlockerReason', () => {
  const samples: BlockerReason[] = [
    { kind: 'missing_commit', expected: ['canvas.batchCreate', 'canvas.addNode'] },
    { kind: 'missing_commit', expected: ['canvas.setSettings'], lastTool: 'canvas.getSettings' },
    { kind: 'ask_user_loop', askCount: 6, limit: 3 },
    { kind: 'empty_narration', lastAssistantText: 'I will now proceed.' },
  ];
  it.each(samples)('is constructible: %o', (b) => {
    expect(describeBlocker(b)).toBeTruthy();
  });
});

describe('exit-contract/types — ExitDecision', () => {
  const samples: ExitDecision[] = [
    { outcome: 'satisfied', contractId: 'workflow:story-to-video', evidenceSummary: '1 batchCreate' },
    { outcome: 'informational_answered', reason: 'pure question' },
    { outcome: 'blocked_waiting_user', question: 'which style?' },
    { outcome: 'refused', reason: 'user said not now' },
    { outcome: 'budget_exhausted', metric: 'tokens' },
    { outcome: 'unsatisfied', contractId: 'workflow:shot-list', blocker: { kind: 'missing_commit', expected: ['canvas.batchCreate'] } },
    { outcome: 'error', message: 'llm provider 500' },
  ];
  it.each(samples)('is constructible and describable: %o', (d) => {
    expect(describeDecision(d)).toBeTruthy();
  });
});

describe('exit-contract/types — CompletionContract shape', () => {
  it('accepts a full-featured execution contract', () => {
    const contract: CompletionContract = {
      id: 'workflow:story-to-video',
      requiredCommits: [
        {
          toolName: 'canvas.batchCreate',
          argPredicate: (args) => {
            const a = args as { nodes?: unknown[] } | null;
            return Array.isArray(a?.nodes) && (a!.nodes!.length ?? 0) >= 1;
          },
          description: 'Seed at least one scene node',
        },
      ],
      acceptableSubstitutes: [
        { toolName: 'canvas.addNode', description: 'Single-scene fallback' },
      ],
      infoIntentExemption: false,
      blockingQuestionsAllowed: 3,
      successSignals: [
        {
          id: 'has-text-node',
          check: (ledger) => ledger.some(
            (e) => e.kind === 'mutation_commit' && e.toolName === 'canvas.batchCreate' && e.resultOk,
          ),
          description: 'At least one successful scene seed',
        },
      ],
    };
    expect(contract.id).toBe('workflow:story-to-video');
    expect(contract.requiredCommits[0].argPredicate?.({ nodes: [{ type: 'text' }] })).toBe(true);
    expect(contract.requiredCommits[0].argPredicate?.({})).toBe(false);
    expect(contract.successSignals?.[0].check([])).toBe(false);
  });

  it('accepts a minimal info-answer contract', () => {
    const contract: CompletionContract = {
      id: 'info-answer',
      requiredCommits: [],
      infoIntentExemption: true,
      blockingQuestionsAllowed: 0,
    };
    expect(contract.infoIntentExemption).toBe(true);
  });
});

describe('exit-contract/types — assertNever helpers', () => {
  it('throws when handed a concrete value (runtime safety net)', () => {
    // In real code these are only reachable if TypeScript is bypassed;
    // we still want a clean error, not silent garbage.
    expect(() => assertNeverEvidence({ kind: 'not_a_real_kind' } as unknown as never)).toThrow(
      /Unhandled CompletionEvidence/,
    );
    expect(() => assertNeverIntent({ kind: 'not_a_real_kind' } as unknown as never)).toThrow(
      /Unhandled RunIntent/,
    );
    expect(() => assertNeverBlocker({ kind: 'not_a_real_kind' } as unknown as never)).toThrow(
      /Unhandled BlockerReason/,
    );
    expect(() => assertNeverDecision({ outcome: 'not_a_real_outcome' } as unknown as never)).toThrow(
      /Unhandled ExitDecision/,
    );
  });
});
