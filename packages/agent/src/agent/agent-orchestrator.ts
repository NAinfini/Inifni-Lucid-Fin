import type {
  LLMAdapter,
  LLMMessage,
  LLMStreamEvent,
  LLMToolCall,
  LLMFinishReason,
  ProviderProfile,
  TimelineExitDecisionMeta,
  ContextRecoveryReport,
  ContextRecoveryReportResult,
  RunBlocker,
  RunResourceBudget,
  RunResourceUsage,
  LLMCostUpperBound,
  CommanderWorkType,
} from '@lucid-fin/contracts';
import { LucidError, DEFAULT_PROVIDER_PROFILE, parseCanonicalToolName } from '@lucid-fin/contracts';
import { providerHealth } from '@lucid-fin/adapters-ai';
import type { ToolRegistry, ToolResult } from './tool-registry.js';
import { getToolCompactionCategory } from '@lucid-fin/shared-utils';
import {
  type AgentContext,
  type HistoryEntry,
  ContextManager,
  pruneHistory,
  measureMessageChars,
  safeStringify,
} from './context-manager.js';
import {
  ToolExecutor,
  type TaskDecisionPersistenceRequest,
  type TaskDecisionPersistenceResult,
  type ToolProgramChildLifecycleFactory,
} from './tool-executor.js';
import type { SubagentToolHostFactory } from './subagent-tools.js';
import {
  ToolCallDeduplicator,
  type ToolCallDedupSeed,
} from './tool-call-deduplicator.js';
import { TranscriptIndex } from './transcript-index.js';
import { ContextGraph } from './graph/context-graph.js';
import { serializeForOpenAI } from './graph/serializers/openai.js';
import { freshContextItemId } from '@lucid-fin/contracts-parse';
import type { ContextItem, ToolKey } from '@lucid-fin/contracts';
import {
  type StampedStreamEmission,
  type StampedStreamEvent,
  type StampedStreamSink,
  type StreamEmit,
  type StreamEventBody,
  type StreamRecoveryBody,
  makeStampedEmit,
} from './stream-emit.js';
import { freshRunId } from './agent-run-id.js';
import {
  EvidenceLedger,
  decide,
  contractRegistry,
  type ExitDecision,
  type RunIntent,
} from './exit-contract/index.js';
import { type Scratchpad, createEmptyScratchpad, serializeScratchpad } from './run-context.js';
import {
  type OrchestratorCompletion,
  stripInjectedParamsFromTool,
  destructResponse,
  extractEntityIdFromArgs,
} from './orchestrator-utils.js';
import type { TaskListToolPolicy } from './task-list-tool-policy.js';
import {
  RunResourceBudgetController,
  type ResourceMeasurement,
  type ResourceQuote,
  type ResourceStateSnapshot,
} from './run-resource-budget.js';
import type { CanonicalJsonValue } from './event-context-projector.js';

// Re-export types so consumers don't break
export type { AgentContext, HistoryEntry };
export type { StampedStreamEmission, StampedStreamEvent, StampedStreamSink, StreamEmit };

// v2 wire: stream events are TimelineEvents. Re-export for main-process
// handlers that plug directly into the orchestrator's emit surface.
export type AgentStreamEvent = StampedStreamEvent;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export interface AgentOptions {
  /** Frozen, per-run user limits. Missing dimensions are unlimited. */
  resourceBudget?: RunResourceBudget;
  /** Durable cumulative usage inherited by an explicit continuation Run. */
  resourceCarryIn?: RunResourceUsage;
  /** Injectable monotonic-compatible clock used by deterministic budget tests. */
  resourceNow?: () => number;
  temperature?: number;
  /** Maximum output tokens sent to the provider. This is not the context window. */
  maxOutputTokens?: number;
  /** Optional user cap for the model input context window. */
  contextWindowTokens?: number;
  profile?: ProviderProfile;
  /** Called after LLM-based context compaction. Returns fresh workspace context
   *  to inject into the compacted message. Wired by commander.handlers.ts. */
  onPostCompact?: () => string | null;
  /** Persist and verify durable task-list facts before LLM compaction. */
  onBeforeCompact?: () => boolean;
  /** Rebuild host-owned task-list facts and tool authorization from SQLite. */
  resolvePersistentContext?: () => AgentPersistentContextProjection;
  /** Persist task-list-bound AskUser questions before exposing them to the UI. */
  onTaskDecision?: (
    request: TaskDecisionPersistenceRequest,
  ) => Promise<TaskDecisionPersistenceResult> | TaskDecisionPersistenceResult;
  /** Persist context recovery health on the bound task-list aggregate. */
  onContextRecoveryReport?: (
    report: ContextRecoveryReport,
  ) => Promise<ContextRecoveryReportResult> | ContextRecoveryReportResult;
  /** Host-owned durable child Run lifecycle for typed Tool Programs. */
  toolProgramLifecycleFactory?: ToolProgramChildLifecycleFactory;
  /** Host-owned model-directed child Run boundary. */
  subagentToolHostFactory?: SubagentToolHostFactory;
}

export interface AgentPersistentContextProjection {
  taskListManifest?: string;
  taskListToolPolicy?: TaskListToolPolicy;
}

export interface AgentExecutionOptions {
  /** Host-reserved identity for this run. Required when the host ACKs before execution. */
  runId?: string;
  /** Next event sequence after any host-persisted prefix events. */
  initialSeq?: number;
  /** Disable when the host already persisted and emitted the run_start event. */
  emitRunStart?: boolean;
  /** Disable when the host atomically persisted the initialized resource snapshot. */
  emitResourceInitialized?: boolean;
  /** Explicit parent Run for budget-carrying continuations. */
  continuationOfRunId?: string;
  workType?: CommanderWorkType;
  parentRunId?: string;
  retryOfRunId?: string;
  displayName?: string;
  objective?: string;
  history?: HistoryEntry[];
  isAborted?: () => boolean;
  permissionMode?: 'danger' | 'auto' | 'normal' | 'strict';
  onLLMRequest?: (diagnostics: AgentLLMRequestDiagnostics) => void;
  /** Host-created child lease. Root Runs create their own account. */
  resourceController?: RunResourceBudgetController;
  /** Verified private state projected from this Run's append-only event stream. */
  recoveryState?: AgentRecoveryState;
}

export interface AgentRecoveryState {
  history: HistoryEntry[];
  completedSteps: readonly number[];
  dedupSeeds: readonly ToolCallDedupSeed[];
  startPaused: boolean;
}

export interface AgentLLMRequestDiagnostics {
  step: number;
  toolCount: number;
  toolSchemaChars: number;
  messageCount: number;
  messageChars: number;
  systemPromptChars: number;
  promptGuideChars: number;
  estimatedTokensUsed: number;
  contextWindowTokens: number;
  cacheChars: number;
  cacheEntryCount: number;
  historyMessagesTrimmed: number;
  utilizationRatio: number;
}

const CONSERVATIVE_CONTEXT_WINDOW_TOKENS = 32_768;
const CONTEXT_TARGET_UTILIZATION = 0.7;
const CONTEXT_REFERENCE_PRUNE_UTILIZATION = 0.75;
const CONTEXT_CHECKPOINT_UTILIZATION = 0.85;
const CONTEXT_HARD_STOP_UTILIZATION = 0.92;
const MIN_OUTPUT_RESERVE_RATIO = 0.15;

class RunBudgetBlockedError extends Error {
  constructor(readonly blocker: RunBlocker) {
    super(`Run blocked by ${blocker.kind}`);
    this.name = 'RunBudgetBlockedError';
  }
}

function conservativeRequestTokenUpperBound(
  messages: readonly LLMMessage[],
  tools: readonly unknown[],
  maxOutputTokens: number,
): number {
  const encodedBytes = new TextEncoder().encode(JSON.stringify({ messages, tools })).byteLength;
  return encodedBytes + maxOutputTokens;
}

function measurementFromUsage(
  quote: ResourceQuote,
  usage?: { promptTokens?: number; completionTokens?: number; reasoningTokens?: number },
): ResourceMeasurement {
  const prompt = usage?.promptTokens;
  const completion = usage?.completionTokens;
  const hasReportedTotal = Number.isFinite(prompt) || Number.isFinite(completion);
  return {
    tokens: hasReportedTotal
      ? {
          knowledge: 'known',
          value: Math.max(0, Math.floor(prompt ?? 0)) + Math.max(0, Math.floor(completion ?? 0)),
        }
      : quote.tokens.knowledge === 'unknown'
        ? { knowledge: 'unknown' }
        : { knowledge: 'estimated', value: quote.tokens.value },
    toolCalls: 0,
    costUsd:
      quote.costUsd.knowledge === 'unknown'
        ? { knowledge: 'unknown' }
        : { knowledge: quote.costUsd.knowledge, value: quote.costUsd.value },
  };
}

function costQuoteFromAdapter(value: LLMCostUpperBound | undefined): ResourceQuote['costUsd'] {
  if (!value || value.kind === 'unknown') return { knowledge: 'unknown' };
  if (value.kind === 'free') {
    return { knowledge: 'known', value: 0, upperBound: true };
  }
  if (!Number.isFinite(value.amountUsd) || value.amountUsd < 0) {
    throw new Error('LLM cost upper bound must be finite and non-negative');
  }
  return {
    knowledge: value.knowledge,
    value: value.amountUsd,
    upperBound: true,
  };
}

export class AgentOrchestrator {
  private adapter: LLMAdapter;
  private tools: ToolRegistry;
  private readonly resourceBudget: Readonly<RunResourceBudget>;
  private readonly resourceCarryIn?: RunResourceUsage;
  private readonly resourceNow?: () => number;
  private activeResourceController: RunResourceBudgetController | null = null;
  private temperature: number;
  private maxOutputTokens: number;
  private contextWindowTokens?: number;
  private profile: ProviderProfile;
  private readonly onTaskDecision?: AgentOptions['onTaskDecision'];
  private readonly onContextRecoveryReport?: AgentOptions['onContextRecoveryReport'];
  private readonly toolProgramLifecycleFactory?: ToolProgramChildLifecycleFactory;
  private readonly subagentToolHostFactory?: SubagentToolHostFactory;
  private activeTaskListId: string | undefined;
  private pendingResolvers = new Map<string, (approved: boolean) => void>();
  private pendingQuestionResolvers = new Map<string, (answer: string) => void>();
  private activeModelContext: { view: LLMMessage[] } | null = null;
  private activeEmit: StreamEmit | null = null;
  private _cancelled = false;
  /**
   * Per-run controller. `cancel()` aborts it to propagate into in-flight
   * fetch streams and iterators; a fresh controller is installed at the
   * start of every `execute()` so a prior cancel can't pre-poison the next
   * run.
   */
  private _abortController: AbortController | null = null;
  /**
   * Step-level controller. `cancelCurrentStep()` aborts just this
   * controller, so the active LLM fetch ends but the agent loop survives
   * and can either retry the same step or move on. Replaced at the start
   * of each step.
   */
  private _currentStepController: AbortController | null = null;
  /**
   * Timestamp of the most recent step-abort, used to detect a
   * "double-tap" cancel: if the user hits the button twice within
   * ESCALATE_WINDOW_MS we escalate to a full run abort.
   */
  private _lastStepAbortAt = 0;
  private _runState: 'inactive' | 'running' | 'pause_requested' | 'paused' = 'inactive';
  private _resumePausedRun: (() => void) | undefined;
  private transcriptIndex: TranscriptIndex;
  /** Cached tool schema JSON to avoid re-serialization each step. */
  private _lastToolSchemaJson = '';
  private _lastToolSchemaChars = 0;
  private _lastToolCount = 0;

