import type {
  LLMAdapter,
  LLMMessage,
  LLMStreamEvent,
  LLMToolCall,
  LLMFinishReason,
  ProviderProfile,
  TimelineExitDecisionMeta,
} from '@lucid-fin/contracts';
import { LucidError, DEFAULT_PROVIDER_PROFILE, parseCanonicalToolName } from '@lucid-fin/contracts';
import type { AgentToolRegistry } from './tool-registry.js';
import { getToolCompactionCategory } from '@lucid-fin/shared-utils';
import {
  type AgentContext,
  type HistoryEntry,
  type ToolSelectionInput,
  ALWAYS_LOADED_TOOLS,
  ESTIMATED_CHARS_PER_TOKEN,
  DEFAULT_IN_LOOP_CHAR_BUDGET,
  ContextManager,
  pruneHistory,
  measureMessageChars,
  compactNamedToolDefinitions,
  adaptiveToolCompaction,
  truncateOldToolResults,
  safeStringify,
  selectContextualToolSet,
} from './context-manager.js';
import { ToolExecutor } from './tool-executor.js';
import { ToolCallDeduplicator } from './tool-call-deduplicator.js';
import { detectOptionListMarkdown } from './detect-option-list-markdown.js';
import { TranscriptIndex } from './transcript-index.js';
import {
  detectProcess,
  getProcessCategoryName,
  type ProcessCategory,
} from './process-detection.js';
import { ToolCatalog } from './tool-catalog.js';
import { ContextGraph } from './graph/context-graph.js';
import { serializeForOpenAI } from './graph/serializers/openai.js';
import { freshContextItemId } from '@lucid-fin/contracts-parse';
import type { ContextItem, ToolKey, LLMToolDefinition } from '@lucid-fin/contracts';
import {
  type StampedStreamEvent,
  type StreamEmit,
  makeStampedEmit,
} from './stream-emit.js';
import { freshRunId } from './agent-run-id.js';
import {
  EvidenceLedger,
  classifyIntent,
  decide,
  contractRegistry,
  evaluateProcessPromptSpecs,
  createStylePlateLockSpec,
  createEntitiesBeforeGenerationSpec,
  createBatchCreateGuidanceSpec,
  createPromptQualityGateSpec,
  createStoryWorkflowPhaseSpec,
  type ExitDecision,
  type ProcessPromptSpec,
  type RunIntent,
} from './exit-contract/index.js';

// Re-export types so consumers don't break
export type { AgentContext, HistoryEntry };
export type { StampedStreamEvent, StreamEmit };

// v2 wire: stream events are TimelineEvents. Re-export for main-process
// handlers that plug directly into the orchestrator's emit surface.
export type AgentStreamEvent = StampedStreamEvent;

/**
 * Orchestrator-internal completion shape. Adapters no longer return this —
 * they expose an `AsyncIterable<LLMStreamEvent>` that the orchestrator folds
 * into this shape while also forwarding every delta to the renderer. Keeps
 * the rest of the agent loop (tool-call dispatch, dedup, finish detection)
 * unchanged.
 *
 * Phase F — terminal return values from `execute()` carry the ExitDecision
 * so callers can hard-enforce the contract outcome without re-reading the
 * stream. Intermediate loop iterations still use `OrchestratorCompletion`
 * without `exitDecision` (the decision is only meaningful at run end).
 */
interface OrchestratorCompletion {
  content: string;
  reasoning?: string;
  toolCalls: LLMToolCall[];
  finishReason: LLMFinishReason;
  exitDecision?: ExitDecision;
  exitIntent?: RunIntent;
}

export interface AgentOptions {
  maxSteps?: number;
  temperature?: number;
  maxTokens?: number;
  profile?: ProviderProfile;
  resolveProcessPrompt?: (processKey: ProcessCategory) => string | null;
  /**
   * Optional canvas node-type lookup used to dispatch `canvas.generate`
   * process-prompt injection by the real node type on the canvas, rather
   * than trusting the LLM's optional `nodeType` argument. When the LLM
   * omits `nodeType` and this resolver returns 'video' or 'audio', the
   * correct process category is primed instead of defaulting to
   * image-node-generation. Return `null` if the node cannot be resolved;
   * detection falls back to the LLM-provided arg.
   */
  resolveCanvasNodeType?: (
    canvasId: string,
    nodeId: string,
  ) => 'image' | 'video' | 'audio' | null;
  /**
   * Optional canvas settings lookup used to pre-flight `style-plate-lock`
   * when the model is about to invoke a generation tool on a canvas whose
   * `stylePlate` is empty. Side-effect free, synchronous. Returns `null` if
   * the canvas isn't found; returns `{ stylePlate: null }` (or empty string)
   * when the plate isn't locked yet. When omitted, the pre-flight path is
   * simply skipped — existing consumers keep their current behaviour.
   */
  resolveCanvasSettings?: (
    canvasId: string,
  ) => { stylePlate?: string | null } | null;
}

export interface AgentExecutionOptions {
  history?: HistoryEntry[];
  isAborted?: () => boolean;
  permissionMode?: 'auto' | 'normal' | 'strict';
  onLLMRequest?: (diagnostics: AgentLLMRequestDiagnostics) => void;
  /** Pre-seed tools into the active set (e.g. from a resumed session). */
  discoveredTools?: string[];
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

const HISTORY_CHAR_BUDGET_FALLBACK = Math.floor(200000 * ESTIMATED_CHARS_PER_TOKEN);

/**
 * Strip context-injected parameters from a tool schema. These parameters are
 * auto-supplied by the tool executor at runtime, so the LLM shouldn't see or
 * fill them — saves tokens and eliminates a class of "required field missing"
 * errors.
 */
function stripInjectedParamsFromTool(
  tool: LLMToolDefinition,
  params: string[],
): LLMToolDefinition {
  const props = tool.parameters.properties;
  const hasAny = params.some((p) => p in props);
  if (!hasAny) return tool;
  const newProps = { ...props };
  for (const p of params) delete newProps[p];
  const newRequired = tool.parameters.required?.filter((r) => !params.includes(r));
  return {
    ...tool,
    parameters: {
      ...tool.parameters,
      properties: newProps,
      required: newRequired?.length ? newRequired : undefined,
    },
  };
}

/**
 * Un-sanitize tool names and dedup tool call IDs in an LLM response.
 * Mirrors the previous `destructLLMResponse` helper; co-located here so the
 * graph serializer's reverse map feeds it directly.
 */
function destructResponse(
  raw: OrchestratorCompletion,
  reverseMap: ReadonlyMap<string, string>,
): OrchestratorCompletion {
  if (!raw.toolCalls || raw.toolCalls.length === 0) return raw;
  const seenIds = new Set<string>();
  const deduped: LLMToolCall[] = [];
  for (const tc of raw.toolCalls) {
    if (seenIds.has(tc.id)) continue;
    seenIds.add(tc.id);
    const name = reverseMap.size > 0 ? (reverseMap.get(tc.name) ?? tc.name) : tc.name;
    deduped.push({ ...tc, name });
  }
  return { ...raw, toolCalls: deduped };
}

function isProcessCategory(value: unknown): value is ProcessCategory {
  if (typeof value !== 'string') return false;
  // Catalog-derived: every distinct `process` declared via defineToolMeta
  // shows up as a key of `byProcess`. The meta bucket ('meta') exists there
  // too, but callers here only pass domain categories, so no extra filter
  // is needed.
  return value in ToolCatalog.byProcess && value !== 'meta';
}

/**
 * Free-standing process-prompt keys that are NOT tool-derived categories but
 * still flow through the same injection/stripping machinery. These come from
 * `processPromptSpecs` — each spec registered below contributes its `key` to
 * the standalone set via `buildStandaloneSpecKeys()`. Phase C ships one
 * standalone spec (`style-plate-lock`); new specs can be added to the spec
 * list without touching this constant.
 */
type ProcessPromptKey = ProcessCategory | 'style-plate-lock' | 'entities-before-generation' | 'batch-create-guidance' | 'prompt-quality-gate' | 'story-workflow-phase';

const STANDALONE_SPEC_KEYS: ReadonlySet<Exclude<ProcessPromptKey, ProcessCategory>> =
  new Set(['style-plate-lock', 'entities-before-generation', 'batch-create-guidance', 'prompt-quality-gate', 'story-workflow-phase']);

function isProcessPromptKey(value: unknown): value is ProcessPromptKey {
  if (typeof value !== 'string') return false;
  if (isProcessCategory(value)) return true;
  return (STANDALONE_SPEC_KEYS as ReadonlySet<string>).has(value);
}

/**
 * Display name used in UI banners and stream `thinking_delta` text. Tool-
 * derived categories resolve via `getProcessCategoryName`; standalone spec
 * keys look up the ProcessPromptSpec list injected on the orchestrator.
 */
function getStandaloneDisplayName(
  key: Exclude<ProcessPromptKey, ProcessCategory>,
  specs: ReadonlyArray<ProcessPromptSpec>,
): string {
  return specs.find((s) => s.key === key)?.displayName ?? key;
}

/**
 * `isGenerationTool` is now owned by `exit-contract/specs/style-plate-lock.ts`
 * and consumed via the spec's activation predicate. Keeping the function
 * out of this file means a future "characters-required" or similar spec can
 * ship without touching the orchestrator.
 */

export class AgentOrchestrator {
  private adapter: LLMAdapter;
  private tools: AgentToolRegistry;
  private maxSteps: number;
  private temperature: number;
  private maxTokens: number;
  private profile: ProviderProfile;
  private pendingResolvers = new Map<string, (approved: boolean) => void>();
  private pendingQuestionResolvers = new Map<string, (answer: string) => void>();
  private activeMessages: LLMMessage[] | null = null;
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

