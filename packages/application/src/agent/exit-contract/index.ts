/**
 * Public barrel for the exit-contract module.
 *
 * Phase A: the five typed primitives + exhaustiveness helpers.
 * Phase B: EvidenceLedger, intent classifier, decision engine, default
 *          info-answer contract.
 * Phase C: contract registry + one-file-per-workflow contracts + declarative
 *          process-prompt specs (style-plate-lock among them).
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

export { classifyIntent, type ClassifyIntentContext } from './intent-classifier.js';

export { decide, type DecideInput } from './exit-decision-engine.js';

// Phase C — registry + contracts + specs.
// Importing `./contracts/index.js` is the side-effect that registers every
// workflow contract + the `info-answer` fallback. Keep this import before
// `contractRegistry` is used at runtime.
export { contractRegistry } from './contract-registry.js';
export { infoAnswerContract } from './contracts/index.js';
export {
  storyToVideoContract,
  stylePlateContract,
  shotListContract,
  continuityCheckContract,
  imageAnalyzeContract,
  audioProductionContract,
  styleTransferContract,
} from './contracts/index.js';

export type {
  ProcessPromptSpec,
  ProcessPromptLifecycle,
  ActivationContext,
  ProcessPromptEvaluationResult,
} from './process-prompt-spec.js';
export { evaluateProcessPromptSpecs } from './process-prompt-spec.js';
export {
  createStylePlateLockSpec,
  stylePlateLockPredicate,
  isGenerationTool,
} from './specs/style-plate-lock.js';
export {
  createEntitiesBeforeGenerationSpec,
  entitiesBeforeGenerationPredicate,
} from './specs/entities-before-generation.js';
export {
  createBatchCreateGuidanceSpec,
  batchCreateGuidancePredicate,
} from './specs/batch-create-guidance.js';
export {
  createPromptQualityGateSpec,
  promptQualityGatePredicate,
} from './specs/prompt-quality-gate.js';
export {
  createStoryWorkflowPhaseSpec,
  storyWorkflowPhasePredicate,
} from './specs/story-workflow-phase.js';