  private contextManager: ContextManager;
  private toolExecutor: ToolExecutor;

  /** Active ContextGraph for the current execute() session (graph-path only). */
  private contextGraph: ContextGraph | null = null;

  /**
   * Invalidation / identity watermarks. Keys use the composite
   * `${toolCallId}|${toolKey}|${paramsHash}` because some adapters emit
   * deterministic fallback ids (`tool-call-0`, `cohere-tc-0`) that repeat
   * across turns. Keying on the composite means a later call that reuses
   * the same id but with different tool/args is treated as a distinct
   * entry, not accidentally re-invalidated.
   */
  private invalidatedToolCallKeys = new Set<string>();
  private snapshotPreRestoreToolCallKeys = new Set<string>();
  private toolCallKeyToOriginStep = new Map<string, number>();

  private readonly _hasPostCompactHook: boolean;
  private readonly resolvePersistentContext?: () => AgentPersistentContextProjection;

  /**
   * Step at which the model most recently resolved a `commander.askUser`
   * call. Used by the askUser-continuation safety net to spot the "opener
   * → askUser → answer → stop" early-exit pattern observed in 9/50 of the
   * 04-19 study sessions.
   *
   * Used by `recordEvidenceForStep` to timestamp the `ask_user_answered`
   * evidence event on the step AFTER the ask resolves. Reset per
   * `execute()`.
   */
  private lastAskUserAnsweredStep: number | null = null;

  private lastMutationStep = 0;
  private static readonly STALL_THRESHOLD = 5;
  private static readonly RETRY_LOOP_THRESHOLD = 3;
  private toolValidationErrors = new Map<string, number>();

  /**
   * Phase B — Shadow exit-contract state. The ledger records typed
   * evidence for the current run; `currentIntent` and `lastAssistantText`
   * feed the decision engine at terminal. Reset at the top of every
   * `execute()`.
   *
   * Phase B never changes return values; the decision flows out as a
   * stream event (`exit_decision`) so harness and telemetry can read the
   * "satisfied vs stopped" delta. Phase E switches to using the decision
   * as the return value.
   */
  private evidenceLedger: EvidenceLedger = new EvidenceLedger();
  private currentIntent: RunIntent = { kind: 'execution' };
  private lastAssistantText = '';

  // ── Scratchpad (v2 — structured with [context] section) ────────
  private scratchpad: Scratchpad = createEmptyScratchpad();

  constructor(
    adapter: LLMAdapter,
    tools: ToolRegistry,
    resolvePrompt: (code: string) => string,
    opts?: AgentOptions,
  ) {
    this.adapter = adapter;
    this.tools = tools;
    this.resourceBudget = Object.freeze({ ...(opts?.resourceBudget ?? {}) });
    this.resourceCarryIn = opts?.resourceCarryIn;
    this.resourceNow = opts?.resourceNow;
    this.temperature = opts?.temperature ?? 0.7;
    this.profile = opts?.profile ?? DEFAULT_PROVIDER_PROFILE;
    this.onTaskDecision = opts?.onTaskDecision;
    this.onContextRecoveryReport = opts?.onContextRecoveryReport;
    this.toolProgramLifecycleFactory = opts?.toolProgramLifecycleFactory;
    this.subagentToolHostFactory = opts?.subagentToolHostFactory;
    const profileOutputCap = Math.max(1, this.profile.outputReserveTokens ?? 4096);
    this.maxOutputTokens = Math.min(
      Math.max(1, Math.floor(opts?.maxOutputTokens ?? profileOutputCap)),
      profileOutputCap,
    );
    this.contextWindowTokens =
      typeof opts?.contextWindowTokens === 'number' && opts.contextWindowTokens > 0
        ? Math.floor(opts.contextWindowTokens)
        : undefined;
    this._hasPostCompactHook = typeof opts?.onPostCompact === 'function';
    this.resolvePersistentContext = opts?.resolvePersistentContext;

    this.contextManager = new ContextManager(adapter, resolvePrompt, {
      onBeforeCompact: opts?.onBeforeCompact,
      onPostCompact: opts?.onPostCompact,
    });
    this.toolExecutor = new ToolExecutor(tools);
    this.transcriptIndex = new TranscriptIndex();
  }

  /** Resolve a pending tool confirmation. Called from outside (IPC handler). */
  confirmTool(toolCallId: string, approved: boolean): boolean {
    const resolver = this.pendingResolvers.get(toolCallId);
    if (!resolver) return false;
    this.pendingResolvers.delete(toolCallId);
    resolver(approved);
    return true;
  }

  /** Resolve a pending user question. Called from outside (IPC handler). */
  answerQuestion(toolCallId: string, answer: string): boolean {
    const resolver = this.pendingQuestionResolvers.get(toolCallId);
    if (!resolver) return false;
    this.pendingQuestionResolvers.delete(toolCallId);
    resolver(answer);
    return true;
  }

  /** Check whether a user-question resolver can still receive an answer. */
  hasPendingQuestion(toolCallId: string): boolean {
    return this.pendingQuestionResolvers.has(toolCallId);
  }

  /** Cancel the running agent. Resolves all pending promises so the loop unblocks. */
  cancel(): void {
    this._cancelled = true;
    const resumePausedRun = this._resumePausedRun;
    this._resumePausedRun = undefined;
    resumePausedRun?.();
    // Stage 1: abort the in-flight fetch / iterator so the LLM stream ends fast.
    this._abortController?.abort();
    this._currentStepController?.abort();
    // Stage 2: resolve anything waiting on user input so the agent loop unwinds.
    const resolvers = [...this.pendingResolvers.values()];
    this.pendingResolvers.clear();
    for (const resolve of resolvers) resolve(false);
    const questionResolvers = [...this.pendingQuestionResolvers.values()];
    this.pendingQuestionResolvers.clear();
    for (const resolve of questionResolvers) resolve('');
  }

  /**
   * Abort only the currently-running LLM step — the agent loop stays
   * alive, the abort is caught by `completeWithRetry` as a Cancelled
   * error, and the retry machinery kicks in. If the user hits this twice
   * within ESCALATE_WINDOW_MS we escalate to a full `cancel()` on the
   * assumption the single-step retry isn't doing what they want.
   */
  cancelCurrentStep(): { escalated: boolean } {
    const ESCALATE_WINDOW_MS = 2000;
    const now = Date.now();
    if (now - this._lastStepAbortAt < ESCALATE_WINDOW_MS) {
      this.cancel();
      return { escalated: true };
    }
    this._lastStepAbortAt = now;
    this._currentStepController?.abort();
    return { escalated: false };
  }

  /** Request a cooperative pause after the current non-interruptible work finishes. */
  pause(): boolean {
    if (
      this._runState !== 'running' ||
      this._cancelled ||
      this.pendingResolvers.size > 0 ||
      this.pendingQuestionResolvers.size > 0
    ) {
      return false;
    }
    this._runState = 'pause_requested';
    return true;
  }

  /** Resume a run that reached a persisted safe-boundary pause. */
  resume(): boolean {
    if (this._runState !== 'paused' || !this._resumePausedRun) return false;
    const resumePausedRun = this._resumePausedRun;
    this._resumePausedRun = undefined;
    resumePausedRun();
    return true;
  }

  /**
   * Trigger context compaction from outside (e.g. tool.compact, UI button).
   */
  async compactNow(
    instructions?: string,
  ): Promise<{ freedChars: number; messageCount: number; toolCount: number }> {
    const modelContext = this.activeModelContext;
    const sourceView = modelContext?.view ?? null;
    const hadMessages = Boolean(sourceView && sourceView.length > 0);
    const result = await this.contextManager.compactNow(sourceView, instructions);
    if (
      modelContext &&
      this.activeModelContext === modelContext &&
      modelContext.view === sourceView
    ) {
      modelContext.view = result.view;
    }
    if (hadMessages && this.activeTaskListId) {
      await this.reportContextRecovery(
        result.freedChars > 0 ? 'recovered' : 'failed',
        result.freedChars > 0 ? 'persistent_context_reloaded' : 'compaction_failed',
      );
    }
    return {
      freedChars: result.freedChars,
      messageCount: result.messageCount,
      toolCount: result.toolCount,
    };
  }

  private refreshPersistentContext(context: AgentContext): TaskListToolPolicy | undefined {
    if (!this.resolvePersistentContext) {
      const policy = context.extra?.taskListToolPolicy as TaskListToolPolicy | undefined;
      this.activeTaskListId = policy?.taskListId;
      return policy;
    }
    if (!context.extra) context.extra = {};
    const projection = this.resolvePersistentContext();
    if (typeof projection.taskListManifest === 'string') {
      context.extra.taskListManifest = projection.taskListManifest;
    } else {
      delete context.extra.taskListManifest;
    }
    if (projection.taskListToolPolicy) {
      context.extra.taskListToolPolicy = projection.taskListToolPolicy;
    } else {
      delete context.extra.taskListToolPolicy;
    }
    const policy = context.extra.taskListToolPolicy as TaskListToolPolicy | undefined;
    this.activeTaskListId = policy?.taskListId;
    return policy;
  }

  private async reportContextRecovery(
    outcome: ContextRecoveryReport['outcome'],
    reason: ContextRecoveryReport['reason'],
    forcePause?: boolean,
  ): Promise<ContextRecoveryReportResult | undefined> {
    if (!this.onContextRecoveryReport || !this.activeTaskListId) return undefined;
    return this.onContextRecoveryReport({
      taskListId: this.activeTaskListId,
      outcome,
      reason,
      ...(forcePause ? { forcePause: true } : {}),
    });
  }

  /** Current step counter. */
  private _currentStep = 0;

  injectMessage(content: string): void {
    const trimmed = content.trim();
    if (!trimmed || !this.activeModelContext || !this.activeEmit) return;
    this.activeModelContext.view.push({ role: 'user', content: trimmed });
    this.activeEmit({ kind: 'user_message', content: trimmed });
  }

  private async pauseAtSafeBoundary(
    resourceController: RunResourceBudgetController,
    emit: StreamEmit,
    restoredPause = false,
  ): Promise<void> {
    if (this._runState !== 'pause_requested' || this._cancelled) return;

    const resume = new Promise<void>((resolve) => {
      this._resumePausedRun = resolve;
    });
    this._runState = 'paused';
    if (restoredPause) {
      if (resourceController.snapshot({ kind: 'pause_started' }).clock.state !== 'paused') {
        throw new Error('Paused recovery requires a paused resource checkpoint');
      }
    } else {
      emit({ kind: 'run_paused' });
      emit(resourceController.startPause());
    }
    await resume;

    if (this._cancelled) return;
    const resourceState = resourceController.endPause();
    this._runState = 'running';
    emit({ kind: 'run_resumed' });
    emit(resourceState);
  }