  private injectedMessageCount = 0;
  private readonly resolveProcessPrompt?: (processKey: ProcessCategory) => string | null;
  private readonly resolveCanvasNodeType?: (
    canvasId: string,
    nodeId: string,
  ) => 'image' | 'video' | 'audio' | null;
  private readonly resolveCanvasSettings?: (
    canvasId: string,
  ) => { stylePlate?: string | null } | null;
  private activeProcessPromptSteps = new Map<ProcessPromptKey, number>();
  /**
   * Declarative process-prompt specs evaluated each turn. Seeded in the
   * constructor. Adding a new spec is "append to this list" — no other
   * orchestrator code needs to change.
   */
  private readonly processPromptSpecs: ReadonlyArray<ProcessPromptSpec>;

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
  private currentIntent: RunIntent = { kind: 'mixed' };
  private lastAssistantText = '';

  // ── Scratchpad (2C) ────────────────────────────────────────────
  /** Accumulated scratchpad sections. Updated after each tool batch. */
  private scratchpadTodos: string[] = [];
  private scratchpadDecisions: string[] = [];
  private scratchpadFailures: string[] = [];
  private static readonly SCRATCHPAD_MAX_CHARS = 500;

  /**
   * G2-5: graph-only items carried across sessions via SessionRepository.
   * The active `contextGraph` is rebuilt from messages every step, so
   * items that are NOT derivable from messages (`entity-snapshot`,
   * `session-summary`, and superseded `tool-result` items already
   * compacted out of history) are preserved here and re-merged into the
   * freshly rebuilt graph each step. Empty until `seedContextGraph` runs.
   */
  private pendingGraphSeed: ContextItem[] = [];
  /** Snapshot of the last execute() graph for `getSerializedContextGraph`. */
  private lastSerializedGraph: ContextItem[] = [];

  constructor(
    adapter: LLMAdapter,
    tools: AgentToolRegistry,
    resolvePrompt: (code: string) => string,
    opts?: AgentOptions,
  ) {
    this.adapter = adapter;
    this.tools = tools;
    this.maxSteps = opts?.maxSteps ?? 50;
    this.temperature = opts?.temperature ?? 0.7;
    this.maxTokens = opts?.maxTokens ?? 200000;
    this.profile = opts?.profile ?? DEFAULT_PROVIDER_PROFILE;
    this.resolveProcessPrompt = opts?.resolveProcessPrompt;
    this.resolveCanvasNodeType = opts?.resolveCanvasNodeType;
    this.resolveCanvasSettings = opts?.resolveCanvasSettings;

    // Phase C: declarative process-prompt specs. Style-plate-lock is the
    // only standalone spec so far; adding new specs here (or — Phase F —
    // via a public registry) is all that's required to wire a new gate.
    // The spec captures `resolveProcessPrompt` by closure so the predicate
    // can emit a non-empty content body; if the host didn't provide one,
    // the spec returns '' and `evaluateProcessPromptSpecs` filters it out.
    this.processPromptSpecs = [
      createStylePlateLockSpec({
        resolvePromptText: (key) => {
          if (!this.resolveProcessPrompt) return null;
          // resolveProcessPrompt is typed against ProcessCategory, but its
          // IPC implementation keys by free-form string (see router.ts).
          // Cast is safe for standalone keys whose presence in the store
          // is asserted by STANDALONE_SPEC_KEYS.
          return this.resolveProcessPrompt(key as unknown as ProcessCategory);
        },
      }),
      createEntitiesBeforeGenerationSpec({
        resolvePromptText: (key) => {
          if (!this.resolveProcessPrompt) return null;
          return this.resolveProcessPrompt(key as unknown as ProcessCategory);
        },
      }),
      createBatchCreateGuidanceSpec({
        resolvePromptText: (key) => {
          if (!this.resolveProcessPrompt) return null;
          return this.resolveProcessPrompt(key as unknown as ProcessCategory);
        },
      }),
      createPromptQualityGateSpec({
        resolvePromptText: (key) => {
          if (!this.resolveProcessPrompt) return null;
          return this.resolveProcessPrompt(key as unknown as ProcessCategory);
        },
      }),
      createStoryWorkflowPhaseSpec({
        resolvePromptText: (key) => {
          if (!this.resolveProcessPrompt) return null;
          return this.resolveProcessPrompt(key as unknown as ProcessCategory);
        },
      }),
    ];

    this.contextManager = new ContextManager(adapter, resolvePrompt);
    this.toolExecutor = new ToolExecutor(tools);
    this.transcriptIndex = new TranscriptIndex();
  }

  /** Resolve a pending tool confirmation. Called from outside (IPC handler). */
  confirmTool(toolCallId: string, approved: boolean): void {
    const resolver = this.pendingResolvers.get(toolCallId);
    if (resolver) {
      this.pendingResolvers.delete(toolCallId);
      resolver(approved);
    }
  }

  /** Resolve a pending user question. Called from outside (IPC handler). */
  answerQuestion(toolCallId: string, answer: string): void {
    const resolver = this.pendingQuestionResolvers.get(toolCallId);
    if (resolver) {
      this.pendingQuestionResolvers.delete(toolCallId);
      resolver(answer);
    }
  }

  /**
   * G2-5: seed the orchestrator with a persisted ContextGraph before
   * `execute()` runs. Call this on session resume with the items returned
   * by `SessionRepository.getContextGraph(sessionId)`. Items are merged
   * into the freshly rebuilt graph each step (only kinds that aren't
   * derivable from the messages array survive the merge — see
   * `rebuildGraphFromMessages`).
   *
   * Safe to call with an empty array (no-op) or before the first
   * `execute()` (stored until the next run begins).
   */
  seedContextGraph(items: readonly ContextItem[]): void {
    this.pendingGraphSeed = [...items];
  }

  /**
   * G2-5: return the most-recently-serialized ContextGraph from the last
   * `execute()` call. Callers persist this via
   * `SessionRepository.saveContextGraph(sessionId, items)`.
   *
   * Returns an empty array if `execute()` has not been run yet.
   */
  getSerializedContextGraph(): ContextItem[] {
    return this.lastSerializedGraph;
  }

