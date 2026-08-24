import { describe, expect, it } from 'vitest';
import { decide } from './exit-decision-engine.js';
import type { CompletionContract, CompletionEvidence } from './types.js';

const contract: CompletionContract = {
  id: 'post-hoc',
  requiredCommits: [],
  infoIntentExemption: false,
  blockingQuestionsAllowed: 0,
};

function decision(ledger: CompletionEvidence[], lastAssistantText = '') {
  return decide({ contract, intent: { kind: 'execution' }, ledger, lastAssistantText });
}

describe('post-hoc exit decision', () => {
  it('retains budget, refusal, and pending-question precedence', () => {
    expect(
      decision([
        { kind: 'mutation_commit', toolName: 'canvas.createNodes', args: {}, resultOk: true, at: 1 },
        { kind: 'budget_exhausted', metric: 'tool_calls', at: 2 },
      ]),
    ).toEqual({ outcome: 'budget_exhausted', metric: 'tool_calls' });
    expect(decision([{ kind: 'user_refused', message: 'stop', at: 1 }])).toEqual({
      outcome: 'refused',
      reason: 'stop',
    });
    expect(decision([{ kind: 'ask_user_asked', question: 'Which one?', at: 1 }])).toEqual({
      outcome: 'blocked_waiting_user',
      question: 'Which one?',
    });
  });

  it('treats any successful mutation as satisfied', () => {
    expect(
      decision([
        { kind: 'mutation_commit', toolName: 'preset.manage', args: {}, resultOk: true, at: 1 },
      ]),
    ).toMatchObject({ outcome: 'satisfied', contractId: 'post-hoc' });
  });

  it('treats an attempted failed mutation as unsatisfied even with final text', () => {
    expect(
      decision(
        [{ kind: 'mutation_commit', toolName: 'canvas.createNodes', args: {}, resultOk: false, at: 1 }],
        'I could not make the change.',
      ),
    ).toMatchObject({
      outcome: 'unsatisfied',
      blocker: { kind: 'missing_commit', lastTool: 'canvas.createNodes' },
    });
  });

  it('treats non-empty final text without a mutation attempt as informationally answered', () => {
    expect(decision([], 'Here is the answer.')).toEqual({
      outcome: 'informational_answered',
      reason: 'non-empty final answer without a mutation attempt',
    });
  });

  it('treats an empty result as unsatisfied', () => {
    expect(decision([])).toEqual({
      outcome: 'unsatisfied',
      contractId: 'post-hoc',
      blocker: { kind: 'empty_narration', lastAssistantText: '' },
    });
  });
});
