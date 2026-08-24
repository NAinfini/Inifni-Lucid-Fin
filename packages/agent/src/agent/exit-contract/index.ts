/**
 * Public barrel for the exit-contract module.
 *
 * Phase A: the five typed primitives + exhaustiveness helpers.
 * Phase B: EvidenceLedger, intent classifier, decision engine, default
 *          info-answer contract.
 * Phase C: contract registry + one-file-per-task-list contracts.
 *
 * Phase D will add the shared orchestrator factory that production + study
 * harness both consume.
 */
export type {
  RunIntent,
  CommitRequirement,
  SuccessSignal,
  CompletionContract,
  CompletionEvidence,
  ReadonlyCompletionEvidenceList,
  BlockerReason,
  ExitDecision,
  ExitOutcomeKind,
} from './types.js';

export {
  assertNeverEvidence,
  assertNeverIntent,
  assertNeverBlocker,
  assertNeverDecision,
} from './types.js';

export { EvidenceLedger } from './evidence-ledger.js';

export { decide, type DecideInput } from './exit-decision-engine.js';

// Phase C — registry + contracts.
// Importing `./contracts/index.js` is the side-effect that registers every
// task-list contract + the `info-answer` fallback. Keep this import before
// `contractRegistry` is used at runtime.
export { contractRegistry } from './contract-registry.js';
export {
  infoAnswerContract,
  mutationExecutionContract,
  taskListExecutionContract,
} from './contracts/index.js';