  /** Cancel the running agent. Resolves all pending promises so the loop unblocks. */
  cancel(): void {
    this._cancelled = true;
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

  /**
   * Trigger context compaction from outside (e.g. tool.compact, UI button).
   */
  async compactNow(instructions?: string): Promise<{ freedChars: number; messageCount: number; toolCount: number }> {
    return this.contextManager.compactNow(this.activeMessages, instructions);
  }

  injectMessage(content: string): void {
    const trimmed = content.trim();
    if (!trimmed || !this.activeMessages) return;
    this.activeMessages.push({ role: 'user', content: trimmed });
    this.injectedMessageCount++;
  }

  async execute(
    userMessage: string,
    context: AgentContext,
    emit: (event: StampedStreamEvent) => void,
    options?: AgentExecutionOptions,
  ): Promise<OrchestratorCompletion> {
    const loadedToolNames = new Set<string>(ALWAYS_LOADED_TOOLS);
    const discoveredToolNames = new Set<string>(options?.discoveredTools ?? []);
    let systemPrompt = this.contextManager.buildSystemPrompt(context, 1);

    // Compute context budget from adapter's context window.
    const effectiveCtx = this.adapter.effectiveContextWindow;
    const detectedCtx = this.adapter.contextWindow;
    const userCtx = this.adapter.userContextWindow;

    const historyCharBudget = effectiveCtx
      ? effectiveCtx * ESTIMATED_CHARS_PER_TOKEN
      : HISTORY_CHAR_BUDGET_FALLBACK;
    const history = pruneHistory(options?.history, historyCharBudget);

    // 95% utilization ceiling (or provider-specific)
    const maxUtil = this.profile.maxUtilization ?? 0.95;
    const inLoopTokenBudget = effectiveCtx
      ? Math.floor(effectiveCtx * maxUtil)
      : Math.floor(DEFAULT_IN_LOOP_CHAR_BUDGET / ESTIMATED_CHARS_PER_TOKEN);
    const inLoopCharBudget = inLoopTokenBudget * ESTIMATED_CHARS_PER_TOKEN;

    const messages: LLMMessage[] = [
      { role: 'system', content: systemPrompt },
      ...history.map((entry): LLMMessage => {
        if (entry.role === 'tool') {
          return { role: 'tool', content: entry.content, toolCallId: entry.toolCallId };
        }
        const msg: LLMMessage = { role: entry.role, content: entry.content };
        if (entry.role === 'assistant' && Array.isArray(entry.toolCalls) && entry.toolCalls.length > 0) {
          msg.toolCalls = entry.toolCalls.map((tc) => ({ id: tc.id, name: tc.name, arguments: tc.arguments }));
        }
        return msg;
      }),
      { role: 'user', content: userMessage },
    ];

    let steps = 0;
    let lastResult: OrchestratorCompletion = { content: '', toolCalls: [], finishReason: 'stop' };
    const toolLastUsedStep = new Map<string, number>();
    for (const name of ALWAYS_LOADED_TOOLS) {
      toolLastUsedStep.set(name, 0);
    }

    const runId = freshRunId();
    // `steps` is captured by closure so every emit reads the current step.
    // This stamped wrapper is the only emit surface used — raw `emit` is
    // intentionally never touched directly after this point.
    const wrappedEmit: StreamEmit = makeStampedEmit(runId, () => steps, emit);

    // Phase G — per-run tool-call deduplicator. Fresh instance per
    // `execute()` so dedup state can't leak across runs.
    const toolCallDeduplicator = new ToolCallDeduplicator();

    // Phase I — when the model emits an option-list markdown instead of
    // calling `commander.askUser`, we set this flag so the *next* adapter
    // call uses `tool_choice: commander.askUser` (forcing the structured
    // path). Reset after the forced call completes.
    let forceAskUserNextTurn = false;

    // Phase B: emit `run_start` bracket so the renderer can group events
    // into a per-run card (Phase D). The intent is the raw user message —
    // renderer crops / formats for display.
    wrappedEmit({ kind: 'run_start', intent: userMessage });

    if (userCtx && detectedCtx && userCtx < detectedCtx) {
      wrappedEmit({
        kind: 'assistant_text',
        content: `[Note: Your configured context window (${userCtx.toLocaleString()} tokens) is smaller than the model's actual context (${detectedCtx.toLocaleString()} tokens). Using your configured value.]\n`,
        isDelta: true,
      });
    }

    this.activeProcessPromptSteps.clear();
    this.lastAskUserAnsweredStep = null;

    // 2C: Reset scratchpad state for new run.
    this.scratchpadTodos = [];
    this.scratchpadDecisions = [];
    this.scratchpadFailures = [];
    this.contextManager.setScratchpad(null);

    // Phase B — reset exit-contract shadow state and classify intent
    // once at the start of the run.
    this.evidenceLedger = new EvidenceLedger();
    this.currentIntent = classifyIntent({
      userMessage,
      canvasHasNodes: Array.isArray((context.extra as { canvasNodes?: unknown[] } | undefined)?.canvasNodes)
        ? ((context.extra as { canvasNodes?: unknown[] }).canvasNodes!.length > 0)
        : undefined,
    });
    this.lastAssistantText = '';

    // 1H: Surface classified intent to the LLM via the system prompt's
    // dynamic context section so the model can calibrate its behavior.
    const intentWorkflow = 'workflow' in this.currentIntent ? this.currentIntent.workflow : undefined;
    const intentStr = intentWorkflow
      ? `${this.currentIntent.kind} (workflow: ${intentWorkflow})`
      : this.currentIntent.kind;
    if (!context.extra) context.extra = {};
    (context.extra as Record<string, unknown>).classifiedIntent = intentStr;

    // 1B: Context-aware tool set selection — load only tools relevant to
    // the current workspace state and user intent instead of all registered
    // tools. Non-selected tools are still discoverable via `tool.get` and
    // show up as name-only stubs in the adaptive-compaction tier-0 path.
    {
      const extra = context.extra as Record<string, unknown>;
      const nodeCount = typeof extra.nodeCount === 'number' ? extra.nodeCount : 0;

      // Parse entity count from the workspace snapshot when available, or
      // fallback to zero. The snapshot follows a fixed "Characters (N/M):"
      // / "Locations (...)" / "Equipment (...)" format — see
      // `buildWorkspaceSnapshot` in commander.handlers.ts.
      let entityCount = 0;
      if (typeof extra.workspaceSnapshot === 'string') {
        const snap = extra.workspaceSnapshot;
        const charMatch = /Characters \((\d+)\/(\d+)\)/.exec(snap);
        const locMatch = /Locations \((\d+)\/(\d+)\)/.exec(snap);
        const equipMatch = /Equipment \((\d+)\/(\d+)\)/.exec(snap);
        entityCount =
          (charMatch ? Number(charMatch[2]) : 0) +
          (locMatch ? Number(locMatch[2]) : 0) +
          (equipMatch ? Number(equipMatch[2]) : 0);
      }

      const selectedNodeIds = Array.isArray(extra.selectedNodeIds)
        ? extra.selectedNodeIds
        : [];

      // Style plate — check the snapshot text. A line "Style plate: NOT SET"
      // means no plate; anything else means one exists.
      let hasStylePlate = false;
      if (typeof extra.workspaceSnapshot === 'string') {
        const snap = extra.workspaceSnapshot;
        const plateLineMatch = /Style plate: (.+)/.exec(snap);
        if (plateLineMatch && plateLineMatch[1] !== 'NOT SET') {
          hasStylePlate = true;
        }
      }

      const selectionInput: ToolSelectionInput = {
        nodeCount,
        entityCount,
        hasStylePlate,
        hasSelectedNodes: selectedNodeIds.length > 0,
        userMessage,
        intentKind: this.currentIntent.kind,
        intentWorkflow,
      };
      const contextualTools = selectContextualToolSet(selectionInput);
      for (const name of contextualTools) {
        loadedToolNames.add(name);
        // Seed in toolLastUsedStep so adaptive compaction treats these as
        // "recently used" during the first few steps rather than stripping
        // them immediately.
        toolLastUsedStep.set(name, 0);
      }
    }

    this.activateInitialProcessPrompts(messages, context);
    this.activeMessages = messages;

    // Compact history on load
    truncateOldToolResults(messages);
    this.injectedMessageCount = 0;
    this._cancelled = false;
    this._abortController = new AbortController();
    this._currentStepController = null;
    this._lastStepAbortAt = 0;

    this.transcriptIndex = new TranscriptIndex();

    const canvasId = typeof context.extra?.canvasId === 'string' ? context.extra.canvasId : undefined;

    // Pre-populate transcript index from history messages
    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      if (msg.role === 'assistant' && msg.toolCalls?.length) {
        this.transcriptIndex.registerAssistantToolCalls(i, msg.toolCalls);
      }
    }

    // ── G2a-6: Initialize ContextGraph ───────────────────────────────────
    // The graph is rebuilt each step from the canonical `messages` array
    // immediately before serialization. This keeps the graph in sync with
    // mid-loop mutations (system prompt refresh, injected process prompts,
    // batch warnings, new user messages) without tracking them twice.
    // `serializeForOpenAI` produces the unified `LLMMessage[]` wire format
    // that every adapter consumes. Adapter-specific wire conversion
    // (e.g. Claude's content blocks) happens inside each adapter.
    this.contextGraph = new ContextGraph();
    this.invalidatedToolCallKeys = new Set<string>();
    this.snapshotPreRestoreToolCallKeys = new Set<string>();
    this.toolCallKeyToOriginStep = new Map<string, number>();

    // Create tool executor with graph reference (read-through cache comes
    // from the graph's tool-result index; mutation invalidation is driven
    // by the graph below).
    this.toolExecutor = new ToolExecutor(this.tools, {
      permissionMode: options?.permissionMode,
      contextGraph: this.contextGraph,
      canvasId,
      // `tool.get` responses already carry the process guide inline (see
      // meta-tools `attachProcessGuide`). That inline payload is an
      // immediate hint the model sees at discovery time, but it is NOT a
      // substitute for the system-message injection: the tool-result can
      // be compacted, dropped, or re-written on long sessions, and even
      // within the same run the model frequently skips discovery and
      // jumps straight to the action tool. We therefore do NOT mark the
      // category as primed on inline discovery — the pre-flight defer
      // (`primeProcessPromptsForToolCalls`) still runs when the model
      // calls the actual process tool, and the system message goes in
      // unconditionally (dedup is handled by `isProcessPromptMessage`
      // scanning `messages[]`, so no double-injection risk).
      //
      // This was the root cause of "process prompt never injected when
      // the tool is called": a prior `tool.get` suppressed the backstop
      // even when the guide was no longer in context.
    });

    try {
      while (steps < this.maxSteps) {
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
          wrappedEmit({ kind: 'run_end', status: 'cancelled' });
          return { content: 'Cancelled.', toolCalls: [], finishReason: 'stop' };
        }

        steps++;
        this.stripInactiveProcessPrompts(messages, steps);

        // 1I: Consolidate process-prompt system messages into the system
        // prompt before rebuilding. This reduces message count and makes
        // compaction behavior predictable.
        const activeProcessPromptData = this.consolidateProcessPrompts(messages);

        // Rebuild system prompt with step-aware abbreviation (saves tokens after step 5)
        // and consolidated process prompts as a structured section.
        if (steps > 1) {
          systemPrompt = this.contextManager.buildSystemPrompt(context, steps, activeProcessPromptData);
          if (messages.length > 0 && messages[0].role === 'system') {
            messages[0] = { ...messages[0], content: systemPrompt };
          }
        } else if (activeProcessPromptData.length > 0) {
          // Step 1: initial system prompt was already built, but process
          // prompts may have been injected by activateInitialProcessPrompts.
          // Rebuild to include them as a section.
          systemPrompt = this.contextManager.buildSystemPrompt(context, steps, activeProcessPromptData);
          if (messages.length > 0 && messages[0].role === 'system') {
            messages[0] = { ...messages[0], content: systemPrompt };
          }
        }

        // Predictive pre-compaction based on utilization ratio from previous step
        // (first step still uses the old totalChars > budget check)
        if (steps === 1) {
          await this.contextManager.compactWithLLM(messages, inLoopCharBudget);
        }

        // Merge tool sets
        const activeToolNames = new Set(loadedToolNames);
        for (const name of discoveredToolNames) activeToolNames.add(name);

        let availableTools = compactNamedToolDefinitions(this.tools, Array.from(activeToolNames), context.page);

        // Adaptive tool compaction
        const messageChars = measureMessageChars(messages);
        const { tools: compactedTools, evictedNames } = adaptiveToolCompaction(
          availableTools, toolLastUsedStep, steps, messageChars, inLoopCharBudget,
        );
        availableTools = compactedTools;
        for (const evicted of evictedNames) discoveredToolNames.delete(evicted);

        // Build wire payload via ContextGraph serializer.
        // The graph is rebuilt from the canonical `messages` array each step
        // (covers system-prompt refresh, injected process prompts, batch
        // warnings, new user messages). Serialization handles budget
        // enforcement, tool-name sanitization, stub/cache skipping, and
        // dangling-tool/pairing guards.
        const injectedParams: string[] = [];
        if (canvasId) injectedParams.push('canvasId');

        this.rebuildGraphFromMessages(messages, steps);
        // After rebuild, `this.contextGraph` is a NEW instance — keep the
        // tool-executor's read-through cache pointed at it. Without this
        // re-binding, the executor would hold a stale graph and miss every
        // post-rebuild cache entry.
        if (this.contextGraph) {
          this.toolExecutor.opts.contextGraph = this.contextGraph;
        }
        const graphToolsInput = injectedParams.length > 0
          ? availableTools.map((t) => stripInjectedParamsFromTool(t, injectedParams))
          : availableTools;
        if (!this.contextGraph) {
          throw new Error('ContextGraph missing — execute() was not initialized correctly.');
        }
        const {
          wireMessages,
          wireTools,
          toolNameReverseMap: graphReverseMap,
          estimatedTokensUsed,
        } = serializeForOpenAI({
          graph: this.contextGraph,
          contextWindowTokens: effectiveCtx ?? 200000,
          tools: graphToolsInput,
          profile: this.profile,
        });

        const ctxWindow = effectiveCtx ?? 200000;
        // History-trim approximation: how many source messages didn't make it
        // into the wire window. Loses the exact "old-trim vs orphan-drop"
        // distinction the legacy constructor tracked, but preserves the same
        // "are we losing history?" diagnostic signal.
        const historyMessagesTrimmed = Math.max(0, messages.length - wireMessages.length);

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
          messageChars: measureMessageChars(messages),
          systemPromptChars: systemPrompt.length,
          promptGuideChars: typeof context.extra?.promptGuides === 'string' ? context.extra.promptGuides.length : 0,
          estimatedTokensUsed: estimatedTokensUsed,
          contextWindowTokens: ctxWindow,
          cacheChars: entityCacheBlock.length,
          cacheEntryCount: graphToolResultCount,
          historyMessagesTrimmed,
          utilizationRatio: ctxWindow > 0 ? estimatedTokensUsed / ctxWindow : 0,
        });

