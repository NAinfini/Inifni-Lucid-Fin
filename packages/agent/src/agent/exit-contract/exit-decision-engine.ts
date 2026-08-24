import type {
  CompletionContract,
  CompletionEvidence,
  ExitDecision,
  ReadonlyCompletionEvidenceList,
  RunIntent,
} from './types.js';

/** Inputs to the post-hoc exit decision. User-message wording is never inspected. */
export interface DecideInput {
  contract: CompletionContract;
  intent: RunIntent;
  ledger: ReadonlyCompletionEvidenceList;
  lastAssistantText?: string;
}

/**
 * Decide from observed run evidence only.
 * Precedence: budget, refusal, pending ask, successful mutation, failed
 * mutation attempt, non-empty final answer, empty result.
 */
export function decide(input: DecideInput): ExitDecision {
  const { contract, ledger, lastAssistantText } = input;
  const budget = ledger.find(
    (entry): entry is Extract<CompletionEvidence, { kind: 'budget_exhausted' }> =>
      entry.kind === 'budget_exhausted',
  );
  if (budget) return { outcome: 'budget_exhausted', metric: budget.metric };

  const refusal = ledger.find(
    (entry): entry is Extract<CompletionEvidence, { kind: 'user_refused' }> =>
      entry.kind === 'user_refused',
  );
  if (refusal) return { outcome: 'refused', reason: refusal.message };

  const asked = ledger.filter(
    (entry): entry is Extract<CompletionEvidence, { kind: 'ask_user_asked' }> =>
      entry.kind === 'ask_user_asked',
  );
  const answered = ledger.filter(
    (entry): entry is Extract<CompletionEvidence, { kind: 'ask_user_answered' }> =>
      entry.kind === 'ask_user_answered',
  );
  if (asked.length > answered.length) {
    return { outcome: 'blocked_waiting_user', question: asked[asked.length - 1]!.question };
  }

  const mutations = ledger.filter(
    (entry): entry is Extract<CompletionEvidence, { kind: 'mutation_commit' }> =>
      entry.kind === 'mutation_commit',
  );
  const successful = mutations.filter((entry) => entry.resultOk);
  if (successful.length > 0) {
    return {
      outcome: 'satisfied',
      contractId: contract.id,
      evidenceSummary: `successful mutations: ${successful.map((entry) => entry.toolName).join(', ')}`,
    };
  }
  if (mutations.length > 0) {
    return {
      outcome: 'unsatisfied',
      contractId: contract.id,
      blocker: {
        kind: 'missing_commit',
        expected: [],
        lastTool: mutations[mutations.length - 1]!.toolName,
      },
    };
  }

  if (lastAssistantText?.trim()) {
    return {
      outcome: 'informational_answered',
      reason: 'non-empty final answer without a mutation attempt',
    };
  }
  return {
    outcome: 'unsatisfied',
    contractId: contract.id,
    blocker: { kind: 'empty_narration', lastAssistantText: lastAssistantText ?? '' },
  };
}