  private canonicalDedupResult(toolName: string, priorWasError: boolean): ToolResult {
    return this.tools.canonicalizeResult(toolName, {
      success: false,
      error: priorWasError
        ? 'Identical tool call was skipped after the prior call failed.'
        : 'Identical tool call was skipped because it already completed in this run.',
    });
  }

  async execute(
    userMessage: string,
    context: AgentContext,
    emit: StampedStreamSink,
    options?: AgentExecutionOptions,
  ): Promise<OrchestratorCompletion> {
    const recoveryState = options?.recoveryState;
    if (recoveryState) {
      if (!options?.runId || options.initialSeq === undefined || !options.resourceController) {
        throw new Error('Recovered execution requires runId, initialSeq, and resourceController');
      }
      if (
        !Number.isSafeInteger(options.initialSeq) ||
        options.initialSeq < 0 ||
        recoveryState.completedSteps.some(
          (step) => !Number.isSafeInteger(step) || step < 0,
        )
      ) {
        throw new Error('Recovered execution requires non-negative safe sequence and step values');
      }
    } else {
      this.contextManager.noteUserInput();
    }
    let taskListToolPolicy = this.refreshPersistentContext(context);
    let systemPrompt = this.contextManager.buildSystemPrompt(context, 1);

    // Compute context budget from adapter's context window.
    const adapterContextWindow = this.adapter.effectiveContextWindow;
    const effectiveCtx =
      adapterContextWindow && this.contextWindowTokens
        ? Math.min(adapterContextWindow, this.contextWindowTokens)
        : (adapterContextWindow ?? this.contextWindowTokens ?? CONSERVATIVE_CONTEXT_WINDOW_TOKENS);
    const detectedCtx = this.adapter.contextWindow;
    const userCtx = this.adapter.userContextWindow;

    const historyCharBudget = Math.floor(
      effectiveCtx * CONTEXT_TARGET_UTILIZATION * this.profile.charsPerToken,
    );
    const history = pruneHistory(recoveryState?.history ?? options?.history, historyCharBudget);

    const inLoopTokenBudget = Math.floor(effectiveCtx * CONTEXT_TARGET_UTILIZATION);
    const inLoopCharBudget = Math.floor(inLoopTokenBudget * this.profile.charsPerToken);
    const outputReserveTokens = Math.min(
      Math.max(this.maxOutputTokens, Math.ceil(effectiveCtx * MIN_OUTPUT_RESERVE_RATIO)),
      Math.max(1, effectiveCtx - 1),
    );
    const providerMaxOutputTokens = Math.min(
      this.maxOutputTokens,
      Math.max(1, effectiveCtx - outputReserveTokens),
    );

    const modelContext: { view: LLMMessage[] } = {
      view: [
        { role: 'system', content: systemPrompt },
        ...history.map((entry): LLMMessage => {
          if (entry.role === 'tool') {
            return { role: 'tool', content: entry.content, toolCallId: entry.toolCallId };
          }
          const msg: LLMMessage = { role: entry.role, content: entry.content };
          if (!recoveryState && entry.role === 'assistant' && entry.reasoning) {
            msg.reasoning = entry.reasoning;
          }
          if (
            entry.role === 'assistant' &&
            Array.isArray(entry.toolCalls) &&
            entry.toolCalls.length > 0
          ) {
            msg.toolCalls = entry.toolCalls.map((tc) => ({
              id: tc.id,
              name: tc.name,
              arguments: tc.arguments,
              thoughtSignature: tc.thoughtSignature,
            }));
          }
          return msg;
        }),
        ...(recoveryState ? [] : [{ role: 'user' as const, content: userMessage }]),
      ],
    };

    let steps = recoveryState
      ? Math.max(0, ...recoveryState.completedSteps)
      : 0;
    let lastResult: OrchestratorCompletion = { content: '', toolCalls: [], finishReason: 'stop' };
    const runId = options?.runId ?? freshRunId();
    if (!runId.trim()) throw new Error('runId must not be empty');
    const resourceController = options?.resourceController ?? new RunResourceBudgetController(
      this.resourceBudget,
      {
        ...(this.resourceCarryIn ? { carryIn: this.resourceCarryIn } : {}),
        ...(this.resourceNow ? { now: this.resourceNow } : {}),
        leaseId: runId,
      },
    );
    const resourceRecovery = (body: StreamEventBody): StreamRecoveryBody | undefined => {
      if (body.kind !== 'resource_state') return undefined;
      const checkpoint = resourceController.exportCheckpoint();
      const restored = RunResourceBudgetController.restoreCheckpoint(checkpoint, {
        now: () => 0,
      }).controllers.get(resourceController.leaseId);
      if (!restored) throw new Error('Resource checkpoint is missing the active Run lease');
      const canonicalState = restored.snapshot(body.cause);
      return {
        body: {
          ...canonicalState,
          clock: { ...canonicalState.clock, changedAt: body.clock.changedAt },
        },
        recovery: { kind: 'resource_checkpoint', checkpoint },
      };
    };
    // `steps` is captured by closure so every emit reads the current step.
    // This stamped wrapper is the only emit surface used — raw `emit` is
    // intentionally never touched directly after this point.
    const wrappedEmit: StreamEmit = makeStampedEmit(
      runId,
      () => steps,
      emit,
      options?.initialSeq,
      resourceRecovery,
    );
    this.activeResourceController = resourceController;
    let terminalEmitted = false;
    const emitRunEnd = (event: Extract<Parameters<StreamEmit>[0], { kind: 'run_end' }>): void => {
      if (terminalEmitted) return;
      terminalEmitted = true;
      resourceController.stop();
      wrappedEmit(event);
    };
    const finishBlocked = (blocker: RunBlocker): OrchestratorCompletion => {
      resourceController.stop();
      wrappedEmit(resourceController.snapshot({ kind: 'boundary', blocker }));
      emitRunEnd({
        kind: 'run_end',
        status: 'blocked',
        blocker,
      });
      return {
        content: '',
        toolCalls: [],
        finishReason: 'stop',
      };
    };

    // Phase G — per-run tool-call deduplicator. Fresh instance per
    // `execute()` so dedup state can't leak across runs.
    const toolCallDeduplicator = new ToolCallDeduplicator();
    if (recoveryState) toolCallDeduplicator.seed(recoveryState.dedupSeeds);

    try {
      // Phase B: emit `run_start` bracket so the renderer can group events
      // into a per-run card (Phase D). The intent is the raw user message —
      // renderer crops / formats for display.
      if (!recoveryState && options?.emitRunStart !== false) {
        wrappedEmit({
          kind: 'run_start',
          intent: userMessage,
          resourceBudget: this.resourceBudget,
          workType: options?.workType ?? 'agent',
          ...(options?.parentRunId ? { parentRunId: options.parentRunId } : {}),
          ...(options?.retryOfRunId ? { retryOfRunId: options.retryOfRunId } : {}),
          ...(options?.displayName ? { displayName: options.displayName } : {}),
          ...(options?.objective ? { objective: options.objective } : {}),
          ...(options?.continuationOfRunId
            ? { continuationOfRunId: options.continuationOfRunId }
            : {}),
        });
      }
      if (
        !recoveryState &&
        (options?.emitResourceInitialized ?? options?.emitRunStart !== false)
      ) {
        wrappedEmit(resourceController.snapshot({ kind: 'initialized' }));
      }

      if (userCtx && detectedCtx && userCtx < detectedCtx) {
        wrappedEmit({
          kind: 'assistant_text',
          content: `[Note: Your configured context window (${userCtx.toLocaleString()} tokens) is smaller than the model's actual context (${detectedCtx.toLocaleString()} tokens). Using your configured value.]\n`,
          isDelta: true,
        });
      }

      this._currentStep = steps;
      this.lastAskUserAnsweredStep = null;
      this.lastMutationStep = 0;
      this.toolValidationErrors.clear();

      // 2C: Reset scratchpad state for new run.
      this.scratchpad = createEmptyScratchpad();
      this.contextManager.setScratchpad(null);

      // Exit decisions are post-hoc: evidence, not user-message wording,
      // determines whether this run mutated state or answered informationally.
      this.evidenceLedger = new EvidenceLedger();
      this.currentIntent = { kind: 'execution' };
      this.lastAssistantText = '';
      if (!context.extra) context.extra = {};

      this.activeModelContext = modelContext;
      this.activeEmit = wrappedEmit;

      // NOTE: no longer compacting history on load — the serializer enforces
      // context budget, and eager truncation causes re-read loops for bulk ops.
      this._cancelled = false;
      this._abortController = new AbortController();
      this._currentStepController = null;
      this._lastStepAbortAt = 0;
      this._runState = recoveryState?.startPaused ? 'pause_requested' : 'running';
      this._resumePausedRun = undefined;

      this.transcriptIndex = new TranscriptIndex();

      const canvasId =
        typeof context.extra?.canvasId === 'string' ? context.extra.canvasId : undefined;
      const availableTools = this.tools.toLLMTools();
      const injectedParams = canvasId ? ['canvasId'] : [];
      const graphToolsInput =
        injectedParams.length > 0
          ? availableTools.map((tool) => stripInjectedParamsFromTool(tool, injectedParams))
          : availableTools;

      // Build the transcript association index once for restored history.
      // Later appended messages are indexed incrementally.
      this.transcriptIndex.rebuild(modelContext.view);

      // ── G2a-6: Initialize ContextGraph ───────────────────────────────────
      // The graph is rebuilt each step from the canonical `messages` array
      // immediately before serialization. This keeps the graph in sync with
      // system-prompt refreshes and authentic user messages without tracking
      // them twice.
      // `serializeForOpenAI` produces the unified `LLMMessage[]` wire format
      // that every adapter consumes. Adapter-specific wire conversion
      // (e.g. Claude's content blocks) happens inside each adapter.
      this.contextGraph = new ContextGraph();
      this.invalidatedToolCallKeys = new Set<string>();
      this.snapshotPreRestoreToolCallKeys = new Set<string>();
      this.toolCallKeyToOriginStep = new Map<string, number>();
      let reportedHealthyContext = false;

      // Create tool executor with graph reference (read-through cache comes
      // from the graph's tool-result index; mutation invalidation is driven
      // by the graph below).
      this.toolExecutor = new ToolExecutor(this.tools, {
        permissionMode: options?.permissionMode,
        contextGraph: this.contextGraph,
        canvasId,
        onTaskDecision: this.onTaskDecision,
        resourceController,
        runId,
        beforeProgramDispatch: () => this.pauseAtSafeBoundary(resourceController, wrappedEmit),
        toolProgramLifecycleFactory: this.toolProgramLifecycleFactory,
        subagents: this.subagentToolHostFactory?.({
          parentRunId: runId,
          resourceController,
          permissionMode: options?.permissionMode ?? 'normal',
        }),
        onUserWaitState: (state) => {
          wrappedEmit(
            state === 'started'
              ? resourceController.startUserWait()
              : resourceController.endUserWait(),
          );
        },
      });

      let restoredPause = recoveryState?.startPaused === true;
      while (true) {
        await this.pauseAtSafeBoundary(resourceController, wrappedEmit, restoredPause);
        restoredPause = false;
        if (this._cancelled || options?.isAborted?.()) {
          // Counts intentionally zero — renderer derives accurate
          // completed/pending counts from the timeline events for this
          // run (see `selectRunToolStats` + CancelledBanner). Keeping the
          // backend emission authoritative-free avoids double-counting
          // when synthetic tool_result events are appended later.
          wrappedEmit({
            kind: 'cancelled',
            reason: 'user',
            completedToolCalls: 0,
            pendingToolCalls: 0,
          });
          emitRunEnd({ kind: 'run_end', status: 'cancelled' });
          return { content: 'Cancelled.', toolCalls: [], finishReason: 'stop' };
        }

        const resourceBoundary = resourceController.checkBoundary();
        if (resourceBoundary) return finishBlocked(resourceBoundary);

        steps++;
        this._currentStep = steps;

        // Task-list facts and tool authorization are rebuilt from SQLite on
        // every step. An approval clicked while this run is waiting therefore
        // takes effect on the next turn, while stale chat text never does.
        taskListToolPolicy = this.refreshPersistentContext(context);
        systemPrompt = this.contextManager.buildSystemPrompt(context, steps);
        if (modelContext.view.length > 0 && modelContext.view[0].role === 'system') {
          modelContext.view[0] = { ...modelContext.view[0], content: systemPrompt };
        }

        // No unconditional step-1 compaction: the verified pre-request
        // utilization state machine below compacts only when needed.

        this.toolExecutor.opts.taskListPolicy = taskListToolPolicy;

        // Build wire payload via ContextGraph serializer.
        // The graph is rebuilt from the canonical `messages` array each step
        // (covers system-prompt refreshes and new user messages).
        // Serialization handles budget
        // enforcement, tool-name sanitization, stub/cache skipping, and
        // dangling-tool/pairing guards.
        const serializeCurrentView = () => {
          this.rebuildGraphFromMessages(modelContext.view, steps);
          if (!this.contextGraph) {
            throw new Error('ContextGraph missing — execute() was not initialized correctly.');
          }
          // Rebuild creates a new graph instance, so keep the executor's
          // read-through cache attached to the current one.
          this.toolExecutor.opts.contextGraph = this.contextGraph;
          return serializeForOpenAI({
            graph: this.contextGraph,
            contextWindowTokens: effectiveCtx,
            tools: graphToolsInput,
            profile: this.profile,
            reserveTokensForOutput: outputReserveTokens,
          });
        };

        let serialized = serializeCurrentView();
        let utilizationRatio = serialized.estimatedTokensUsed / effectiveCtx;
        let didCompact = false;
        let compactionAttempted = false;
        let compactPhase: 'phase1' | 'llm' | undefined;

        if (utilizationRatio >= CONTEXT_HARD_STOP_UTILIZATION) {
          // At 92% no auxiliary LLM call is safe. Flush durable facts, then
          // allow only deterministic pruning before deciding whether to pause.
          if (this.contextManager.checkpointDurableFacts()) {
            const compaction = this.contextManager.compactPhase1(modelContext.view, steps);
            modelContext.view = compaction.view;
            didCompact = compaction.changed;
            compactionAttempted = compaction.attempted;
            compactPhase = didCompact ? 'phase1' : undefined;
          }
        } else if (utilizationRatio >= CONTEXT_CHECKPOINT_UTILIZATION) {
          const compaction = await this.contextManager.compactWithLLMResult(
            modelContext.view,
            inLoopCharBudget,
            steps,
          );
          modelContext.view = compaction.view;
          didCompact = compaction.changed;
          compactionAttempted = compaction.attempted;
          compactPhase = didCompact ? 'llm' : undefined;
        } else if (utilizationRatio >= CONTEXT_REFERENCE_PRUNE_UTILIZATION) {
          const compaction = this.contextManager.compactPhase1(modelContext.view, steps);
          modelContext.view = compaction.view;
          didCompact = compaction.changed;
          compactionAttempted = compaction.attempted;
          compactPhase = didCompact ? 'phase1' : undefined;
        }

        if (didCompact) {
          taskListToolPolicy = this.refreshPersistentContext(context);
          this.toolExecutor.opts.taskListPolicy = taskListToolPolicy;
          systemPrompt = this.contextManager.buildSystemPrompt(context, steps);
          if (modelContext.view[0]?.role === 'system') {
            modelContext.view[0] = { ...modelContext.view[0], content: systemPrompt };
          }
          serialized = serializeCurrentView();
          utilizationRatio = serialized.estimatedTokensUsed / effectiveCtx;
          wrappedEmit({
            kind: 'phase_note',
            note: 'compacted',
            params: {
              phase: compactPhase ?? 'phase1',
              reloaded: compactPhase === 'llm' ? this._hasPostCompactHook : true,
            },
          });
        }

        if (utilizationRatio >= CONTEXT_HARD_STOP_UTILIZATION) {
          await this.reportContextRecovery('failed', 'hard_stop', true);
          return finishBlocked({ kind: 'safety_limit', limit: 'context_window' });
        }

        if (compactionAttempted && !didCompact) {
          reportedHealthyContext = false;
          const recovery = await this.reportContextRecovery('failed', 'compaction_failed');
          if (recovery?.state === 'recovery_required') {
            return finishBlocked({ kind: 'safety_limit', limit: 'recovery_required' });
          }
        } else if (
          !reportedHealthyContext &&
          (didCompact || utilizationRatio < CONTEXT_CHECKPOINT_UTILIZATION)
        ) {
          const wasBlocked = taskListToolPolicy?.phase === 'blocked';
          const recovery = await this.reportContextRecovery(
            'recovered',
            'persistent_context_reloaded',
          );
          reportedHealthyContext = true;
          if (wasBlocked && recovery?.changed && recovery.state === 'active') {
            // The host restored a task list that was paused specifically for
            // context recovery. Refresh the execution-time authorization.
            taskListToolPolicy = this.refreshPersistentContext(context);
            this.toolExecutor.opts.taskListPolicy = taskListToolPolicy;
            continue;
          }
        }

        const {
          wireMessages,
          wireTools,
          toolNameReverseMap: graphReverseMap,
          estimatedTokensUsed,
        } = serialized;
        const ctxWindow = effectiveCtx;
        // History-trim approximation: how many source messages didn't make it
        // into the wire window. Loses the exact "old-trim vs orphan-drop"
        // distinction the legacy constructor tracked, but preserves the same
        // "are we losing history?" diagnostic signal.
        const historyMessagesTrimmed = Math.max(
          0,
          modelContext.view.length - wireMessages.length,
        );

        // Cache tool schema serialization — only re-serialize when tool count changes
        if (availableTools.length !== this._lastToolCount) {
          this._lastToolSchemaJson = safeStringify(availableTools);
          this._lastToolSchemaChars = this._lastToolSchemaJson.length;
          this._lastToolCount = availableTools.length;
        }

        // Graph entity-cache projection chars — used for diagnostics only;
        // the serializer computes the authoritative figure internally.
        const entityCacheBlock = this.contextGraph.serializeEntityCache();
        const graphToolResultCount = this.contextGraph.countToolResults();

        options?.onLLMRequest?.({
          step: steps,
          toolCount: availableTools.length,
          toolSchemaChars: this._lastToolSchemaChars,
          messageCount: wireMessages.length,
          messageChars: measureMessageChars(modelContext.view),
          systemPromptChars: systemPrompt.length,
          promptGuideChars: Array.isArray(context.extra?.autoInjectGuides)
            ? context.extra.autoInjectGuides.reduce(
                (total, guide) =>
                  total +
                  (guide &&
                  typeof guide === 'object' &&
                  typeof (guide as { content?: unknown }).content === 'string'
                    ? (guide as { content: string }).content.length
                    : 0),
                0,
              )
            : 0,
          estimatedTokensUsed: estimatedTokensUsed,
          contextWindowTokens: ctxWindow,
          cacheChars: entityCacheBlock.length,
          cacheEntryCount: graphToolResultCount,
          historyMessagesTrimmed,
          utilizationRatio,
        });

        wrappedEmit({
          kind: 'public_progress',
          operationId: `model:${steps}`,
          status: 'running',
        });

        const activeContextGraph = this.contextGraph;
        if (!activeContextGraph) {
          throw new Error('ContextGraph missing before provider tool execution.');
        }
        const providerToolBridge =
          this.adapter.toolLoopMode === 'provider-managed'
            ? {
                execute: async (wireCall: LLMToolCall) => {
                  const tc: LLMToolCall = {
                    ...wireCall,
                    name: graphReverseMap.get(wireCall.name) ?? wireCall.name,
                  };
                  const toolRef = parseCanonicalToolName(tc.name);
                  const args = this.toolExecutor.mergedArgsFor(tc);
                  const prior = toolCallDeduplicator.check(toolRef, args, steps);
                  if (prior) {
                    const result = this.canonicalDedupResult(tc.name, prior.wasError);
                    const content = safeStringify(result);
                    wrappedEmit({
                      kind: 'tool_call',
                      toolCallId: tc.id,
                      toolRef,
                      args,
                    });
                    wrappedEmit.withRecovery(
                      {
                        kind: 'tool_result',
                        toolCallId: tc.id,
                        projection: this.tools.projectPublicCall(tc.name, args),
                        status: 'skipped',
                        durationMs: 0,
                        skipped: true,
                        synthetic: true,
                      },
                      { kind: 'tool_result', result: result as CanonicalJsonValue },
                    );
                    return { toolCallId: tc.id, content, success: false };
                  }

                  modelContext.view.push({ role: 'assistant', content: '', toolCalls: [tc] });
                  let content: string;
                  let success = false;

                  this.toolExecutor.opts.currentStep = steps;
                  const result = await this.toolExecutor.executeToolCalls(
                    [tc],
                    wrappedEmit,
                    modelContext.view,
                    () => this._cancelled || (options?.isAborted?.() ?? false),
                    this.pendingResolvers,
                    this.pendingQuestionResolvers,
                  );
                  if (result.blocked) throw new RunBudgetBlockedError(result.blocked);
                  if (result.cancelled) throw new Error('Commander tool execution was cancelled');
                  const toolMessage = this.latestToolResultMessage(modelContext.view, tc.id);
                  content =
                    toolMessage?.content ??
                    safeStringify({ success: false, error: 'Tool returned no result' });
                  success = !content.includes('"success":false');

                  toolCallDeduplicator.register(toolRef, args, {
                    toolCallId: tc.id,
                    step: steps,
                    wasError: !success,
                  });
                  this.transcriptIndex.sync(modelContext.view);
                  this.recordEvidenceForStep(modelContext.view, [tc]);
                  this.updateScratchpad(modelContext.view, [tc]);
                  if (tc.name === 'commander.askUser') {
                    this.lastAskUserAnsweredStep = steps;
                  }
                  if (getToolCompactionCategory(tc.name) === 'mutation') {
                    activeContextGraph.invalidateForMutation(tc.name, args);
                    this.recordMutationWatermark(tc.name, args);
                  }
                  modelContext.view = this.shrinkCoveredToolMessages(modelContext.view);
                  return { toolCallId: tc.id, content, success };
                },
              }
            : undefined;

        const rawResult = await this.completeWithRetry(
          wireMessages,
          {
            tools: wireTools.length > 0 ? wireTools : undefined,
            toolChoice: wireTools.length > 0 ? 'auto' : undefined,
            temperature: this.temperature,
            maxTokens: providerMaxOutputTokens,
            signal: this._abortController?.signal,
            providerToolBridge,
          },
          wrappedEmit,
          () => this._cancelled || (options?.isAborted?.() ?? false),
          this.adapter.toolLoopMode === 'provider-managed' ? 0 : 2,
        );

        // Un-sanitize tool names and dedup tool call IDs using the graph
        // serializer's reverse map.
        lastResult = destructResponse(rawResult, graphReverseMap);

        wrappedEmit.withRecovery(
          {
            kind: 'public_progress',
            operationId: `model:${steps}`,
            status: 'completed',
          },
          {
            kind: 'model_checkpoint',
            content: lastResult.content,
            finishReason: lastResult.finishReason,
            toolCalls: lastResult.toolCalls.map((call) => ({
              id: call.id,
              name: call.name,
              arguments: this.toolExecutor.mergedArgsFor(call) as Record<
                string,
                CanonicalJsonValue
              >,
              ...(call.thoughtSignature?.trim()
                ? { thoughtSignature: call.thoughtSignature }
                : {}),
            })),
            completedStep: steps,
          },
        );

        if (
          lastResult.toolCalls.length > 0 &&
          lastResult.toolCalls.every((call) => call.handledByProviderLoop === true)
        ) {
          // The provider stayed inside its own turn while the host bridge ran
          // each call through ToolExecutor. Rebuild context and authorization
          // before exposing the next dynamic-tool set; never execute twice.
          continue;
        }

        // Deltas already streamed to the renderer via `drainLLMStream` — no
        // post-hoc `thinking`/`chunk` re-emit needed.

        // No tool calls -- done.
        if (lastResult.toolCalls.length === 0 || lastResult.finishReason !== 'tool_calls') {
          // Phase F removed the 04-19 askUser-continuation reminder.
          // The `ask_user_loop` blocker + Phase F hard enforcement now
          // carry that semantic — a run that ends on "ask → answer → stop"
          // with no mutation naturally surfaces as `unsatisfied` with a
          // `missing_commit` blocker, and execution-intent runs cannot
          // return `done` silently.
          const finalContent = lastResult.content;
          this.lastAssistantText = finalContent;

          // Phase E — compute the exit decision and carry it on both the
          // v2: ExitDecision rides on `run_end`. `assistant_text` with
          // `isDelta: false` delivers the terminal text payload.
          const { decision, intent } = this.computeExitDecision();

          if (finalContent.trim().length > 0) {
            wrappedEmit({
              kind: 'assistant_text',
              content: finalContent,
              isDelta: false,
            });
          }
          emitRunEnd({
            kind: 'run_end',
            status: 'completed',
            exitDecision: this.toTimelineExitDecisionMeta(decision),
          });
          // Phase F — the ExitDecision is the authoritative outcome. Callers
          // that want to hard-enforce (e.g. harness, E2E tests, UI banners
          // on retry flows) read it here instead of re-parsing the stream.
          return { ...lastResult, exitDecision: decision, exitIntent: intent };
        }

        modelContext.view.push({
          role: 'assistant',
          content: lastResult.content,
          reasoning: lastResult.reasoning,
          toolCalls: lastResult.toolCalls,
        });

        // v2: Post-execution guide inject (fallback path).
        // If a mutation tool is about to execute but its guide is not yet
        // active in Layer 3, inject it now. The guide will be visible on
        // Phase G — per-turn tool-call dedup.
        //
        // Any `(toolRef, argsHash)` we saw execute within the last
        // `windowSteps` is short-circuited: we emit a `phase_note` +
        // synthetic `tool_result(skipped)` and push a `role: 'tool'`
        // message with a feedback note so the LLM sees the prior outcome
        // and doesn't re-call. Non-dup calls fall through to executor.
        //
        // Note: LLM APIs require every assistant `toolCall` to have a
        // matching tool-role response in `messages`. The synthetic
        // tool-role message below satisfies that contract.
        const callsToExecute: LLMToolCall[] = [];
        for (const tc of lastResult.toolCalls) {
          const toolRef = parseCanonicalToolName(tc.name);
          const args = this.toolExecutor.mergedArgsFor(tc);
          const prior = toolCallDeduplicator.check(toolRef, args, steps);
          if (!prior) {
            callsToExecute.push(tc);
            continue;
          }
          // If the prior result was successful but its tool message has been
          // trimmed out of the wire payload (serializer budget enforcement),
          // let the call through — the model can't "see that tool_result" if
          // it was trimmed, so skipping would cause an infinite re-read loop.
          if (!prior.wasError) {
            const priorStillVisible = modelContext.view.some(
              (m) =>
                m.role === 'tool' && (m as { toolCallId?: string }).toolCallId === prior.toolCallId,
            );
            if (!priorStillVisible) {
              callsToExecute.push(tc);
              continue;
            }
          }
          wrappedEmit({
            kind: 'phase_note',
            note: 'tool_skipped_dedup',
            params: {
              toolDomain: toolRef.domain,
              toolAction: toolRef.action,
              priorStep: prior.step,
              priorWasError: prior.wasError,
            },
          });
          wrappedEmit({
            kind: 'tool_call',
            toolCallId: tc.id,
            toolRef,
            args,
          });
          const duplicateResult = this.canonicalDedupResult(tc.name, prior.wasError);
          wrappedEmit.withRecovery(
            {
              kind: 'tool_result',
              toolCallId: tc.id,
              projection: this.tools.projectPublicCall(tc.name, args),
              status: 'skipped',
              durationMs: 0,
              skipped: true,
              synthetic: true,
            },
            { kind: 'tool_result', result: duplicateResult as CanonicalJsonValue },
          );
          modelContext.view.push({
            role: 'tool',
            content: safeStringify(duplicateResult),
            toolCallId: tc.id,
          });
        }

        // Delegate tool execution to ToolExecutor
        this.toolExecutor.opts.currentStep = steps;
        const { cancelled, dupMap, blocked } = await this.toolExecutor.executeToolCalls(
          callsToExecute,
          wrappedEmit,
          modelContext.view,
          () => this._cancelled || (options?.isAborted?.() ?? false),
          this.pendingResolvers,
          this.pendingQuestionResolvers,
        );

        if (blocked) return finishBlocked(blocked);

        if (cancelled) {
          wrappedEmit({
            kind: 'cancelled',
            reason: 'user',
            completedToolCalls: 0,
            pendingToolCalls: 0,
          });
          emitRunEnd({ kind: 'run_end', status: 'cancelled' });
          return { content: 'Cancelled.', toolCalls: [], finishReason: 'stop' };
        }

        // Phase G — register just-executed calls in the deduplicator so
        // a subsequent identical `(toolRef, args)` within `windowSteps`
        // is short-circuited.
        for (const tc of callsToExecute) {
          const toolRef = parseCanonicalToolName(tc.name);
          const args = this.toolExecutor.mergedArgsFor(tc);
          const resultMsg = this.latestToolResultMessage(modelContext.view, tc.id);
          const content = resultMsg?.content ?? '';
          const wasError = content.includes('"success":false');
          toolCallDeduplicator.register(toolRef, args, {
            toolCallId: tc.id,
            step: steps,
            wasError,
          });
        }

        // Phase B — record typed evidence for each tool call that just
        // completed. Pulls from the freshly-appended tool-result messages
        // (role=tool) since `executeToolCalls` wrote them in order.
        // Phase G — skipped-by-dedup calls never ran, so they can't
        // produce evidence; restrict to `callsToExecute`.
        this.recordEvidenceForStep(modelContext.view, callsToExecute);

        // Progress stall detection: if execution-intent and no successful
        // mutation for STALL_THRESHOLD consecutive steps, emit evidence.
        if (
          this.currentIntent.kind === 'execution' &&
          steps - this.lastMutationStep >= AgentOrchestrator.STALL_THRESHOLD &&
          this.lastMutationStep > 0
        ) {
          this.appendEvidence({
            kind: 'progress_stall',
            stepsSinceLastMutation: steps - this.lastMutationStep,
            at: Date.now(),
          });
        }

        // 2C: Update scratchpad after each tool execution batch.
        this.updateScratchpad(modelContext.view, callsToExecute);

        // Track the most recent `commander.askUser` resolution. The
        // askUser-continuation safety net in the next iteration uses this
        // to detect openers that end as "ask → answer → stop" with no
        // mutation.
        if (lastResult.toolCalls.some((tc) => tc.name === 'commander.askUser')) {
          this.lastAskUserAnsweredStep = steps;
        }

        // Push results for deduplicated tool calls
        for (const [dupId, firstId] of dupMap) {
          const firstResult = this.firstToolResultMessage(modelContext.view, firstId);
          if (firstResult) {
            modelContext.view.push({
              role: 'tool',
              content: firstResult.content,
              toolCallId: dupId,
            });
          }
        }
        this.transcriptIndex.sync(modelContext.view);

        // Mutation invalidation: when this step's tool calls include
        // mutations, drop stale entity-cache entries in the graph. Mirrors
        // the legacy ToolResultCache.processRound behaviour. snapshot.restore
        // wipes every tool-result because the entire state space may have
        // shifted. The persistent `invalidatedToolCallIds` watermark is
        // consulted by `rebuildGraphFromMessages` on subsequent iterations
        // so stale tool-results are not re-added from `messages` history.
        // The watermark keys on `toolCallId`, so fresh post-mutation reads
        // (different call-id, even if same toolKey/paramsHash) are NOT
        // suppressed.
        {
          const graph = this.contextGraph;
          // Tool calls execute in parallel within a turn, so a same-turn
          // read may run BEFORE a same-turn mutation completes. The
          // mutation watermark therefore must not exempt same-turn reads
          // — they could hold pre-mutation state. The one exception is
          // `snapshot.restore` itself: its own tool-result must remain
          // visible so the model sees the restore outcome.
          const snapshotRestoreCallIds = new Set<string>();
          for (const tc of callsToExecute) {
            if (tc.name === 'snapshot.restore') snapshotRestoreCallIds.add(tc.id);
          }
          const hasSnapshotRestore = snapshotRestoreCallIds.size > 0;
          if (hasSnapshotRestore) {
            graph.clearToolResults();
            for (const toolMessage of this.transcriptIndex.toolMessages()) {
              if (snapshotRestoreCallIds.has(toolMessage.toolCallId)) continue;
              const key = this.composeToolCallKey(toolMessage.msgIndex);
              if (key) this.snapshotPreRestoreToolCallKeys.add(key);
            }
            this.invalidatedToolCallKeys.clear();
          } else {
            const mutations: Array<{ toolName: string; args: Record<string, unknown> }> = [];
            for (const tc of callsToExecute) {
              const category = getToolCompactionCategory(tc.name);
              if (category !== 'mutation') continue;
              const args = (tc.arguments as Record<string, unknown>) ?? {};
              mutations.push({ toolName: tc.name, args });
            }
            graph.invalidateForMutations(mutations);
            this.recordMutationWatermarks(mutations);
          }
        }

        // Post-round message shrink: stub the content of historical get/list
        // tool-results that are either (a) fully covered by the graph's
        // entity-cache projection or (b) invalidated by snapshot.restore /
        // mutation. Mirrors the legacy `ToolResultCache.processRound` payload
        // rewrite — prevents unbounded `messages` growth in long sessions
        // without changing what the wire payload looks like (the serializer
        // already drops fully-cached / stubbed groups).
        modelContext.view = this.shrinkCoveredToolMessages(modelContext.view);

      }

    } catch (error) {
      if (error instanceof RunBudgetBlockedError) {
        return finishBlocked(error.blocker);
      }
      if (!terminalEmitted) {
        wrappedEmit({
          kind: 'public_progress',
          operationId: `model:${this._currentStep}`,
          status: 'failed',
        });
        emitRunEnd({ kind: 'run_end', status: 'failed' });
      }
      throw error;
    } finally {
      const resumePausedRun = this._resumePausedRun;
      this._resumePausedRun = undefined;
      resumePausedRun?.();
      this._runState = 'inactive';
      this.activeModelContext = null;
      this.activeEmit = null;
      this.activeResourceController = null;
      this.transcriptIndex.clear();
      this.contextGraph = null;
    }
  }