        // Clear previous thinking before new LLM call — sends an empty
        // `thinking` delta so the renderer can reset its thinking buffer
        // at the start of a fresh step.
        wrappedEmit({ kind: 'thinking', content: '', isDelta: true });

        const rawResult = await this.completeWithRetry(
          wireMessages,
          {
            tools: wireTools.length > 0 ? wireTools : undefined,
            toolChoice: wireTools.length > 0
              ? (forceAskUserNextTurn
                  ? { name: 'commander.askUser' }
                  : 'auto')
              : undefined,
            temperature: this.temperature,
            maxTokens: this.maxTokens,
            signal: this._abortController?.signal,
          },
          wrappedEmit,
          () => this._cancelled || (options?.isAborted?.() ?? false),
        );

        // Un-sanitize tool names and dedup tool call IDs using the graph
        // serializer's reverse map.
        lastResult = destructResponse(rawResult, graphReverseMap);

        // Phase I — force_ask_user was consumed this turn (whether or not
        // the model complied). Clear the flag so we don't keep forcing
        // forever.
        forceAskUserNextTurn = false;

        // Phase I — if the model emitted option-list markdown without
        // calling `commander.askUser`, schedule a forced `tool_choice:
        // commander.askUser` on the next turn and inject a system-reminder
        // so the model knows why it's being redirected. This fixes S10
        // (model lists A/B/C in prose rather than asking structurally).
        const hasAskUserCall = lastResult.toolCalls.some(
          (tc) =>
            parseCanonicalToolName(tc.name).domain === 'commander' &&
            parseCanonicalToolName(tc.name).action === 'askUser',
        );
        if (
          !hasAskUserCall &&
          detectOptionListMarkdown(lastResult.content ?? '')
        ) {
          forceAskUserNextTurn = true;
          wrappedEmit({
            kind: 'phase_note',
            note: 'force_ask_user',
            params: { detectedPattern: 'option_list' },
          });
          messages.push({
            role: 'system',
            content:
              'Your previous response listed options as markdown (A/B/C or 1/2/3). ' +
              'You MUST call `commander.askUser` with `options` to present these choices. ' +
              'Do not list options in prose.',
          });
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
          const finalContent = lastResult.content || (lastResult.toolCalls.length === 0 && steps > 1 ? 'Task completed.' : '');
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
          wrappedEmit({
            kind: 'run_end',
            status: 'completed',
            exitDecision: this.toTimelineExitDecisionMeta(decision),
          });
          // Phase F — the ExitDecision is the authoritative outcome. Callers
          // that want to hard-enforce (e.g. harness, E2E tests, UI banners
          // on retry flows) read it here instead of re-parsing the stream.
          return { ...lastResult, exitDecision: decision, exitIntent: intent };
        }

        // Pre-flight process-prompt injection.
        // If any of the model's requested tool calls maps to a process
        // category we have not yet primed this session, inject the guide
        // as a system message and loop — the model gets to re-plan with
        // the guide visible BEFORE we execute anything. Costs one extra
        // model step per first-use of a category, bounded by the number
        // of distinct process categories.
        //
        // We detect on the tool call itself (not on user message text),
        // so this works in any language and across any tool the catalog
        // knows about. The same `detectProcess` map drives runtime
        // activation below, so there is a single source of truth.
        //
        // style-plate-lock is a canvas-state-dependent gate that is NOT
        // tool-process-derived — it fires when the model is about to run
        // a generation tool on a canvas whose stylePlate is empty.
        // Injected ahead of the regular preflight so both can defer in
        // the same turn.
        const primedSpecKeys = this.primeProcessPromptSpecs(
          messages,
          lastResult.toolCalls,
          canvasId,
          steps,
          wrappedEmit,
        );
        const deferredCategories = this.primeProcessPromptsForToolCalls(
          messages,
          lastResult.toolCalls,
          steps,
        );
        const deferredLabels: string[] = [
          ...primedSpecKeys.map((key) =>
            getStandaloneDisplayName(key, this.processPromptSpecs),
          ),
          ...deferredCategories.map((key) => getProcessCategoryName(key)),
        ];
        if (deferredLabels.length > 0) {
          // The assistant turn gets dropped — we haven't pushed it yet,
          // so next iteration the model re-plans with the guide in
          // context and produces a fresh tool_calls set.
          //
          // The UI already received `tool_call` events for every call in
          // this turn (emitted live from the LLM stream). Close those
          // cards with a synthetic `tool_result` so they don't hang on
          // the spinner forever. Renderer localizes the error code via
          // `commander.errorCode.RUN_ENDED_BEFORE_RESULT`.
          for (const tc of lastResult.toolCalls) {
            wrappedEmit({
              kind: 'tool_result',
              toolCallId: tc.id,
              error: {
                code: 'RUN_ENDED_BEFORE_RESULT',
                params: {},
              },
              durationMs: 0,
            });
          }
          continue;
        }

        messages.push({
          role: 'assistant',
          content: lastResult.content,
          toolCalls: lastResult.toolCalls,
        });

        this.activateProcessPrompts(messages, lastResult.toolCalls, steps);

        // Register tool calls in transcript index (O(1) lookups later)
        this.transcriptIndex.registerAssistantToolCalls(messages.length - 1, lastResult.toolCalls);

