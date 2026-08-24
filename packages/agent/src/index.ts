export {
  ToolRegistry,
  deriveCanvasSyncMutatingToolNames,
  deriveEntityMutatingToolNames,
  type ContextReplayMode,
  type PublicContextProjection,
  type PublicToolProjection,
  type ToolCategory,
  type ToolDefinition,
  type ToolExecutionContext,
  type ToolResult,
} from './agent/tool-registry.js';
export {
  TOOL_PROGRAM_LIMITS,
  createToolProgramTool,
  describeToolProgram,
  executeToolProgram,
  parseToolProgram,
  ToolProgramBlockedError,
  ToolProgramCancelledError,
  type ToolProgram,
  type ToolProgramAggregate,
  type ToolProgramCall,
  type ToolProgramChildCall,
  type ToolProgramChildResult,
  type ToolProgramHost,
  type ToolProgramIdentity,
  type ToolProgramPath,
  type ToolProgramStep,
  type ToolProgramValueRef,
} from './agent/tool-program.js';
export {
  createSubagentTools,
  parseSubagentSpawnRequest,
  type AgentPermissionMode,
  type SubagentSpawnRequest,
  type SubagentToolHost,
  type SubagentToolHostFactory,
  type SubagentToolHostFactoryRequest,
} from './agent/subagent-tools.js';
export {
  type TaskDecisionPersistenceRequest,
  type TaskDecisionPersistenceResult,
  type ToolProgramChildLifecycle,
  type ToolProgramChildLifecycleFactory,
  type ToolProgramChildLifecycleRequest,
  type ToolProgramChildOutcome,
} from './agent/tool-executor.js';
export { makeStampedEmit } from './agent/stream-emit.js';
export {
  RunResourceBudgetController,
  parseRunResourceBudgetCheckpoint,
  type ResourceQuote,
  type ResourceMeasurement,
  type ResourceStateSnapshot,
  type ResourceReservation,
  type RunResourceClockCheckpoint,
  type RunResourceLeaseCheckpoint,
  type RunResourceOperationCheckpoint,
  type RunResourceBudgetCheckpoint,
  type RunResourceBudgetRestore,
} from './agent/run-resource-budget.js';
export {
  PROJECTOR_VERSION,
  canonicalJson,
  hashCommanderContextProjection,
  hashEventChain,
  projectCommanderContext,
  sha256CanonicalJson,
  type EventContextProjectionInput,
  type EventContextProjectionRun,
  type EventContextRunHead,
} from './agent/event-context-projector.js';
export { registerToolModule, type ToolModule } from './agent/tool-module.js';
export {
  AgentOrchestrator,
  type AgentContext,
  type AgentOptions,
  type AgentExecutionOptions,
  type AgentRecoveryState,
  type AgentLLMRequestDiagnostics,
  type AgentPersistentContextProjection,
  type AgentStreamEvent,
  type HistoryEntry,
  type StampedStreamEvent,
  type StampedStreamEmission,
  type StampedStreamSink,
  type StreamEmit,
} from './agent/agent-orchestrator.js';
export type { ContextRecoveryReport, ContextRecoveryReportResult } from '@lucid-fin/contracts';
export {
  getTaskListToolDenial,
  type TaskListToolPolicy,
  type TaskListToolPolicyPhase,
} from './agent/task-list-tool-policy.js';
export {
  createAgentOrchestratorForRun,
  type OrchestratorFactoryInput,
  type OrchestratorVariant,
} from './agent/orchestrator-factory.js';
export {
  contractRegistry,
  decide,
  type RunIntent,
  type CompletionContract,
  type CompletionEvidence,
  type ExitDecision,
  type BlockerReason,
  type ReadonlyCompletionEvidenceList,
  type CommitRequirement,
  type SuccessSignal,
  type ExitOutcomeKind,
} from './agent/exit-contract/index.js';
import './agent/exit-contract/contracts/index.js';
export { freshRunId } from './agent/agent-run-id.js';
export { coercePhaseNoteCode, inferErrorCodeFromMessage } from './agent/error-inference.js';
export { ContextManager, type ContextCompactionResult } from './agent/context-manager.js';
export {
  type RunContext,
  type Scratchpad,
  SCRATCHPAD_MAX_CHARS,
  createEmptyScratchpad,
  serializeScratchpad,
} from './agent/run-context.js';
export {
  registerAgentTools,
  registerFiltered,
  EXCLUDED_TOOLS,
  type AllToolDeps,
} from './agent/register-agent-tools.js';
export {
  createCanvasTools,
  type CanvasToolDeps,
  type MediaProviderConfig,
  type MediaTaskView,
  type PrepareMediaTaskInput,
  type SubmitMediaPromptInput,
} from './agent/tools/canvas-tools.js';
export { createEntityTools, type EntityToolDeps } from './agent/tools/entity-tools.js';
export { createScriptTools, type ScriptToolDeps } from './agent/tools/script-tools.js';
export { createColorStyleTools, type ColorStyleToolDeps } from './agent/tools/color-style-tools.js';
export { colorStyleToolModule } from './agent/tools/color-style-tools.js';
export {
  createProviderTools,
  type ProviderToolDeps,
  type ProviderInfo,
} from './agent/tools/provider-tools.js';
export { createAssetTools, type AssetToolDeps } from './agent/tools/asset-tools.js';
export {
  createPromptTools,
  type PromptToolDeps,
  type PromptDetail,
  type PromptListEntry,
} from './agent/tools/prompt-tools.js';
export { createPresetTools, type PresetToolDeps } from './agent/tools/preset-tools.js';
export {
  createTaskListTools,
  type TaskListToolDeps,
  type PrepareAudioTaskInput,
  type SubmitAudioPromptInput,
  type CreateVisualAuditionsInput,
  type CreateVisualAuditionsResult,
  type ProduceTaskMediaInput,
  type RefineTaskMediaInput,
} from './agent/tools/task-list-tools.js';
export { type PromptGuide } from './agent/tools/task-list-guides.js';
export { createMetaTools, type MetaToolDeps } from './agent/tools/meta-tools.js';
export { type CopywritingToolDeps } from './agent/tools/copywriting-tools.js';
export { type VisionToolDeps } from './agent/tools/vision-tools.js';
export {
  createTextAnalyzeTools,
  type TextAnalyzeToolDeps,
} from './agent/tools/text-analyze-tools.js';
export { createSnapshotTools, type SnapshotToolDeps } from './agent/tools/snapshot-tools.js';
export { snapshotToolModule } from './agent/tools/snapshot-tools.js';
export { createRunChecklistTools } from './agent/tools/run-checklist-tools.js';
export {
  RunChecklistStore,
  RunChecklistStoreError,
  type RunChecklistSnapshot,
  type RunChecklistItem,
  type RunChecklistItemStatus,
  type RunChecklistStoreOptions,
  type RunChecklistSetInput,
  type RunChecklistUpdateInput,
} from './agent/tools/run-checklist-store.js';
export {
  ok,
  fail,
  requireString,
  requireNumber,
  requireStringArray,
  requireText,
  requireBoolean,
} from './agent/tools/tool-result-helpers.js';