  private async completeWithRetry(
    messages: LLMMessage[],
    opts: NonNullable<Parameters<LLMAdapter['completeWithTools']>[1]>,
    wrappedEmit: StreamEmit,
    isAborted: () => boolean,
    maxRetries = 2,
  ): Promise<OrchestratorCompletion> {
    // PRD params: base 500ms, cap 8000ms, max 3 attempts → 2 retries beyond
    // the initial try. The caller-supplied `maxRetries` default matches, so
    // the signature stays compatible with existing callers.
    const BASE_MS = 500;
    const MAX_MS = 8000;
    let lastErr: unknown;
    for (let i = 0; i <= maxRetries; i++) {
      const resourceController = this.activeResourceController;
      if (!resourceController) throw new Error('Run resource controller is not active');
      const operationId = `model:${this._currentStep}:attempt:${i}`;
      const quote: ResourceQuote = {
        tokens: {
          knowledge: 'estimated',
          value: conservativeRequestTokenUpperBound(
            messages,
            opts.tools ?? [],
            Math.max(0, opts.maxTokens ?? 0),
          ),
          upperBound: true,
        },
        toolCalls: 0,
        costUsd: costQuoteFromAdapter(this.adapter.quoteCostUpperBound?.(messages, opts)),
      };
      const reservation = resourceController.reserve(operationId, 'model', quote);
      if (!reservation.accepted) throw new RunBudgetBlockedError(reservation.blocker);
      wrappedEmit(reservation.state);
      let operationSettled = false;

      // Install a fresh step-level controller each attempt so a cancel
      // from the prior attempt can't leak across the retry boundary.
      // Combined with the run-level signal so either aborts the fetch.
      this._currentStepController = new AbortController();
      const stepSignal = this._currentStepController.signal;
      const runSignal = opts?.signal;
      const remainingWallTimeMs = resourceController.remainingWallTimeMs();
      const wallController =
        remainingWallTimeMs === undefined ? undefined : new AbortController();
      const wallTimeout = wallController
        ? setTimeout(
            () => wallController.abort(),
            Math.max(1, Math.min(remainingWallTimeMs!, 2_147_483_647)),
          )
        : undefined;
      const signals = [stepSignal, ...(runSignal ? [runSignal] : []), ...(wallController ? [wallController.signal] : [])];
      const combined = signals.length === 1 ? signals[0]! : AbortSignal.any(signals);
      const stepOpts = { ...opts, signal: combined };
      try {
        const stream = await this.adapter.completeWithTools(messages, stepOpts);
        const result = await this.drainLLMStream(stream, wrappedEmit, isAborted);
        const settledState = resourceController.settle(
          operationId,
          'model',
          measurementFromUsage(quote, result.resourceUsage),
        );
        operationSettled = true;
        wrappedEmit(settledState);
        if (wallTimeout !== undefined) clearTimeout(wallTimeout);
        providerHealth.recordSuccess(this.adapter.id);
        return result;
      } catch (err) {
        if (wallTimeout !== undefined) clearTimeout(wallTimeout);
        if (err instanceof RunBudgetBlockedError) throw err;
        if (!operationSettled) {
          const settledState = resourceController.settle(
            operationId,
            'model',
            measurementFromUsage(quote),
          );
          operationSettled = true;
          wrappedEmit(settledState);
        }
        if (wallController?.signal.aborted && !this._cancelled && !isAborted()) {
          throw new RunBudgetBlockedError({
            kind: 'resource_budget',
            metric: 'wall_time',
            reason: 'exhausted',
          });
        }
        lastErr = err;
        // Step-cancel: a user-initiated step abort lands here as a
        // LucidError(CANCELLED). Treat it like a retryable transient so
        // the loop gets another shot with a fresh step controller.
        const isStepCancel =
          err instanceof LucidError && err.code === 'CANCELLED' && !this._cancelled;
        const isRetryable =
          isStepCancel ||
          (err instanceof LucidError &&
            (err.code === 'SERVICE_UNAVAILABLE' || err.code === 'RATE_LIMITED'));
        if (!isRetryable || i === maxRetries || isAborted()) {
          providerHealth.recordFailure(this.adapter.id);
          throw err;
        }
        // Exponential backoff with full jitter per AWS guidance:
        //   cap   = min(MAX_MS, BASE_MS * 2^i)
        //   delay = random(0, cap)
        // Full jitter avoids thundering-herd retries under shared rate limits.
        // Step-cancel retries don't backoff — the user asked to skip
        // the current step, so we fire the next attempt immediately.
        const cap = isStepCancel ? 0 : Math.min(MAX_MS, BASE_MS * Math.pow(2, i));
        const delay = cap === 0 ? 0 : Math.floor(Math.random() * cap);
        const attemptNum = i + 2; // human-facing: "attempt 2 of 3"
        const totalAttempts = maxRetries + 1;
        // Flag stall-triggered retries so the UI/telemetry can distinguish
        // them from generic transient failures. The adapter's
        // `withStallTimeout` puts `timeoutMs` in `details` when it throws.
        const errDetails =
          err instanceof LucidError && typeof err.details === 'object'
            ? (err.details as Record<string, unknown>)
            : {};
        const isStall = typeof errDetails.timeoutMs === 'number';
        const reason = isStepCancel
          ? 'step_cancel'
          : isStall
            ? 'stall'
            : err instanceof LucidError
              ? err.code
              : 'transient';
        wrappedEmit({
          kind: 'phase_note',
          note: 'llm_retry',
          params: {
            detail: `attempt ${attemptNum} of ${totalAttempts} after ${delay}ms (${reason})`,
            attempt: attemptNum,
            totalAttempts,
            delayMs: delay,
            reason,
            stall: isStall,
          },
        });
        if (delay > 0) await new Promise((r) => setTimeout(r, delay));
      }
    }
    providerHealth.recordFailure(this.adapter.id);
    throw lastErr;
  }

