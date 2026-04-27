import { describe, expect, it } from 'vitest';
import { decide } from './exit-decision-engine.js';
import type { CompletionContract, CompletionEvidence, ReadonlyCompletionEvidenceList, RunIntent } from './types.js';
import { infoAnswerContract } from './contracts/info-answer.js';

function execContract(overrides: Partial<CompletionContract> = {}): CompletionContract {
  return {
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
      { toolName: 'canvas.addNode', description: 'Single-node fallback' },
    ],
    infoIntentExemption: false,
    blockingQuestionsAllowed: 3,
    ...overrides,
  };
}

const execIntent: RunIntent = { kind: 'execution', workflow: 'story-to-video' };
const infoIntent: RunIntent = { kind: 'informational' };
const browseIntent: RunIntent = { kind: 'browse' };

describe('exit-contract/decide', () => {
  describe('budget_exhausted precedence', () => {
    it('returns budget_exhausted even if other evidence exists', () => {
      const ledger: ReadonlyCompletionEvidenceList = [
        { kind: 'mutation_commit', toolName: 'canvas.batchCreate', args: { nodes: [{}] }, resultOk: true, at: 1 },
        { kind: 'budget_exhausted', metric: 'steps', at: 2 },
      ];
      const d = decide({ contract: execContract(), intent: execIntent, ledger });
      expect(d).toEqual({ outcome: 'budget_exhausted', metric: 'steps' });
    });
  });

  describe('refused', () => {
    it('returns refused on user_refused evidence', () => {
      const ledger: ReadonlyCompletionEvidenceList = [
        { kind: 'user_refused', message: 'not now', at: 1 },
      ];
      const d = decide({ contract: execContract(), intent: execIntent, ledger });
      expect(d).toEqual({ outcome: 'refused', reason: 'not now' });
    });
  });

  describe('blocked_waiting_user', () => {
    it('returns blocked when asks > answers', () => {
      const ledger: ReadonlyCompletionEvidenceList = [
        { kind: 'ask_user_asked', question: 'which genre?', at: 1 },
      ];
      const d = decide({ contract: execContract(), intent: execIntent, ledger });
      expect(d).toEqual({ outcome: 'blocked_waiting_user', question: 'which genre?' });
    });
    it('uses the most recent ask as the blocker question', () => {
      const ledger: ReadonlyCompletionEvidenceList = [
        { kind: 'ask_user_asked', question: 'first', at: 1 },
        { kind: 'ask_user_answered', answer: 'a', at: 2 },
        { kind: 'ask_user_asked', question: 'second', at: 3 },
      ];
      const d = decide({ contract: execContract(), intent: execIntent, ledger });
      expect(d.outcome).toBe('blocked_waiting_user');
      if (d.outcome === 'blocked_waiting_user') expect(d.question).toBe('second');
    });
  });

  describe('satisfied', () => {
    it('returns satisfied when required commit matches', () => {
      const ledger: ReadonlyCompletionEvidenceList = [
        { kind: 'mutation_commit', toolName: 'canvas.batchCreate', args: { nodes: [{ type: 'text' }] }, resultOk: true, at: 1 },
      ];
      const d = decide({ contract: execContract(), intent: execIntent, ledger });
      expect(d.outcome).toBe('satisfied');
      if (d.outcome === 'satisfied') {
        expect(d.contractId).toBe('workflow:story-to-video');
        expect(d.evidenceSummary).toContain('canvas.batchCreate');
      }
    });

    it('returns satisfied via acceptable substitute', () => {
      const ledger: ReadonlyCompletionEvidenceList = [
        { kind: 'mutation_commit', toolName: 'canvas.addNode', args: {}, resultOk: true, at: 1 },
      ];
      const d = decide({ contract: execContract(), intent: execIntent, ledger });
      expect(d.outcome).toBe('satisfied');
    });

    it('fails argPredicate — not satisfied', () => {
      const ledger: ReadonlyCompletionEvidenceList = [
        { kind: 'mutation_commit', toolName: 'canvas.batchCreate', args: { nodes: [] }, resultOk: true, at: 1 },
      ];
      const d = decide({ contract: execContract(), intent: execIntent, ledger });
      expect(d.outcome).toBe('unsatisfied');
    });

    it('ignores failed mutations (resultOk=false)', () => {
      const ledger: ReadonlyCompletionEvidenceList = [
        { kind: 'mutation_commit', toolName: 'canvas.batchCreate', args: { nodes: [{}] }, resultOk: false, at: 1 },
      ];
      const d = decide({ contract: execContract(), intent: execIntent, ledger });
      expect(d.outcome).toBe('unsatisfied');
    });

    it('requires all successSignals to pass', () => {
      const contract = execContract({
        successSignals: [
          {
            id: 'has-5-or-more-nodes',
            check: (l) => l.filter((e) => e.kind === 'mutation_commit' && e.resultOk).length >= 5,
            description: 'At least 5 committed mutations',
          },
        ],
      });
      const ledger: ReadonlyCompletionEvidenceList = [
        { kind: 'mutation_commit', toolName: 'canvas.batchCreate', args: { nodes: [{}] }, resultOk: true, at: 1 },
      ];
      const d = decide({ contract, intent: execIntent, ledger });
      expect(d.outcome).toBe('unsatisfied');
    });

    it('tolerates a throwing argPredicate without crashing', () => {
      const contract = execContract({
        requiredCommits: [
          {
            toolName: 'canvas.batchCreate',
            argPredicate: () => { throw new Error('buggy predicate'); },
            description: 'Seed scene',
          },
        ],
        acceptableSubstitutes: [], // no substitute
      });
      const ledger: ReadonlyCompletionEvidenceList = [
        { kind: 'mutation_commit', toolName: 'canvas.batchCreate', args: { nodes: [{}] }, resultOk: true, at: 1 },
      ];
      const d = decide({ contract, intent: execIntent, ledger });
      expect(d.outcome).toBe('unsatisfied');
    });
  });

  describe('informational_answered', () => {
    it('info intent + info-exempt contract → informational_answered', () => {
      const d = decide({ contract: infoAnswerContract, intent: infoIntent, ledger: [] });
      expect(d).toEqual({ outcome: 'informational_answered', reason: 'informational intent; contract exempts' });
    });

    it('browse intent + info-exempt contract → informational_answered', () => {
      const d = decide({ contract: infoAnswerContract, intent: browseIntent, ledger: [] });
      expect(d.outcome).toBe('informational_answered');
    });

    it('execution intent + info-exempt contract falls through to unsatisfied', () => {
      // Execution intent on info-answer contract is an odd pairing (should
      // not happen in practice) but engine must not return info_answered
      // here.
      const d = decide({ contract: infoAnswerContract, intent: execIntent, ledger: [] });
      expect(d.outcome).toBe('unsatisfied');
    });

    it('mixed intent + info-exempt contract → informational_answered', () => {
      // `mixed` is the classifier's "I am not sure" — when it lands on
      // the fallback contract with no workflow, we treat it as an
      // answered question rather than a missed execution. This keeps
      // every plain-chat Chinese or short English message from being
      // banner-flagged as `missing_commit`.
      const d = decide({ contract: infoAnswerContract, intent: { kind: 'mixed' }, ledger: [] });
      expect(d.outcome).toBe('informational_answered');
    });
  });

  describe('unsatisfied blockers', () => {
    it('ask_user_loop when askCount > blockingQuestionsAllowed', () => {
      const contract = execContract({ blockingQuestionsAllowed: 2 });
      const ledger: ReadonlyCompletionEvidenceList = [
        { kind: 'ask_user_asked', question: '1', at: 1 },
        { kind: 'ask_user_answered', answer: 'a', at: 2 },
        { kind: 'ask_user_asked', question: '2', at: 3 },
        { kind: 'ask_user_answered', answer: 'b', at: 4 },
        { kind: 'ask_user_asked', question: '3', at: 5 },
        { kind: 'ask_user_answered', answer: 'c', at: 6 },
      ];
      const d = decide({ contract, intent: execIntent, ledger });
      expect(d.outcome).toBe('unsatisfied');
      if (d.outcome === 'unsatisfied') {
        expect(d.blocker).toEqual({ kind: 'ask_user_loop', askCount: 3, limit: 2 });
      }
    });

    it('empty_narration when ledger is empty and we have last text', () => {
      const d = decide({
        contract: execContract(),
        intent: execIntent,
        ledger: [],
        lastAssistantText: 'I will help you with that.',
      });
      expect(d.outcome).toBe('unsatisfied');
      if (d.outcome === 'unsatisfied') {
        expect(d.blocker).toEqual({ kind: 'empty_narration', lastAssistantText: 'I will help you with that.' });
      }
    });

    it('missing_commit blocker lists expected tools and last tool called', () => {
      const ledger: ReadonlyCompletionEvidenceList = [
        { kind: 'mutation_commit', toolName: 'canvas.getState', args: {}, resultOk: true, at: 1 },
      ];
      const d = decide({ contract: execContract(), intent: execIntent, ledger });
      expect(d.outcome).toBe('unsatisfied');
      if (d.outcome === 'unsatisfied') {
        expect(d.blocker).toEqual({ kind: 'missing_commit', expected: ['canvas.batchCreate'], lastTool: 'canvas.getState' });
      }
    });
  });

  describe('pure-function contract', () => {
    it('returns the same decision for the same inputs', () => {
      const contract = execContract();
      const intent = execIntent;
      const ledger: CompletionEvidence[] = [
        { kind: 'mutation_commit', toolName: 'canvas.batchCreate', args: { nodes: [{}] }, resultOk: true, at: 1 },
      ];
      const d1 = decide({ contract, intent, ledger });
      const d2 = decide({ contract, intent, ledger });
      expect(d1).toEqual(d2);
    });
  });
});
