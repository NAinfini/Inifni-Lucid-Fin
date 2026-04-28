export { JobQueue } from './job-queue.js';
export { LRUCache, type LRUCacheOptions } from './lru-cache.js';
export {
  compilePrompt,
  getCameraShot,
  type CameraShot,
  type CompiledPrompt,
  type PromptCompilerInput,
  type PromptMode,
  type ResolvedCharacter,
} from './prompt-compiler.js';
export {
  CostCenter,
  type UsageRecord,
  type BudgetLimit,
  type BudgetStatus,
} from './cost-center.js';
export { TemplateManager, type SceneTemplate } from './template-manager.js';
export type {
  WorkflowTaskExecutionContext,
  WorkflowTaskExecutionResult,
  WorkflowTaskHandler,
} from './task-handler.js';
export {
  WorkflowRegistry,
  type WorkflowProjectionFields,
  type RegisteredWorkflowDefinition,
  type RegisteredWorkflowStageDefinition,
  type RegisteredWorkflowTaskDefinition,
} from './workflow-registry.js';
export {
  WorkflowPlanner,
  type PlannedWorkflowRows,
  type WorkflowPlanRequest,
  type WorkflowTaskDependencyRow,
} from './workflow-planner.js';
export {
  WorkflowEngine,
  type WorkflowEngineOptions,
  type WorkflowStartRequest,
} from './workflow-engine.js';
export { WorkflowRecovery } from './workflow-recovery.js';
export { registerDefaultWorkflows } from './register-default-workflows.js';
export { styleExtractWorkflow } from './workflows/style.extract.js';
export { characterGenerateReferencesWorkflow } from './workflows/character.generate-references.js';
export { locationGenerateReferencesWorkflow } from './workflows/location.generate-references.js';
export { buildCharacterAppearancePrompt, buildCharacterRefImagePrompt } from './agent/tools/character-prompt.js';
export { buildLocationRefImagePrompt } from './agent/tools/location-prompt.js';
export { AgentToolRegistry, type AgentTool, type ToolResult } from './agent/tool-registry.js';
export { registerToolModule, type ToolModule } from './agent/tool-module.js';
export {
  AgentOrchestrator,
  type AgentContext,
  type AgentOptions,
  type AgentExecutionOptions,
  type AgentLLMRequestDiagnostics,
  type AgentStreamEvent,
  type HistoryEntry,
  type StampedStreamEvent,
  type StreamEmit,
} from './agent/agent-orchestrator.js';
export {
  createAgentOrchestratorForRun,
  type OrchestratorFactoryInput,
  type OrchestratorVariant,
  type CanvasLookup,
} from './agent/orchestrator-factory.js';
// Phase F — exit-contract public extensibility surface. Anything not
// listed here is `@internal` and must not be consumed outside the
// application package. The `public-surface.test.ts` snapshot guards this.
export {
  contractRegistry,
  decide,
  classifyIntent,
  evaluateProcessPromptSpecs,
  createStylePlateLockSpec,
  type RunIntent,
  type CompletionContract,
  type CompletionEvidence,
  type ExitDecision,
  type BlockerReason,
  type ReadonlyCompletionEvidenceList,
  type CommitRequirement,
  type SuccessSignal,
  type ExitOutcomeKind,
  type ProcessPromptSpec,
  type ProcessPromptLifecycle,
  type ActivationContext,
  type ProcessPromptEvaluationResult,
} from './agent/exit-contract/index.js';
// Side-effect import: loads every built-in contract so
// `contractRegistry.ids()` returns the stable set at package-load time.
// No named exports from this path — the built-in contracts are not a
// public identity; consumers should go through `contractRegistry`.
import './agent/exit-contract/contracts/index.js';
export { freshRunId } from './agent/agent-run-id.js';
export {
  coercePhaseNoteCode,
  inferErrorCodeFromMessage,
} from './agent/error-inference.js';
export {
  ContextManager,
  selectContextualToolSet,
  type ToolSelectionInput,
} from './agent/context-manager.js';
export { registerAgentTools, type AllToolDeps } from './agent/register-agent-tools.js';
export { createCanvasTools, type CanvasToolDeps } from './agent/tools/canvas-tools.js';
export { createCharacterTools, type CharacterToolDeps } from './agent/tools/character-tools.js';
export { createLocationTools, type LocationToolDeps } from './agent/tools/location-tools.js';
export { createScriptTools, type ScriptToolDeps } from './agent/tools/script-tools.js';
export { createJobTools, type JobToolDeps } from './agent/tools/job-tools.js';
export { jobToolModule } from './agent/tools/job-tools.js';
export { createSeriesTools, type SeriesToolDeps, type SeriesEpisode } from './agent/tools/series-tools.js';
export { seriesToolModule } from './agent/tools/series-tools.js';
export { createColorStyleTools, type ColorStyleToolDeps } from './agent/tools/color-style-tools.js';
export { colorStyleToolModule } from './agent/tools/color-style-tools.js';
export { createProviderTools, type ProviderToolDeps, type ProviderInfo } from './agent/tools/provider-tools.js';
export { createAssetTools, type AssetToolDeps } from './agent/tools/asset-tools.js';
export {
  createPromptTools,
  type PromptToolDeps,
  type PromptDetail,
  type PromptListEntry,
} from './agent/tools/prompt-tools.js';
export { createRenderTools, type RenderToolDeps } from './agent/tools/render-tools.js';
export { createPresetTools, type PresetToolDeps } from './agent/tools/preset-tools.js';
export { createWorkflowTools, type WorkflowToolDeps } from './agent/tools/workflow-tools.js';
export { type PromptGuide } from './agent/tools/workflow-guides.js';
export { createEquipmentTools, type EquipmentToolDeps } from './agent/tools/equipment-tools.js';
export { createMetaTools, type MetaToolDeps } from './agent/tools/meta-tools.js';
export { createCopywritingTools, type CopywritingToolDeps } from './agent/tools/copywriting-tools.js';
export { createVisionTools, type VisionToolDeps } from './agent/tools/vision-tools.js';
export { createSnapshotTools, type SnapshotToolDeps } from './agent/tools/snapshot-tools.js';
export { snapshotToolModule } from './agent/tools/snapshot-tools.js';
export { createTodoTools } from './agent/tools/todo-tools.js';
export {
  TodoRunStore,
  TodoRunStoreError,
  type TodoSnapshot,
  type TodoItem,
  type TodoStatus,
  type TodoRunStoreOptions,
  type TodoSetInput,
  type TodoUpdateInput,
} from './agent/tools/todo-run-store.js';
export { ok, fail, requireString, requireNumber, requireStringArray, requireText, requireBoolean } from './agent/tools/tool-result-helpers.js';
export {
  getToolCompactionCategory,
  getClassifiedToolNames,
  type ToolCompactionCategory,
} from '@lucid-fin/shared-utils';
export {
  ToolCatalog,
  entityMutatingToolNames,
  canvasSyncMutatingToolNames,
  type AppToolCatalog,
  type AppToolKey,
  type AppProcessCategory,
} from './agent/tool-catalog.js';

// Phase D-1: Generation application service scaffold
export {
  GenerationApplicationService,
  STRATEGIES,
  selectStrategy,
  type PipelineRequest,
  type GenerationEvent,
  type GenerationStrategy,
} from './generation/application-service.js';