  /**
   * Fold an LLMStreamEvent async iterable into an OrchestratorCompletion while
   * forwarding each event to the renderer as its wire-schema counterpart.
   *
   * Mapping:
   *   reasoning_delta   → thinking_delta
   *   text_delta        → chunk (accumulated into content)
   *   tool_call_started → internal call assembly only
   *   tool_call_args_delta → tool_call_args_delta
   *   tool_call_complete → internal call assembly only; ToolExecutor owns
   *                        the guarded public tool_call emission
   *   usage             → (no wire emit; usage isn't on the commander stream yet)
   *   finished          → finishReason capture (no wire emit; `done` is sent
   *                       by the caller once the whole run ends)
   *
   * Tool call IDs are never remapped here — the graph serializer's reverse
   * map is applied by `destructResponse` after this returns.
   */
  private async drainLLMStream(
    stream: AsyncIterable<LLMStreamEvent>,
    wrappedEmit: StreamEmit,
    isAborted: () => boolean,
  ): Promise<OrchestratorCompletion> {
    let content = '';
    let reasoning = '';
    const toolCallsById = new Map<string, LLMToolCall>();
    const toolOrder: string[] = [];
    let finishReason: LLMFinishReason = 'stop';
    let resourceUsage: OrchestratorCompletion['resourceUsage'];

    // Stall detection lives inside each adapter (see `withStallTimeout`)
    // at byte-level granularity; the orchestrator just drains whatever
    // the adapter yields. If the socket is dead, the adapter throws a
    // SERVICE_UNAVAILABLE error which `completeWithRetry` treats as
    // retryable. `iterator.return()` is still called in `finally` so a
    // mid-drain abort propagates back into the producer.
    const iterator = stream[Symbol.asyncIterator]();
    try {
      while (true) {
        if (isAborted()) break;
        const next: IteratorResult<LLMStreamEvent> = await iterator.next();
        if (next.done) break;
        const event = next.value;
        switch (event.kind) {
          case 'reasoning_delta':
            reasoning += event.delta;
            break;
          case 'text_delta':
            content += event.delta;
            wrappedEmit({ kind: 'assistant_text', content: event.delta, isDelta: true });
            break;
          case 'tool_call_started':
            if (!toolCallsById.has(event.id)) {
              toolOrder.push(event.id);
              toolCallsById.set(event.id, { id: event.id, name: event.name, arguments: {} });
            }
            break;
          case 'tool_call_args_delta':
            // v2 has no partial-args event; defer emission until
            // `tool_call_complete` lands with the parsed object.
            break;
          case 'tool_call_complete': {
            const existing = toolCallsById.get(event.id);
            const resolvedName = event.name || existing?.name || '';
            if (existing) {
              existing.name = resolvedName || existing.name;
              existing.arguments = event.arguments;
              existing.thoughtSignature = event.thoughtSignature;
              existing.handledByProviderLoop = event.handledByProviderLoop;
            } else {
              toolOrder.push(event.id);
              toolCallsById.set(event.id, {
                id: event.id,
                name: resolvedName,
                arguments: event.arguments,
                thoughtSignature: event.thoughtSignature,
                handledByProviderLoop: event.handledByProviderLoop,
              });
            }
            break;
          }
          case 'usage':
            resourceUsage = {
              ...(event.promptTokens !== undefined ? { promptTokens: event.promptTokens } : {}),
              ...(event.completionTokens !== undefined
                ? { completionTokens: event.completionTokens }
                : {}),
              ...(event.reasoningTokens !== undefined
                ? { reasoningTokens: event.reasoningTokens }
                : {}),
            };
            break;
          case 'finished':
            finishReason = event.finishReason;
            break;
        }
      }
    } finally {
      // Ensure the producer sees cancellation even if we broke out early
      // (abort, downstream threw). Fire-and-forget: a pathologically
      // hung iterator (dead socket, stuck `await new Promise(()=>{})`)
      // would deadlock if we awaited return().
      iterator.return?.()?.catch(() => {
        /* swallow — cleanup only */
      });
    }

    return {
      content,
      reasoning: reasoning || undefined,
      toolCalls: toolOrder.map((id) => toolCallsById.get(id)!).filter(Boolean),
      finishReason,
      ...(resourceUsage ? { resourceUsage } : {}),
    };
  }

