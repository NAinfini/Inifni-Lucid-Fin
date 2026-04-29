import type {
  BlockerReason,
  CommitRequirement,
  CompletionContract,
  CompletionEvidence,
  ExitDecision,
  ReadonlyCompletionEvidenceList,
  RunIntent,
} from './types.js';

/**
 * Pure decision engine. Given a contract, intent, and evidence ledger,
 * produce exactly one `ExitDecision`. No I/O, no clock access, no
 * registry lookups — the engine is a fold over the inputs.
 *
 * Phase B wires this behind a shadow-mode stream event: the decision is
 * emitted and recorded by the harness but the orchestrator still returns
 * the old shape. Phase E makes the decision the return value.
 *
 * Decision precedence:
 *   1. Error short-circuit (not handled here — caller checks for runtime
 *      failure and returns `{ outcome: 'error' }` before invoking this).
 *   2. `budget_exhausted` evidence present → `budget_exhausted`.
 *   3. `user_refused` evidence present → `refused`.
 *   4. A pending `ask_user_asked` with no matching `ask_user_answered`
 *      at terminal → `blocked_waiting_user`.
 *   5. Contract satisfied (requirements match, success signals pass) →
 *      `satisfied`.
 *   6. `informational` intent AND `infoIntentExemption` → `informational_answered`.
 *   7. `ask_user_loop` (askCount > limit) → `unsatisfied` with loop blocker.
 *   8. Otherwise → `unsatisfied` with `missing_commit` blocker.
 */
export interface DecideInput {
  contract: CompletionContract;
  intent: RunIntent;
  ledger: ReadonlyCompletionEvidenceList;
  /** The last assistant text, if any. Used for `empty_narration` blocker. */
  lastAssistantText?: string;
}

export function decide(input: DecideInput): ExitDecision {
  const { contract, intent, ledger, lastAssistantText } = input;

  // 2. Budget exhaustion preempts everything else.
  const budget = ledger.find(
    (e): e is Extract<CompletionEvidence, { kind: 'budget_exhausted' }> =>
      e.kind === 'budget_exhausted',
  );
  if (budget) {
    return { outcome: 'budget_exhausted', metric: budget.metric };
  }

  // 3. Explicit user refusal is a terminal answer.
  const refusal = ledger.find(
    (e): e is Extract<CompletionEvidence, { kind: 'user_refused' }> => e.kind === 'user_refused',
  );
  if (refusal) {
    return { outcome: 'refused', reason: refusal.message };
  }

  // 4. Pending ask with no answer — we stopped waiting on the user.
  const asked = ledger.filter(
    (e): e is Extract<CompletionEvidence, { kind: 'ask_user_asked' }> =>
      e.kind === 'ask_user_asked',
  );
  const answered = ledger.filter(
    (e): e is Extract<CompletionEvidence, { kind: 'ask_user_answered' }> =>
      e.kind === 'ask_user_answered',
  );
  if (asked.length > answered.length) {
    const lastAsk = asked[asked.length - 1];
    return { outcome: 'blocked_waiting_user', question: lastAsk.question };
  }

  // 5. Info-exempt short-circuit: info/browse intents on an exempt
  // contract exit "informational_answered" regardless of commits. This
  // comes BEFORE the satisfaction check because a contract with zero
  // requirements is trivially satisfied, which would otherwise swallow
  // the semantically correct "informational_answered" outcome.
  //
  // `mixed` is included for exempt contracts only: `mixed` means the
  // classifier could not commit to execute-vs-answer, so a run that
  // lands on the info-exempt fallback with no mutations attempted should
  // be treated as "the LLM answered" rather than "the LLM failed to
  // execute". Pure `execution` intent stays strict — it is a hard
  // promise and will fall through to `unsatisfied`.
  if (
    contract.infoIntentExemption &&
    (intent.kind === 'informational' || intent.kind === 'browse' || intent.kind === 'mixed')
  ) {
    return {
      outcome: 'informational_answered',
      reason:
        intent.kind === 'browse'
          ? 'browse intent; contract exempts'
          : intent.kind === 'mixed'
            ? 'mixed intent on info-exempt contract; treated as answered'
            : 'informational intent; contract exempts',
    };
  }

  // 6. Contract satisfaction — check required commits and success signals.
  // For execution/mixed intents, a contract with zero required commits
  // AND zero success signals is NOT auto-satisfied; that pairing only
  // makes sense under info-exemption (handled in step 5).
  const isExecutionLike = intent.kind === 'execution' || intent.kind === 'mixed';
  const contractHasAnyRequirement =
    contract.requiredCommits.length > 0 || (contract.successSignals ?? []).length > 0;
  const contractSatisfied = contractHasAnyRequirement && isContractSatisfied(contract, ledger);
  if (contractSatisfied) {
    return {
      outcome: 'satisfied',
      contractId: contract.id,
      evidenceSummary: summarizeSatisfaction(contract, ledger),
    };
  }
  // An empty contract paired with an execution intent is a mis-match; we
  // don't shortcut to satisfied, we fall through to unsatisfied with a
  // meaningful blocker so the author sees the mismatch in reports.
  if (!contractHasAnyRequirement && isExecutionLike) {
    return {
      outcome: 'unsatisfied',
      contractId: contract.id,
      blocker: {
        kind: 'missing_commit',
        expected: [],
        lastTool: ledger
          .slice()
          .reverse()
          .find(
            (e): e is Extract<CompletionEvidence, { kind: 'mutation_commit' }> =>
              e.kind === 'mutation_commit',
          )?.toolName,
      },
    };
  }

  // 7. Ask-user loop: more asks than the contract allows, and we never
  // cleared them with mutations.
  if (asked.length > contract.blockingQuestionsAllowed) {
    const blocker: BlockerReason = {
      kind: 'ask_user_loop',
      askCount: asked.length,
      limit: contract.blockingQuestionsAllowed,
    };
    return { outcome: 'unsatisfied', contractId: contract.id, blocker };
  }

  // 8. Missing commit — the primary unsatisfied shape.
  const expected = contract.requiredCommits.map((c) => c.toolName);
  const lastCommit = ledger
    .slice()
    .reverse()
    .find(
      (e): e is Extract<CompletionEvidence, { kind: 'mutation_commit' }> =>
        e.kind === 'mutation_commit',
    );

  // If the LLM delivered empty narration (no commits, no refusal, no
  // pending ask, no budget hit) and we can see the text, surface that
  // as the blocker — it's the pattern we most want to flag.
  if (lastAssistantText !== undefined && ledger.length === 0) {
    return {
      outcome: 'unsatisfied',
      contractId: contract.id,
      blocker: { kind: 'empty_narration', lastAssistantText },
    };
  }

  const blocker: BlockerReason = {
    kind: 'missing_commit',
    expected,
    lastTool: lastCommit?.toolName,
  };
  return { outcome: 'unsatisfied', contractId: contract.id, blocker };
}