        for (const tc of lastResult.toolCalls) {
          toolLastUsedStep.set(tc.name, steps);
        }

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
          const args = (tc.arguments as Record<string, unknown>) ?? {};
          const prior = toolCallDeduplicator.check(toolRef, args, steps);
          if (!prior) {
            callsToExecute.push(tc);
            continue;
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
            kind: 'tool_result',
            toolCallId: tc.id,
            result: {
              skipped: true,
              reason: 'duplicate_call_within_window',
              priorToolCallId: prior.toolCallId,
              priorStep: prior.step,
              priorWasError: prior.wasError,
            },
            durationMs: 0,
            skipped: true,
            synthetic: true,
          });
          const feedback = prior.wasError
            ? `[skipped] identical call to ${toolRef.domain}.${toolRef.action} at step ${prior.step} failed — change arguments or try a different approach instead of retrying.`
            : `[skipped] identical call to ${toolRef.domain}.${toolRef.action} already ran at step ${prior.step} — see that tool_result instead of re-calling.`;
          messages.push({
            role: 'tool',
            content: feedback,
            toolCallId: tc.id,
          });
        }

        // Delegate tool execution to ToolExecutor
        this.toolExecutor.opts.currentStep = steps;
        const { cancelled, dupMap } = await this.toolExecutor.executeToolCalls(
          callsToExecute,
          activeToolNames,
          discoveredToolNames,
          wrappedEmit,
          messages,
          () => this._cancelled || (options?.isAborted?.() ?? false),
          this.pendingResolvers,
          this.pendingQuestionResolvers,
        );

        if (cancelled) {
          wrappedEmit({
            kind: 'cancelled',
            reason: 'user',
            completedToolCalls: 0,
            pendingToolCalls: 0,
          });
          wrappedEmit({ kind: 'run_end', status: 'cancelled' });
          return { content: 'Cancelled.', toolCalls: [], finishReason: 'stop' };
        }

        // Phase G — register just-executed calls in the deduplicator so
        // a subsequent identical `(toolRef, args)` within `windowSteps`
        // is short-circuited. Errors are still registered — the model
        // sees `priorWasError: true` on the skip feedback and learns not
        // to blindly retry (S9 pathology).
        for (const tc of callsToExecute) {
          const toolRef = parseCanonicalToolName(tc.name);
          const args = (tc.arguments as Record<string, unknown>) ?? {};
          const resultMsg = messages.find(
            (m) => m.role === 'tool' && m.toolCallId === tc.id,
          );
          const content = resultMsg?.content ?? '';
          const wasError =
            content.includes('"success":false') || /"error"\s*:/.test(content);
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
        this.recordEvidenceForStep(messages, callsToExecute);

        // 2C: Update scratchpad after each tool execution batch.
        this.updateScratchpad(messages, callsToExecute);

        // Track the most recent `commander.askUser` resolution. The
        // askUser-continuation safety net in the next iteration uses this
        // to detect openers that end as "ask → answer → stop" with no
        // mutation.
        if (lastResult.toolCalls.some((tc) => tc.name === 'commander.askUser')) {
          this.lastAskUserAnsweredStep = steps;

          // 1G: Mid-run intent re-evaluation. When the user answers an
          // askUser question, re-classify intent based on their answer text.
          // If the intent changes, update the active exit contract.
          this.reevaluateIntentFromAskUser(messages, callsToExecute, context, wrappedEmit);
        }

        // Push results for deduplicated tool calls
        for (const [dupId, firstId] of dupMap) {
          const firstResult = messages.find((m) => m.role === 'tool' && m.toolCallId === firstId);
          if (firstResult) {
            messages.push({ role: 'tool', content: firstResult.content, toolCallId: dupId });
          }
        }

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
            for (let i = 0; i < messages.length; i++) {
              const m = messages[i]!;
              if (m.role !== 'tool' || !m.toolCallId) continue;
              if (snapshotRestoreCallIds.has(m.toolCallId)) continue;
              const key = this.composeToolCallKey(messages, i);
              if (key) this.snapshotPreRestoreToolCallKeys.add(key);
            }
            this.invalidatedToolCallKeys.clear();
          } else {
            for (const tc of callsToExecute) {
              const category = getToolCompactionCategory(tc.name);
              if (category !== 'mutation') continue;
              const args = (tc.arguments as Record<string, unknown>) ?? {};
              graph.invalidateForMutation(tc.name, args);
              this.recordMutationWatermark(messages, tc.name, args);
            }
          }
        }

        // Post-round message shrink: stub the content of historical get/list
        // tool-results that are either (a) fully covered by the graph's
        // entity-cache projection or (b) invalidated by snapshot.restore /
        // mutation. Mirrors the legacy `ToolResultCache.processRound` payload
        // rewrite — prevents unbounded `messages` growth in long sessions
        // without changing what the wire payload looks like (the serializer
        // already drops fully-cached / stubbed groups).
        this.shrinkCoveredToolMessages(messages);

        // Batching hints: detect repetitive tool patterns and inject efficiency hint
        const toolCallCounts = new Map<string, number>();
        for (const tc of callsToExecute) {
          toolCallCounts.set(tc.name, (toolCallCounts.get(tc.name) ?? 0) + 1);
        }
        const batchHints: string[] = [];
        for (const [name, count] of toolCallCounts) {
          if (count >= 3) {
            if (name === 'canvas.updateNodeData') {
              batchHints.push(`[Efficiency: You called ${name} ${count} times. Use canvas.updateNodes with an array for batch updates.]`);
            } else if (name === 'canvas.addNode') {
              batchHints.push(`[Efficiency: You called ${name} ${count} times. Use canvas.batchCreate for bulk node creation.]`);
            } else if (name === 'canvas.getNode') {
              batchHints.push(`[Efficiency: You called ${name} ${count} times. Results are cached — avoid re-fetching nodes you already have.]`);
            }
          }
        }

        // Step failure rate warning
        const failedToolCount = messages
          .slice(-(lastResult.toolCalls.length))
          .filter((m) => m.role === 'tool' && m.content.includes('"success":false'))
          .length;
        const failRate = lastResult.toolCalls.length > 0 ? failedToolCount / lastResult.toolCalls.length : 0;
        if (failRate > 0.3 && lastResult.toolCalls.length >= 3) {
          batchHints.push(`[Warning: ${failedToolCount}/${lastResult.toolCalls.length} tool calls failed this step. Consider re-planning your approach.]`);
        }

        if (batchHints.length > 0) {
          messages.push({ role: 'system', content: batchHints.join('\n') });
        }

        // Predictive pre-compaction: trigger BEFORE next LLM call based on utilization
        const ctxTokens = effectiveCtx ?? 200000;
        const utilizationRatio = estimatedTokensUsed / ctxTokens;
        if (utilizationRatio > 0.90) {
          // Critical: full compaction (Phase 1 + Phase 2 LLM summarization)
          await this.contextManager.compactWithLLM(messages, inLoopCharBudget);
        } else if (utilizationRatio > 0.80) {
          // Proactive: fast rule-based compaction only
          this.contextManager.compactPhase1(messages);
        }

        // Handle injected messages
        if (this.injectedMessageCount > 0) {
          const count = this.injectedMessageCount;
          this.injectedMessageCount = 0;
          messages.push({
            role: 'system',
            content: `[${count} new user message${count > 1 ? 's were' : ' was'} received while you were working. Check the latest user messages above and address them before continuing your current task.]`,
          });
        }
      }

      // Reached maxSteps
      const pendingToolCalls = lastResult.toolCalls.length;
      const limitMsg = pendingToolCalls > 0
        ? `⚠️ Reached the step limit (${this.maxSteps} steps). ${pendingToolCalls} pending tool call(s) were not executed. You can increase "Max Steps" in Settings → Commander, or send a follow-up message to continue.`
        : `Reached the step limit (${this.maxSteps} steps). You can increase "Max Steps" in Settings → Commander if needed.`;
      const finalContent = lastResult.content
        ? `${lastResult.content}\n\n${limitMsg}`
        : limitMsg;
      this.lastAssistantText = finalContent;
      // Phase F — hard enforcement: append a `budget_exhausted` evidence
      // so `decide()` returns the `budget_exhausted` outcome with full
      // precedence, regardless of intent or other ledger state. The
      // engine's precedence rules take care of the rest.
      this.appendEvidence({ kind: 'budget_exhausted', metric: 'steps', at: Date.now() });
      const { decision, intent } = this.computeExitDecision();
      if (finalContent.trim().length > 0) {
        wrappedEmit({
          kind: 'assistant_text',
          content: finalContent,
          isDelta: false,
        });
      }
      wrappedEmit({
        kind: 'run_end',
        status: 'max_steps',
        exitDecision: this.toTimelineExitDecisionMeta(decision),
      });
      return { ...lastResult, exitDecision: decision, exitIntent: intent };
    } finally {
      // G2-5: snapshot the final graph BEFORE clearing so
      // `getSerializedContextGraph()` remains callable after execute() returns.
      //
      // If the graph was never built (e.g. early abort before the first
      // iteration's `rebuildGraphFromMessages`), fall back to the seed so
      // callers don't overwrite previously-persisted warm-up data with an
      // empty snapshot.
      const serialized = this.contextGraph?.serialize() ?? [];
      this.lastSerializedGraph = serialized.length > 0 ? serialized : [...this.pendingGraphSeed];
      // Seed is single-use — once consumed by this execute(), drop it so a
      // second call without a fresh seed doesn't re-merge stale items.
      this.pendingGraphSeed = [];
      this.activeMessages = null;
      this.transcriptIndex.clear();
      this.contextGraph = null;
    }
  }

  private async completeWithRetry(
    messages: LLMMessage[],
    opts: Parameters<LLMAdapter['completeWithTools']>[1],
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
      // Install a fresh step-level controller each attempt so a cancel
      // from the prior attempt can't leak across the retry boundary.
      // Combined with the run-level signal so either aborts the fetch.
      this._currentStepController = new AbortController();
      const stepSignal = this._currentStepController.signal;
      const runSignal = opts?.signal;
      const combined = runSignal ? AbortSignal.any([runSignal, stepSignal]) : stepSignal;
      const stepOpts = { ...opts, signal: combined };
      try {
        const stream = await this.adapter.completeWithTools(messages, stepOpts);
        return await this.drainLLMStream(stream, wrappedEmit, isAborted);
      } catch (err) {
        lastErr = err;
        // Step-cancel: a user-initiated step abort lands here as a
        // LucidError(CANCELLED). Treat it like a retryable transient so
        // the loop gets another shot with a fresh step controller.
        const isStepCancel =
          err instanceof LucidError &&
          err.code === 'CANCELLED' &&
          !this._cancelled;
        const isRetryable =
          isStepCancel ||
          (err instanceof LucidError &&
            (err.code === 'SERVICE_UNAVAILABLE' || err.code === 'RATE_LIMITED'));
        if (!isRetryable || i === maxRetries || isAborted()) throw err;
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
    throw lastErr;
  }

  /**
   * Fold an LLMStreamEvent async iterable into an OrchestratorCompletion while
   * forwarding each event to the renderer as its wire-schema counterpart.
   *
   * Mapping:
   *   reasoning_delta   → thinking_delta
   *   text_delta        → chunk (accumulated into content)
   *   tool_call_started → tool_call_started
   *   tool_call_args_delta → tool_call_args_delta
   *   tool_call_complete → tool_call_args_complete + sinks to toolCalls[]
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
            wrappedEmit({ kind: 'thinking', content: event.delta, isDelta: true });
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
            wrappedEmit({
              kind: 'tool_call',
              toolCallId: event.id,
              toolRef: parseCanonicalToolName(event.name),
              args: {},
            });
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
            } else {
              toolOrder.push(event.id);
              toolCallsById.set(event.id, { id: event.id, name: resolvedName, arguments: event.arguments });
            }
            wrappedEmit({
              kind: 'tool_call',
              toolCallId: event.id,
              toolRef: parseCanonicalToolName(resolvedName),
              args: event.arguments,
            });
            break;
          }
          case 'usage':
            // Usage diagnostics stay off the timeline stream; kept as a
            // recognised case so the exhaustive switch holds.
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
    };
  }

  /**
   * Resolve `canvas.generate` process category using the real node type on
   * the canvas when the LLM's `nodeType` arg is missing. Other tools pass
   * through unchanged. This eliminates the image-node-generation default
   * bias when the model calls `canvas.generate` on a video or audio node
   * without spelling out nodeType.
   */
  private detectProcessForToolCall(
    name: string,
    args?: Record<string, unknown>,
  ): ProcessCategory | null {
    if (
      name === 'canvas.generate'
      && this.resolveCanvasNodeType
      && args
      && typeof args.nodeType !== 'string'
      && typeof args.canvasId === 'string'
      && typeof args.nodeId === 'string'
    ) {
      const resolved = this.resolveCanvasNodeType(args.canvasId, args.nodeId);
      if (resolved) {
        return detectProcess(name, { ...args, nodeType: resolved });
      }
    }
    return detectProcess(name, args);
  }

  private activateProcessPrompts(
    messages: LLMMessage[],
    toolCalls: ReadonlyArray<LLMToolCall>,
    step: number,
  ): void {
    if (!this.resolveProcessPrompt || toolCalls.length === 0) return;

    const seen = new Set<ProcessCategory>();
    for (const toolCall of toolCalls) {
      const processKey = this.detectProcessForToolCall(toolCall.name, toolCall.arguments);
      if (!processKey || seen.has(processKey)) continue;
      seen.add(processKey);
      this.activeProcessPromptSteps.set(processKey, step);

      if (messages.some((message) => this.isProcessPromptMessage(message, processKey))) {
        continue;
      }

      const prompt = this.resolveProcessPrompt(processKey);
      if (!prompt?.trim()) continue;
      messages.push({
        role: 'system',
        content: this.buildProcessPromptMessage(processKey, prompt.trim()),
      });
    }
  }

  /**
   * Pre-flight guidance injection. Scans the model's pending tool calls,
   * finds any process category whose guide has not yet been injected this
   * session, and pushes those guides as system messages. The caller loops
   * back to the LLM so the model re-plans with the guide visible BEFORE
   * any tool call executes.
   *
   * Returns the list of process categories newly primed. An empty return
   * means every requested tool either has no process mapping or its guide
   * was already injected — the normal execution path should proceed.
   *
   * The same `detectProcess` map drives `activateProcessPrompts` below, so
   * once this method primes a category, the retroactive activator skips it
   * on subsequent turns (prevents double-injection).
   */
  /**
   * Pre-flight evaluation of the declarative process-prompt specs.
   *
   * Walks `this.processPromptSpecs` and for each spec whose predicate
   * fires AND whose content resolves non-empty, injects a system message
   * and records `process_prompt_activated` evidence. Idempotent: a key
   * already in `activeProcessPromptSteps` is skipped, matching the
   * session-wide dedup the pre-Phase-C method provided.
   *
   * Returns the list of keys freshly primed this call. The caller uses
   * it to decide whether to defer the assistant turn (so the model
   * re-plans with the guidance in context) and to render a UI label.
   */
  private primeProcessPromptSpecs(
    messages: LLMMessage[],
    toolCalls: ReadonlyArray<LLMToolCall>,
    canvasId: string | undefined,
    step: number,
    _emit: StreamEmit,
  ): Array<Exclude<ProcessPromptKey, ProcessCategory>> {
    if (!this.resolveProcessPrompt) return [];
    if (this.processPromptSpecs.length === 0) return [];

    const alreadyActivated = new Set<string>();
    for (const [key] of this.activeProcessPromptSteps) alreadyActivated.add(key);
    // Messages may already carry a prior-turn copy of the spec prompt
    // (e.g. mid-run resume). Treat those as "already activated" so we
    // don't double-inject.
    for (const spec of this.processPromptSpecs) {
      if (messages.some((m) => this.isProcessPromptMessage(m, spec.key as ProcessPromptKey))) {
        alreadyActivated.add(spec.key);
        this.activeProcessPromptSteps.set(spec.key as ProcessPromptKey, step);
      }
    }

    const result = evaluateProcessPromptSpecs(
      this.processPromptSpecs,
      {
        canvasId,
        pendingToolCalls: toolCalls.map((tc) => ({
          name: tc.name,
          arguments: tc.arguments,
        })),
        canvasSettings: canvasId && this.resolveCanvasSettings
          ? this.resolveCanvasSettings(canvasId) ?? undefined
          : undefined,
        ledger: this.evidenceLedger.entries(),
        step,
      },
      alreadyActivated,
    );

    const primed: Array<Exclude<ProcessPromptKey, ProcessCategory>> = [];
    for (const { spec, content } of result.activated) {
      const key = spec.key as Exclude<ProcessPromptKey, ProcessCategory>;
      this.activeProcessPromptSteps.set(key as ProcessPromptKey, step);
      messages.push({
        role: 'system',
        content: this.buildProcessPromptMessage(key as ProcessPromptKey, content),
      });
      this.appendEvidence({
        kind: 'process_prompt_activated',
        key: spec.key,
        reason: `spec-predicate-fired@step-${step}`,
        at: Date.now(),
      });
      primed.push(key);
    }
    return primed;
  }

  private primeProcessPromptsForToolCalls(
    messages: LLMMessage[],
    toolCalls: ReadonlyArray<LLMToolCall>,
    step: number,
  ): ProcessCategory[] {
    if (!this.resolveProcessPrompt || toolCalls.length === 0) return [];

    const primed: ProcessCategory[] = [];
    const seen = new Set<ProcessCategory>();
    for (const toolCall of toolCalls) {
      const processKey = this.detectProcessForToolCall(toolCall.name, toolCall.arguments);
      if (!processKey || seen.has(processKey)) continue;
      seen.add(processKey);

      // Already primed earlier this session — no re-inject, no defer.
      if (this.activeProcessPromptSteps.has(processKey)) continue;
      if (messages.some((message) => this.isProcessPromptMessage(message, processKey))) {
        this.activeProcessPromptSteps.set(processKey, step);
        continue;
      }

      const prompt = this.resolveProcessPrompt(processKey);
      if (!prompt?.trim()) continue;

      this.activeProcessPromptSteps.set(processKey, step);
      messages.push({
        role: 'system',
        content: this.buildProcessPromptMessage(processKey, prompt.trim()),
      });
      primed.push(processKey);
    }
    return primed;
  }

  private activateInitialProcessPrompts(messages: LLMMessage[], context: AgentContext): void {
    if (!this.resolveProcessPrompt) return;

    const requested = (context.extra as { initialProcessPrompts?: unknown } | undefined)?.initialProcessPrompts;
    if (!Array.isArray(requested) || requested.length === 0) return;

    for (const entry of requested) {
      if (!isProcessPromptKey(entry)) continue;
      if (messages.some((message) => this.isProcessPromptMessage(message, entry))) continue;
      // resolveProcessPrompt is typed as (ProcessCategory) but the IPC
      // implementation keys by free-form string — see `router.ts:110`. The
      // cast is safe for standalone keys whose presence in the store is
      // asserted by STANDALONE_SPEC_KEYS.
      const prompt = this.resolveProcessPrompt(entry as ProcessCategory);
      if (!prompt?.trim()) continue;
      this.activeProcessPromptSteps.set(entry, 0);
      messages.splice(1, 0, {
        role: 'system',
        content: this.buildProcessPromptMessage(entry, prompt.trim()),
      });
    }
  }

  /**
   * Process categories that act as load-bearing phase rails for the
   * story-to-video pipeline. These are pinned once active for the rest of
   * the session — stripping them mid-phase caused the LLM to forget the
   * phase contract and re-plan from scratch on every third step.
   */
  private static readonly PHASE_CRITICAL_PROCESS_KEYS: ReadonlySet<ProcessPromptKey> = new Set<ProcessPromptKey>([
    'workflow-orchestration',
    'character-ref-image-generation',
    'location-ref-image-generation',
    'equipment-ref-image-generation',
    'image-node-generation',
    'video-node-generation',
    'render-and-export',
    // Style-plate lock is a gate that must remain in context until the plate
    // is actually locked. Stripping it mid-session would regress the very
    // behaviour this prompt enforces (no ref-image before plate).
    'style-plate-lock',
    // Entities-before-generation is a sticky early-session gate reminding
    // the LLM to verify ref-image status. Must not be stripped while active.
    'entities-before-generation',
    // Story workflow phase is a sticky guide that reinforces phase gates
    // once workflow-orchestration is active. Must not be stripped mid-phase.
    'story-workflow-phase',
  ]);

  private stripInactiveProcessPrompts(messages: LLMMessage[], step: number): void {
    if (this.activeProcessPromptSteps.size === 0) return;

    const staleKeys: ProcessPromptKey[] = [];
    for (const [processKey, lastUsedStep] of this.activeProcessPromptSteps) {
      if (AgentOrchestrator.PHASE_CRITICAL_PROCESS_KEYS.has(processKey)) continue;
      if (step - lastUsedStep > 3) {
        staleKeys.push(processKey);
      }
    }

    if (staleKeys.length === 0) return;

    for (let index = messages.length - 1; index >= 0; index--) {
      const message = messages[index];
      if (message.role !== 'system') continue;
      if (staleKeys.some((processKey) => this.isProcessPromptMessage(message, processKey))) {
        messages.splice(index, 1);
      }
    }

    for (const processKey of staleKeys) {
      this.activeProcessPromptSteps.delete(processKey);
    }
  }

  private buildProcessPromptMessage(processKey: ProcessPromptKey, prompt: string): string {
    const displayName = isProcessCategory(processKey)
      ? getProcessCategoryName(processKey)
      : getStandaloneDisplayName(processKey, this.processPromptSpecs);
    return `[[process-prompt:${processKey}]]\n[Process Guide: ${displayName}]\n${prompt}`;
  }

  private isProcessPromptMessage(message: LLMMessage, processKey: ProcessPromptKey): boolean {
    return message.role === 'system' && message.content.startsWith(`[[process-prompt:${processKey}]]`);
  }

  /**
   * 1I: Collect all active process prompt contents from the messages array,
   * remove those separate system messages, and return the data needed to
   * inject them as a structured section in the system prompt. This is called
   * before each LLM call to consolidate process prompts.
   */
  private consolidateProcessPrompts(
    messages: LLMMessage[],
  ): Array<{ key: string; displayName: string; content: string }> {
    const result: Array<{ key: string; displayName: string; content: string }> = [];
    const indicesToRemove: number[] = [];
    const processPromptPrefix = '[[process-prompt:';

    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      if (msg.role !== 'system') continue;
      if (!msg.content.startsWith(processPromptPrefix)) continue;
      // Skip messages[0] (the main system prompt)
      if (i === 0) continue;

      // Parse the key from the marker: [[process-prompt:KEY]]
      const endBracket = msg.content.indexOf(']]');
      if (endBracket === -1) continue;
      const key = msg.content.slice(processPromptPrefix.length, endBracket);

      // Parse the display name from [Process Guide: NAME]
      const guidePrefix = '[Process Guide: ';
      const guideLine = msg.content.slice(endBracket + 3); // skip ]]\n
      let displayName = key;
      let content = guideLine;
      if (guideLine.startsWith(guidePrefix)) {
        const nameEnd = guideLine.indexOf(']');
        if (nameEnd !== -1) {
          displayName = guideLine.slice(guidePrefix.length, nameEnd);
          content = guideLine.slice(nameEnd + 2); // skip ]\n
        }
      }

      result.push({ key, displayName, content });
      indicesToRemove.push(i);
    }

    // Remove from messages in reverse order to preserve indices
    for (let i = indicesToRemove.length - 1; i >= 0; i--) {
      messages.splice(indicesToRemove[i], 1);
    }

    return result;
  }

  /**
   * G2a-6: Rebuild the ContextGraph from the canonical `messages` array.
   *
   * Runs before every LLM call in graph-mode. This keeps the graph in lock-step
   * with any `messages` mutations (system-prompt refresh, process-prompt
   * injection, batch-warning inserts, etc.) without requiring each mutation
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
    this.contextGraph = new ContextGraph();
    // G2-5: re-merge graph-only persisted items (seeded on resume). Only
    // kinds that are NOT reconstructable from the `messages` array are
    // merged — other kinds would duplicate what the loop below rebuilds.
    // Today that means `entity-snapshot` + `session-summary` + `scratchpad`.
    // Guide, user, assistant, tool-result, system-message, and reference
    // items are all re-derived from messages so they stay authoritative.
    for (const seed of this.pendingGraphSeed) {
      if (seed.kind === 'entity-snapshot' || seed.kind === 'session-summary' || seed.kind === 'scratchpad') {
        this.contextGraph.add(seed);
      }
    }
    // Counter of how many times each `(callId, toolKey, paramsHash)` has
    // been seen so far in this pass — lets us disambiguate adapter
    // fallback ids (`tool-call-0`) that repeat across turns with the
    // same args. Each occurrence gets its own `#n` suffix in the
    // watermark keys.
    const compositeOccurrence = new Map<string, number>();
    for (let i = 0; i < messages.length; i++) {
      const m = messages[i]!;
      if (m.role === 'system') {
        // The FIRST system message is the top-level system prompt → guide.
        // Subsequent system messages (injected process prompts, batch warnings,
        // new-user-message notices) are position-sensitive runtime instructions
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
          toolCalls: m.toolCalls?.map((tc) => ({
            id: tc.id,
            name: tc.name,
            arguments: tc.arguments,
          })),
        } satisfies ContextItem);
      } else if (m.role === 'tool') {
        // Recover the originating tool call name + args by scanning prior
        // assistant turns in the array. Falls back to a unique-per-message
        // identity when args aren't known (e.g. seeded tool messages).
        let toolKey: ToolKey = 'unknown' as ToolKey;
        let paramsHash = m.toolCallId ?? `msg-${i}`;
        if (m.toolCallId) {
          for (let j = i - 1; j >= 0; j--) {
            const prev = messages[j]!;
            if (prev.role !== 'assistant' || !prev.toolCalls) continue;
            const call = prev.toolCalls.find((tc) => tc.id === m.toolCallId);
            if (call) {
              toolKey = call.name as ToolKey;
              paramsHash = safeStringify(call.arguments);
              break;
            }
          }
        }
        // Honor persistent invalidation watermarks. The composite key is
        // `callId|toolKey|paramsHash#occurrence` — the occurrence counter
        // disambiguates adapters that reuse fallback ids (`tool-call-0`)
        // across turns with identical args, so a later fresh read is not
        // suppressed by an earlier same-shape invalidation.
        let compositeKey: string | undefined;
        if (m.toolCallId) {
          const base = `${m.toolCallId}|${toolKey}|${paramsHash}`;
          const n = (compositeOccurrence.get(base) ?? 0) + 1;
          compositeOccurrence.set(base, n);
          compositeKey = `${base}#${n}`;
        }
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
   * Keying by `toolCallId` (not `toolKey|paramsHash`) lets a subsequent
   * fresh read for the same identity flow through — its call-id is new.
   */
  private recordMutationWatermark(
    messages: LLMMessage[],
    mutationToolName: string,
    mutationArgs: Record<string, unknown>,
  ): void {
    const domain = mutationToolName.split('.')[0];
    if (!domain) return;
    const entityId = extractEntityIdFromArgs(mutationArgs);
    for (let i = 0; i < messages.length; i++) {
      const m = messages[i]!;
      if (m.role !== 'tool' || !m.toolCallId) continue;
      let callName: string | undefined;
      let callArgs: unknown;
      for (let j = i - 1; j >= 0; j--) {
        const prev = messages[j]!;
        if (prev.role !== 'assistant' || !prev.toolCalls) continue;
        const call = prev.toolCalls.find((tc) => tc.id === m.toolCallId);
        if (call) { callName = call.name; callArgs = call.arguments; break; }
      }
      if (!callName) continue;
      const itemDomain = callName.split('.')[0];
      if (itemDomain !== domain) continue;
      const cat = getToolCompactionCategory(callName);
      if (cat !== 'get' && cat !== 'list') continue;
      const paramsHash = safeStringify(callArgs);
      if (!entityId || cat === 'list' || paramsHash.includes(entityId)) {
        const key = this.composeToolCallKey(messages, i);
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
  private shrinkCoveredToolMessages(messages: LLMMessage[]): void {
    if (!this.contextGraph) return;
    const STUB = '{"_cached":true}';
    // Walk from newest → oldest so we can keep the FIRST encountered
    // (newest) instance per identity and stub older duplicates.
    const kept = new Set<string>();
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i]!;
      if (m.role !== 'tool' || !m.toolCallId) continue;
      if (m.content === STUB) continue;
      // Discover the originating tool call.
      let callName: string | undefined;
      let callArgs: unknown;
      for (let j = i - 1; j >= 0; j--) {
        const prev = messages[j]!;
        if (prev.role !== 'assistant' || !prev.toolCalls) continue;
        const call = prev.toolCalls.find((tc) => tc.id === m.toolCallId);
        if (call) { callName = call.name; callArgs = call.arguments; break; }
      }
      if (!callName) continue;
      const paramsHash = safeStringify(callArgs);
      const compositeKey = this.composeToolCallKey(messages, i);
      const isInvalidated = compositeKey !== undefined && (
        this.snapshotPreRestoreToolCallKeys.has(compositeKey) ||
        this.invalidatedToolCallKeys.has(compositeKey)
      );
      const cat = getToolCompactionCategory(callName);
      if (cat !== 'get' && cat !== 'list') {
        if (isInvalidated) messages[i] = { ...m, content: STUB };
        continue;
      }
      const identity = `${callName}|${paramsHash}`;
      if (isInvalidated) {
        messages[i] = { ...m, content: STUB };
        continue;
      }
      const covered = this.contextGraph.hasToolResult(callName, paramsHash);
      if (!covered) continue;
      if (!kept.has(identity)) {
        kept.add(identity);
        continue;
      }
      messages[i] = { ...m, content: STUB };
    }
  }

  /**
   * Compose the composite watermark key (`callId|toolKey|paramsHash#n`) for
   * a tool message at the given index. The occurrence suffix disambiguates
   * adapters that reuse fallback ids across turns with identical args.
   * Walks `messages` once to compute occurrence counts up to `i`.
   */
  private composeToolCallKey(messages: LLMMessage[], i: number): string | undefined {
    const m = messages[i]!;
    if (m.role !== 'tool' || !m.toolCallId) return undefined;
    let callName = 'unknown';
    let paramsHashLocal = m.toolCallId;
    for (let j = i - 1; j >= 0; j--) {
      const prev = messages[j]!;
      if (prev.role !== 'assistant' || !prev.toolCalls) continue;
      const call = prev.toolCalls.find((tc) => tc.id === m.toolCallId);
      if (call) {
        callName = call.name;
        paramsHashLocal = safeStringify(call.arguments);
        break;
      }
    }
    const base = `${m.toolCallId}|${callName}|${paramsHashLocal}`;
    // Count occurrences up to and including i (matches the rebuild walk).
    let n = 0;
    for (let k = 0; k <= i; k++) {
      const mk = messages[k]!;
      if (mk.role !== 'tool' || mk.toolCallId !== m.toolCallId) continue;
      let kCallName = 'unknown';
      let kParamsHash = mk.toolCallId;
      for (let j = k - 1; j >= 0; j--) {
        const prev = messages[j]!;
        if (prev.role !== 'assistant' || !prev.toolCalls) continue;
        const call = prev.toolCalls.find((tc) => tc.id === mk.toolCallId);
        if (call) { kCallName = call.name; kParamsHash = safeStringify(call.arguments); break; }
      }
      if (`${mk.toolCallId}|${kCallName}|${kParamsHash}` === base) n++;
    }
    return `${base}#${n}`;
  }

  // ──────────────────────────────────────────────────────────────────
  // Scratchpad (2C)
  // ──────────────────────────────────────────────────────────────────

  /**
   * Build the scratchpad content string from accumulated sections.
   * Budget: ~500 chars max. Truncates oldest entries first.
   */
  private buildScratchpadContent(): string {
    const maxChars = AgentOrchestrator.SCRATCHPAD_MAX_CHARS;
    const parts: string[] = [];

    if (this.scratchpadTodos.length > 0) {
      parts.push(`TODO: ${this.scratchpadTodos.join('; ')}`);
    }
    if (this.scratchpadDecisions.length > 0) {
      parts.push(`DECISIONS: ${this.scratchpadDecisions.join('; ')}`);
    }
    if (this.scratchpadFailures.length > 0) {
      parts.push(`FAILURES: ${this.scratchpadFailures.join('; ')}`);
    }

    let content = parts.join('\n');

    // Truncate oldest entries (from each section) while over budget.
    while (content.length > maxChars) {
      if (this.scratchpadFailures.length > 1) {
        this.scratchpadFailures.shift();
      } else if (this.scratchpadDecisions.length > 1) {
        this.scratchpadDecisions.shift();
      } else if (this.scratchpadTodos.length > 1) {
        this.scratchpadTodos.shift();
      } else {
        content = content.slice(content.length - maxChars);
        break;
      }
      const rebuilt: string[] = [];
      if (this.scratchpadTodos.length > 0) {
        rebuilt.push(`TODO: ${this.scratchpadTodos.join('; ')}`);
      }
      if (this.scratchpadDecisions.length > 0) {
        rebuilt.push(`DECISIONS: ${this.scratchpadDecisions.join('; ')}`);
      }
      if (this.scratchpadFailures.length > 0) {
        rebuilt.push(`FAILURES: ${this.scratchpadFailures.join('; ')}`);
      }
      content = rebuilt.join('\n');
    }

    return content;
  }

  /**
   * Update the scratchpad after a tool execution batch. Extracts:
   * - Todo state from `todo.set` / `todo.update` results
   * - Creative decisions from `commander.askUser` responses where user picked an option
   * - Failure traces from tool results with errors
   */
  private updateScratchpad(
    messages: readonly LLMMessage[],
    toolCalls: readonly LLMToolCall[],
  ): void {
    for (const tc of toolCalls) {
      const resultMsg = messages.find(
        (m) => m.role === 'tool' && m.toolCallId === tc.id,
      );
      const content = resultMsg?.content ?? '';

      // Extract todo state from todo.set / todo.update.
      if (tc.name === 'todo.set' || tc.name === 'todo.update') {
        try {
          const parsed = JSON.parse(content) as { success?: boolean; data?: unknown };
          if (parsed.success !== false) {
            const args = tc.arguments as { items?: Array<{ text?: string; status?: string }> } | null;
            if (Array.isArray(args?.items)) {
              this.scratchpadTodos = args!.items
                .filter((item) => item.text)
                .map((item) => `${item.text}: ${item.status ?? 'pending'}`);
            }
          }
        } catch { /* ignore parse errors */ }
        continue;
      }

      // Extract decisions from askUser responses.
      if (tc.name === 'commander.askUser') {
        if (content && !content.includes('"success":false')) {
          const args = tc.arguments as { question?: string } | null;
          const question = typeof args?.question === 'string'
            ? args.question.slice(0, 40)
            : 'choice';
          let answer: string;
          try {
            const parsed = JSON.parse(content) as { data?: { answer?: string } };
            answer = typeof parsed.data?.answer === 'string'
              ? parsed.data.answer.slice(0, 60)
              : content.slice(0, 60);
          } catch {
            answer = content.slice(0, 60);
          }
          this.scratchpadDecisions.push(`${question} -> ${answer}`);
        }
        continue;
      }

      // Extract failure traces.
      if (content.includes('"success":false')) {
        let errorText: string;
        try {
          const parsed = JSON.parse(content) as { error?: string };
          errorText = typeof parsed.error === 'string'
            ? parsed.error.slice(0, 60)
            : 'unknown error';
        } catch {
          errorText = 'parse error';
        }
        this.scratchpadFailures.push(`${tc.name}: ${errorText}`);
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
  // 1G: Mid-Run Intent Re-evaluation
  // ──────────────────────────────────────────────────────────────────

  /**
   * Re-evaluate intent after a `commander.askUser` response. If the user's
   * answer shifts the intent (e.g. from informational to execution), update
   * `currentIntent` and emit a `phase_note` so the UI and harness can see
   * the reclassification.
   */
  private reevaluateIntentFromAskUser(
    messages: readonly LLMMessage[],
    toolCalls: readonly LLMToolCall[],
    context: AgentContext,
    wrappedEmit: StreamEmit,
  ): void {
    // Find the askUser tool call and its result.
    const askCall = toolCalls.find((tc) => tc.name === 'commander.askUser');
    if (!askCall) return;

    const resultMsg = messages.find(
      (m) => m.role === 'tool' && m.toolCallId === askCall.id,
    );
    if (!resultMsg) return;

    // Extract the user's answer text from the tool result.
    let userAnswer = '';
    try {
      const parsed = JSON.parse(resultMsg.content) as { data?: { answer?: string } };
      if (typeof parsed.data?.answer === 'string') {
        userAnswer = parsed.data.answer;
      }
    } catch { /* ignore */ }
    if (!userAnswer) {
      // Fallback: use the raw content if it's short enough to be an answer.
      userAnswer = resultMsg.content.length < 200 ? resultMsg.content : '';
    }
    if (!userAnswer.trim()) return;

    // Determine canvas state for the classifier.
    const canvasHasNodes = Array.isArray(
      (context.extra as { canvasNodes?: unknown[] } | undefined)?.canvasNodes,
    )
      ? (context.extra as { canvasNodes?: unknown[] }).canvasNodes!.length > 0
      : undefined;

    const newIntent = classifyIntent({ userMessage: userAnswer, canvasHasNodes });

    // Only act if the intent kind actually changed.
    if (newIntent.kind === this.currentIntent.kind) return;

    const oldKind = this.currentIntent.kind;
    this.currentIntent = newIntent;

    // Update the classified intent in the context extra for the system prompt.
    if (context.extra) {
      const intentWorkflow = 'workflow' in newIntent ? newIntent.workflow : undefined;
      (context.extra as Record<string, unknown>).classifiedIntent = intentWorkflow
        ? `${newIntent.kind} (workflow: ${intentWorkflow})`
        : newIntent.kind;
    }

    wrappedEmit({
      kind: 'phase_note',
      note: 'intent_reclassified',
      params: {
        from: oldKind,
        to: newIntent.kind,
      },
    });
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
   *  - `generation_started` on canvas.generate / *.generateRefImage
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
      try { parsed = JSON.parse(rawResult); } catch { parsed = null; }
      const ok = this.isToolResultOk(parsed);
      const errorText = this.extractToolResultError(parsed);

      if (!ok && errorText) {
        this.appendEvidence({ kind: 'validation_error', toolName: tc.name, errorText, at: now });
        continue;
      }

      // Non-meta successful calls are mutation candidates. We filter out
      // pure reads (tool.*, guide.*, canvas.getState, canvas.listNodes,
      // canvas.getNode, *.list) since those can't satisfy a contract.
      if (ok && !this.isReadOnlyTool(tc.name)) {
        this.appendEvidence({ kind: 'mutation_commit', toolName: tc.name, args: tc.arguments, resultOk: true, at: now });
      }

      // Side-effects for specific tools — surface them as their own
      // evidence so contracts can write more expressive success signals
      // later.
      if (ok && tc.name === 'guide.get') {
        const guideId = this.extractGuideId(parsed);
        if (guideId) {
          this.appendEvidence({ kind: 'guide_loaded', guideId, at: now });
        }
      }
      if (ok && tc.name === 'canvas.setSettings') {
        const rawArgs = tc.arguments as { canvasId?: unknown; settings?: unknown } | null;
        const canvasId = typeof rawArgs?.canvasId === 'string' ? rawArgs.canvasId : '';
        const keys = rawArgs?.settings && typeof rawArgs.settings === 'object'
          ? Object.keys(rawArgs.settings as Record<string, unknown>)
          : [];
        this.appendEvidence({ kind: 'settings_write', canvasId, keys, at: now });
      }
      if (ok && (tc.name === 'canvas.generate' || /\.generateRefImage$/.test(tc.name))) {
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
      for (let i = messages.length - 1; i >= 0; i--) {
        const m = messages[i];
        if (m.role !== 'tool' || !m.toolCallId) continue;
        const call = this.findToolCallById(messages, m.toolCallId);
        if (!call || call.name !== 'commander.askUser') continue;
        this.appendEvidence({ kind: 'ask_user_answered', answer: m.content, at: now });
        break;
      }
    }
  }

  private appendEvidence(
    evidence: Parameters<EvidenceLedger['record']>[0],
  ): void {
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

  private toTimelineExitDecisionMeta(
    decision: ExitDecision,
  ): TimelineExitDecisionMeta {
    return {
      outcome: decision.outcome,
      contractId:
        'contractId' in decision ? decision.contractId : undefined,
      blocker:
        'blocker' in decision && decision.blocker
          ? decision.blocker.kind
          : undefined,
    };
  }

  // Narrow tool-result-is-ok check. Our result shape is
  // `{ success: boolean, data? | error?, errorClass? }`. Anything else
  // (non-JSON, different shape) is treated as OK so read tools like
  // `canvas.getState` still count as success.
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

  private extractGuideId(parsed: unknown): string | null {
    if (parsed === null || typeof parsed !== 'object') return null;
    const obj = parsed as { data?: unknown };
    const data = obj.data;
    if (Array.isArray(data)) {
      const first = data[0] as { id?: unknown } | undefined;
      return typeof first?.id === 'string' ? first.id : null;
    }
    if (data && typeof data === 'object') {
      const d = data as { id?: unknown };
      return typeof d.id === 'string' ? d.id : null;
    }
    return null;
  }

  private isReadOnlyTool(name: string): boolean {
    if (name === 'tool.get' || name === 'tool.compact') return true;
    if (name === 'guide.get') return true;
    if (name === 'logger.list') return true;
    if (name.endsWith('.list') || name.endsWith('.get') || name.endsWith('.getNode') || name.endsWith('.getState') || name.endsWith('.listNodes') || name.endsWith('.listEdges')) {
      return true;
    }
    return false;
  }

  private findToolCallById(messages: readonly LLMMessage[], id: string): { name: string } | null {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m.role === 'assistant' && Array.isArray(m.toolCalls)) {
        const found = m.toolCalls.find((tc) => tc.id === id);
        if (found) return { name: found.name };
      }
    }
    return null;
  }
}

/** Extract an entity id from mutation args. Keep this field list in sync
 * with `ContextGraph._extractEntityIdFromArgs` so the orchestrator's
 * rebuild-watermark scoping matches the in-memory graph's invalidation. */
function extractEntityIdFromArgs(args: Record<string, unknown>): string | undefined {
  for (const field of [
    'id', 'nodeId', 'characterId', 'equipmentId', 'locationId',
    'presetId', 'templateId',
  ] as const) {
    const value = args[field];
    if (typeof value === 'string' && value) return value;
  }
  return undefined;
}