  /**
   * G2a-6: Rebuild the ContextGraph from the canonical `messages` array.
   *
   * Runs before every LLM call in graph-mode. This keeps the graph in lock-step
   * with any `messages` mutations (system-prompt refresh and authentic user
   * messages) without requiring each mutation
   * site to know about the graph.
   *
   * Tool-result identity:
   *   - Real tool calls executed this session have their args tracked via the
   *     TranscriptIndex, so `(toolKey, paramsHash)` is stable.
   *   - For seeded/historical tool messages without known args (e.g. rehydrated
   *     from a resumed session), the `toolCallId` is folded into `paramsHash`
   *     to give each message a unique identity (no accidental dedup).
   */
  private rebuildGraphFromMessages(messages: LLMMessage[], step: number): void {
    if (!this.contextGraph) return;
    this.transcriptIndex.rebuild(messages);
    this.contextGraph = new ContextGraph();
    for (let i = 0; i < messages.length; i++) {
      const m = messages[i]!;
      if (m.role === 'system') {
        // The FIRST system message is the top-level system prompt → guide.
        // Subsequent system messages restored from durable history are
        // position-sensitive runtime instructions
        // that must remain where they were inserted, so they ride as
        // `system-message` items which the serializer emits inline at their
        // original position.
        if (i === 0) {
          this.contextGraph.add({
            kind: 'guide',
            itemId: freshContextItemId(),
            producedAtStep: step,
            guideKey: 'system-root',
            content: m.content,
          } satisfies ContextItem);
        } else {
          this.contextGraph.add({
            kind: 'system-message',
            itemId: freshContextItemId(),
            producedAtStep: step,
            content: m.content,
          } satisfies ContextItem);
        }
      } else if (m.role === 'user') {
        this.contextGraph.add({
          kind: 'user-message',
          itemId: freshContextItemId(),
          producedAtStep: step,
          content: m.content,
        } satisfies ContextItem);
      } else if (m.role === 'assistant') {
        this.contextGraph.add({
          kind: 'assistant-turn',
          itemId: freshContextItemId(),
          producedAtStep: step,
          content: m.content,
          reasoning: m.reasoning,
          toolCalls: m.toolCalls?.map((tc) => ({
            id: tc.id,
            name: tc.name,
            arguments: tc.arguments,
            thoughtSignature: tc.thoughtSignature,
          })),
        } satisfies ContextItem);
      } else if (m.role === 'tool') {
        const indexedToolMessage = this.transcriptIndex.toolMessageAt(i);
        const toolKey = (indexedToolMessage?.toolName ?? 'unknown') as ToolKey;
        const paramsHash = indexedToolMessage?.paramsHash ?? m.toolCallId ?? `msg-${i}`;
        // Honor persistent invalidation watermarks. The composite key is
        // `callId|toolKey|paramsHash#occurrence` — the occurrence counter
        // disambiguates adapters that reuse fallback ids (`tool-call-0`)
        // across turns with identical args, so a later fresh read is not
        // suppressed by an earlier same-shape invalidation.
        const compositeKey = indexedToolMessage?.compositeKey;
        if (compositeKey && this.snapshotPreRestoreToolCallKeys.has(compositeKey)) continue;
        if (compositeKey && this.invalidatedToolCallKeys.has(compositeKey)) continue;
        let originStep = step;
        if (compositeKey) {
          const remembered = this.toolCallKeyToOriginStep.get(compositeKey);
          if (remembered !== undefined) {
            originStep = remembered;
          } else {
            this.toolCallKeyToOriginStep.set(compositeKey, step);
          }
        }
        this.contextGraph.add({
          kind: 'tool-result',
          itemId: freshContextItemId(),
          producedAtStep: originStep,
          toolKey,
          paramsHash,
          content: m.content,
          schemaVersion: 1,
          toolCallId: m.toolCallId,
        } satisfies ContextItem);
      }
    }
  }