/**
 * A contract is satisfied when every required commit has a matching
 * successful mutation OR an acceptable substitute, AND every success
 * signal passes.
 */
function isContractSatisfied(
  contract: CompletionContract,
  ledger: ReadonlyCompletionEvidenceList,
): boolean {
  const successfulCommits = ledger.filter(
    (e): e is Extract<CompletionEvidence, { kind: 'mutation_commit' }> =>
      e.kind === 'mutation_commit' && e.resultOk,
  );

  for (const req of contract.requiredCommits) {
    if (commitMatches(req, successfulCommits)) continue;
    // No direct match — check substitutes. A substitute must actually
    // pass its own args predicate.
    const subs = contract.acceptableSubstitutes ?? [];
    const anySubstituted = subs.some((sub) => commitMatches(sub, successfulCommits));
    if (!anySubstituted) return false;
  }

  for (const signal of contract.successSignals ?? []) {
    if (!signal.check(ledger)) return false;
  }

  return true;
}

function commitMatches(
  req: CommitRequirement,
  commits: ReadonlyArray<Extract<CompletionEvidence, { kind: 'mutation_commit' }>>,
): boolean {
  return commits.some((c) => {
    if (c.toolName !== req.toolName) return false;
    if (!req.argPredicate) return true;
    try {
      return req.argPredicate(c.args);
    } catch {
      // A buggy predicate must not crash the decision engine. Treat as
      // "did not match" and move on; the contract author can read the
      // stream logs to debug.
      return false;
    }
  });
}

function summarizeSatisfaction(
  contract: CompletionContract,
  ledger: ReadonlyCompletionEvidenceList,
): string {
  const commits = ledger.filter(
    (e): e is Extract<CompletionEvidence, { kind: 'mutation_commit' }> =>
      e.kind === 'mutation_commit' && e.resultOk,
  );
  const commitNames = commits.map((c) => c.toolName).join(', ');
  return `contract:${contract.id} met via [${commitNames || 'signals only'}]`;
}