  /**
   * Record `toolCallId`s of historical get/list results invalidated by a
   * mutation into the persistent watermark. Mirrors the domain/entity-
   * scoping rules applied to the in-memory graph so rebuilds skip those
   * exact pre-mutation tool-results.
   * Scoping:
   *   - Only touches get/list results whose tool domain matches the mutation.
   *   - When the mutation carries an entityId, only entity-specific gets
   *     that include that id in their paramsHash are invalidated; list
   *     results for the same domain are always dropped (they may be stale).
   * The transcript index gives every result a stable occurrence key, so
   * fallback ids reused by providers cannot invalidate a later fresh read.
   */
  private recordMutationWatermark(
    mutationToolName: string,
    mutationArgs: Record<string, unknown>,
  ): void {
    this.recordMutationWatermarks([{ toolName: mutationToolName, args: mutationArgs }]);
  }

  private recordMutationWatermarks(
    mutations: ReadonlyArray<{ toolName: string; args: Record<string, unknown> }>,
  ): void {
    const invalidations = new Map<string, { invalidateAll: boolean; entityIds: Set<string> }>();
    for (const mutation of mutations) {
      const domain = mutation.toolName.split('.')[0];
      if (!domain) continue;
      const existing = invalidations.get(domain) ?? {
        invalidateAll: false,
        entityIds: new Set<string>(),
      };
      const entityId = extractEntityIdFromArgs(mutation.args);
      if (entityId) existing.entityIds.add(entityId);
      else existing.invalidateAll = true;
      invalidations.set(domain, existing);
    }

    for (const [domain, invalidation] of invalidations) {
      const entityMatcher =
        invalidation.entityIds.size > 0
          ? new RegExp([...invalidation.entityIds].map(escapeRegExp).join('|'))
          : undefined;
      for (const toolMessage of this.transcriptIndex.toolMessagesForDomain(domain)) {
        const callName = toolMessage.toolName;
        if (!callName) continue;
        const category = getToolCompactionCategory(callName);
        if (category !== 'get' && category !== 'list') continue;
        if (
          !invalidation.invalidateAll &&
          category !== 'list' &&
          (!entityMatcher || !entityMatcher.test(toolMessage.paramsHash))
        ) {
          continue;
        }
        const key = this.composeToolCallKey(toolMessage.msgIndex);
        if (key) this.invalidatedToolCallKeys.add(key);
      }
    }
  }

  /**
   * Replace the content of historical get/list tool messages whose payloads
   * are redundant (covered by the graph's entity-cache projection OR
   * invalidated by mutation / snapshot.restore watermarks) with a compact
   * stub marker. The serializer already treats the stub content as a
   * cache-skip signal, so wire output is unchanged — this only shrinks the
   * in-memory `messages` array so long sessions don't pay linear scan cost
   * over megabytes of stale JSON every rebuild.
   *
   * The most recent tool message for a given (toolKey, paramsHash) pair is
   * preserved (never stubbed) so the model still has at least one copy of
   * the current payload available if the cache block is later truncated.
   */
  private shrinkCoveredToolMessages(messages: readonly LLMMessage[]): LLMMessage[] {
    const view = [...messages];
    if (!this.contextGraph) return view;
    const STUB = '{"_cached":true}';
    // Walk from newest → oldest so we can keep the FIRST encountered
    // (newest) instance per identity and stub older duplicates.
    const kept = new Set<string>();
    const indexedToolMessages = this.transcriptIndex.toolMessages();
    for (let index = indexedToolMessages.length - 1; index >= 0; index -= 1) {
      const toolMessage = indexedToolMessages[index]!;
      const m = messages[toolMessage.msgIndex]!;
      if (m.content === STUB) continue;
      const callName = toolMessage.toolName;
      if (!callName) continue;
      const paramsHash = toolMessage.paramsHash;
      const compositeKey = this.composeToolCallKey(toolMessage.msgIndex);
      const isInvalidated =
        compositeKey !== undefined &&
        (this.snapshotPreRestoreToolCallKeys.has(compositeKey) ||
          this.invalidatedToolCallKeys.has(compositeKey));
      const cat = getToolCompactionCategory(callName);
      if (cat !== 'get' && cat !== 'list') {
        if (isInvalidated) view[toolMessage.msgIndex] = { ...m, content: STUB };
        continue;
      }
      const identity = `${callName}|${paramsHash}`;
      if (isInvalidated) {
        view[toolMessage.msgIndex] = { ...m, content: STUB };
        continue;
      }
      const covered = this.contextGraph.hasToolResult(callName, paramsHash);
      if (!covered) continue;
      if (!kept.has(identity)) {
        kept.add(identity);
        continue;
      }
      view[toolMessage.msgIndex] = { ...m, content: STUB };
    }
    return view;
  }

  /**
   * Compose the composite watermark key (`callId|toolKey|paramsHash#n`) for
   * a tool message at the given index. The occurrence suffix is assigned by
   * TranscriptIndex during its single forward transcript scan.
   */
  private composeToolCallKey(messageIndex: number): string | undefined {
    return this.transcriptIndex.toolMessageAt(messageIndex)?.compositeKey;
  }

  // ──────────────────────────────────────────────────────────────────
  // Scratchpad (2C)
  // ──────────────────────────────────────────────────────────────────

  /**
   * Build the scratchpad content string from the structured Scratchpad.
   */
  private buildScratchpadContent(): string {
    return serializeScratchpad(this.scratchpad);
  }

  /**
   * Update the scratchpad after a tool execution batch. Extracts:
   * - Run checklist state from `runChecklist.manage` results
   * - Creative decisions from `commander.askUser` responses where user picked an option
   * - Failure traces from tool results with errors
   */
  private updateScratchpad(
    messages: readonly LLMMessage[],
    toolCalls: readonly LLMToolCall[],
  ): void {
    for (const tc of toolCalls) {
      const resultMsg = this.latestToolResultMessage(messages, tc.id);
      const content = resultMsg?.content ?? '';

      // Extract run checklist state from runChecklist.manage.
      if (tc.name === 'runChecklist.manage') {
        try {
          const parsed = JSON.parse(content) as { success?: boolean; data?: unknown };
          if (parsed.success !== false) {
            const args = tc.arguments as {
              items?: Array<{ text?: string; status?: string }>;
            } | null;
            if (Array.isArray(args?.items)) {
              this.scratchpad.checklist = args!.items
                .filter((item) => item.text)
                .map((item) => `${item.text}: ${item.status ?? 'pending'}`);
            }
          }
        } catch {
          /* ignore parse errors */
        }
        continue;
      }

      // Extract decisions from askUser responses.
      if (tc.name === 'commander.askUser') {
        if (content && !content.includes('"success":false')) {
          const args = tc.arguments as { question?: string } | null;
          const question =
            typeof args?.question === 'string' ? args.question.slice(0, 40) : 'choice';
          let answer: string;
          try {
            const parsed = JSON.parse(content) as { data?: { answer?: string } };
            answer =
              typeof parsed.data?.answer === 'string'
                ? parsed.data.answer.slice(0, 60)
                : content.slice(0, 60);
          } catch {
            answer = content.slice(0, 60);
          }
          this.scratchpad.decisions.push(`${question} -> ${answer}`);
        }
        continue;
      }

      // Extract failure traces.
      if (content.includes('"success":false')) {
        let errorText: string;
        try {
          const parsed = JSON.parse(content) as { error?: string };
          errorText =
            typeof parsed.error === 'string' ? parsed.error.slice(0, 60) : 'unknown error';
        } catch {
          errorText = 'parse error';
        }
        this.scratchpad.failures.push(`${tc.name}: ${errorText}`);
      }
    }

    // Update the context manager scratchpad and push into graph.
    const scratchpadContent = this.buildScratchpadContent();
    this.contextManager.setScratchpad(scratchpadContent || null);

    // Update the scratchpad item in the graph.
    if (this.contextGraph && scratchpadContent) {
      this.contextGraph.add({
        kind: 'scratchpad',
        itemId: freshContextItemId(),
        producedAtStep: this.toolExecutor.opts.currentStep ?? 0,
        content: scratchpadContent,
      } satisfies ContextItem);
    }
  }

  // ──────────────────────────────────────────────────────────────────
  // Phase B — Exit Contract shadow helpers
  // ──────────────────────────────────────────────────────────────────

  /**
   * Record typed evidence for the tool calls that completed in the
   * current step. We read tool results from the `messages` array (where
   * ToolExecutor wrote them) to distinguish `mutation_commit` from
   * `validation_error`.
   *
   * Also records:
   *  - `ask_user_asked` on commander.askUser calls (the answer is
   *    recorded later, at the top of the next iteration, when
   *    `lastAskUserAnsweredStep` flips)
   *  - `guide_loaded` on guide.get successful returns
   *  - `settings_write` on canvas.setSettings (canvas ref image / plate)
   *  - `generation_started` on the canonical canvas.generation path
   *
   * Each recorded evidence also gets a mirror `evidence_appended` stream
   * event so the harness and renderer see it in real time.
   */
  private recordEvidenceForStep(
    messages: readonly LLMMessage[],
    toolCalls: readonly LLMToolCall[],
  ): void {
    const now = Date.now();
    // Build an id→result-json map from the tail of `messages` (all
    // tool-role messages for this step were appended by ToolExecutor).
    const resultById = new Map<string, string>();
    for (let i = messages.length - 1; i >= 0 && i >= messages.length - toolCalls.length * 2; i--) {
      const m = messages[i];
      if (m.role !== 'tool' || !m.toolCallId) continue;
      resultById.set(m.toolCallId, m.content);
    }

    for (const tc of toolCalls) {
      if (tc.name === 'commander.askUser') {
        const rawArgs = tc.arguments as { question?: unknown } | null;
        const question = typeof rawArgs?.question === 'string' ? rawArgs.question : '';
        this.appendEvidence({ kind: 'ask_user_asked', question, at: now });
        continue;
      }

      const rawResult = resultById.get(tc.id) ?? '';
      let parsed: unknown;
      try {
        parsed = JSON.parse(rawResult);
      } catch {
        parsed = null;
      }
      const ok = this.isToolResultOk(parsed);
      const errorText = this.extractToolResultError(parsed);

      if (!ok) {
        this.appendEvidence({
          kind: 'validation_error',
          toolName: tc.name,
          errorText: errorText ?? 'Tool call failed',
          at: now,
        });
        if (!this.isReadOnlyTool(tc.name)) {
          this.appendEvidence({
            kind: 'mutation_commit',
            toolName: tc.name,
            args: tc.arguments,
            resultOk: false,
            at: now,
          });
        }
        const count = (this.toolValidationErrors.get(tc.name) ?? 0) + 1;
        this.toolValidationErrors.set(tc.name, count);
        if (count >= AgentOrchestrator.RETRY_LOOP_THRESHOLD) {
          this.appendEvidence({
            kind: 'tool_retry_loop',
            toolName: tc.name,
            attempts: count,
            at: now,
          });
        }
        continue;
      }

      // Non-meta successful calls are mutation candidates. We filter out
      // pure reads (tool.*, guide.*, canvas.getInfo, canvas.listNodes,
      // canvas.getNode, *.list) since those can't satisfy a contract.
      if (ok && !this.isReadOnlyTool(tc.name)) {
        this.appendEvidence({
          kind: 'mutation_commit',
          toolName: tc.name,
          args: tc.arguments,
          resultOk: true,
          at: now,
        });
        this.lastMutationStep = this._currentStep;
      }

      // Side-effects for specific tools — surface them as their own
      // evidence so contracts can write more expressive success signals
      // later.
      if (ok && tc.name === 'guide.get') {
        for (const guideId of this.extractGuideIds(parsed)) {
          this.appendEvidence({ kind: 'guide_loaded', guideId, at: now });
        }
      }
      if (ok && tc.name === 'canvas.setSettings') {
        const rawArgs = tc.arguments as { canvasId?: unknown; settings?: unknown } | null;
        const canvasId = typeof rawArgs?.canvasId === 'string' ? rawArgs.canvasId : '';
        const keys =
          rawArgs?.settings && typeof rawArgs.settings === 'object'
            ? Object.keys(rawArgs.settings as Record<string, unknown>)
            : [];
        this.appendEvidence({ kind: 'settings_write', canvasId, keys, at: now });
      }
      if (ok && tc.name === 'canvas.generation') {
        const rawArgs = tc.arguments as { nodeId?: unknown } | null;
        const nodeId = typeof rawArgs?.nodeId === 'string' ? rawArgs.nodeId : 'unknown';
        this.appendEvidence({ kind: 'generation_started', nodeId, at: now });
      }
    }

    // When the step resolved a `commander.askUser`, the previous step's
    // ask is now answered. Record the answer text from the tool result
    // (the answer string the user picked lives in the stringified JSON).
    if (this.lastAskUserAnsweredStep !== null) {
      // The answer was just written to `messages` by ToolExecutor. We
      // pull it out of the most recent tool-role message whose call
      // name was `commander.askUser`.
      this.transcriptIndex.sync(messages);
      const indexedToolMessages = this.transcriptIndex.toolMessages();
      for (let i = indexedToolMessages.length - 1; i >= 0; i--) {
        const indexed = indexedToolMessages[i];
        if (indexed.toolName !== 'commander.askUser') continue;
        const m = messages[indexed.msgIndex];
        if (m?.role !== 'tool') continue;
        this.appendEvidence({ kind: 'ask_user_answered', answer: m.content, at: now });
        break;
      }
    }
  }

  private appendEvidence(evidence: Parameters<EvidenceLedger['record']>[0]): void {
    this.evidenceLedger.record(evidence);
  }

  private computeExitDecision(): {
    decision: ExitDecision;
    intent: RunIntent;
  } {
    const contract = contractRegistry.select(this.currentIntent);
    const decision: ExitDecision = decide({
      contract,
      intent: this.currentIntent,
      ledger: this.evidenceLedger.entries(),
      lastAssistantText: this.lastAssistantText,
    });
    return { decision, intent: this.currentIntent };
  }

  private toTimelineExitDecisionMeta(decision: ExitDecision): TimelineExitDecisionMeta {
    return {
      outcome: decision.outcome,
      contractId: 'contractId' in decision ? decision.contractId : undefined,
      blocker: 'blocker' in decision && decision.blocker ? decision.blocker.kind : undefined,
    };
  }

  // Narrow tool-result-is-ok check. Our result shape is
  // `{ success: boolean, data? | error?, errorClass? }`. Anything else
  // (non-JSON, different shape) is treated as OK so read tools like
  // `canvas.getInfo` still count as success.
  private isToolResultOk(parsed: unknown): boolean {
    if (parsed === null || typeof parsed !== 'object') return true;
    const obj = parsed as { success?: unknown };
    if (typeof obj.success !== 'boolean') return true;
    return obj.success;
  }

  private extractToolResultError(parsed: unknown): string | null {
    if (parsed === null || typeof parsed !== 'object') return null;
    const obj = parsed as { success?: unknown; error?: unknown };
    if (obj.success !== false) return null;
    return typeof obj.error === 'string' ? obj.error : null;
  }

  private extractGuideIds(parsed: unknown): string[] {
    if (parsed === null || typeof parsed !== 'object') return [];
    const obj = parsed as { data?: unknown };
    const data = obj.data;
    const entries = Array.isArray(data)
      ? data
      : data && typeof data === 'object' && Array.isArray((data as { guides?: unknown }).guides)
        ? ((data as { guides: unknown[] }).guides ?? [])
        : data && typeof data === 'object'
          ? [data]
          : [];
    return [
      ...new Set(
        entries.flatMap((entry) => {
          if (!entry || typeof entry !== 'object') return [];
          const { id, content } = entry as { id?: unknown; content?: unknown };
          return typeof id === 'string' && id.trim().length > 0 && typeof content === 'string'
            ? [id]
            : [];
        }),
      ),
    ];
  }

  private isReadOnlyTool(name: string): boolean {
    if (name === 'tool.get' || name === 'tool.compact') return true;
    if (name === 'guide.get') return true;
    if (name === 'logger.list') return true;
    if (
      name.endsWith('.list') ||
      name.endsWith('.get') ||
      name.endsWith('.getNode') ||
      name.endsWith('.getState') ||
      name.endsWith('.listNodes') ||
      name.endsWith('.listEdges')
    ) {
      return true;
    }
    return false;
  }

  private latestToolResultMessage(
    messages: readonly LLMMessage[],
    toolCallId: string,
  ): LLMMessage | undefined {
    this.transcriptIndex.sync(messages);
    const index = this.transcriptIndex.latestToolMessageIndex(toolCallId);
    if (index === undefined) return undefined;
    const message = messages[index];
    return message?.role === 'tool' ? message : undefined;
  }

  private firstToolResultMessage(
    messages: readonly LLMMessage[],
    toolCallId: string,
  ): LLMMessage | undefined {
    this.transcriptIndex.sync(messages);
    const index = this.transcriptIndex.firstToolMessageIndex(toolCallId);
    if (index === undefined) return undefined;
    const message = messages[index];
    return message?.role === 'tool' ? message : undefined;
  }
}
