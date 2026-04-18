import type {
  LLMAdapter,
  LLMMessage,
  LLMCompletionResult,
  ProviderProfile,
} from '@lucid-fin/contracts';
import { LucidError, DEFAULT_PROVIDER_PROFILE } from '@lucid-fin/contracts';
import type { AgentToolRegistry } from './tool-registry.js';
import { getToolCompactionCategory } from '@lucid-fin/shared-utils';
import {
  type AgentContext,
  type HistoryEntry,
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
} from './context-manager.js';
import { ToolExecutor } from './tool-executor.js';
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

// Re-export types so consumers don't break
export type { AgentContext, HistoryEntry };

export interface AgentEvent {
  type: 'tool_call' | 'tool_result' | 'stream_chunk' | 'error' | 'done' | 'tool_confirm' | 'tool_question' | 'thinking';
  toolName?: string;
  toolCallId?: string;
  arguments?: Record<string, unknown>;
  result?: unknown;
  content?: string;
  error?: string;
  tier?: number;
  question?: string;
  options?: Array<{ label: string; description?: string }>;
  startedAt?: number;
  completedAt?: number;
}

export interface AgentOptions {
  maxSteps?: number;
  temperature?: number;
  maxTokens?: number;
  profile?: ProviderProfile;
  resolveProcessPrompt?: (processKey: ProcessCategory) => string | null;
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
  raw: LLMCompletionResult,
  reverseMap: ReadonlyMap<string, string>,
): LLMCompletionResult {
  if (!raw.toolCalls || raw.toolCalls.length === 0) return raw;
  const seenIds = new Set<string>();
  const deduped: LLMCompletionResult['toolCalls'] = [];
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
  private activeProcessPromptSteps = new Map<ProcessCategory, number>();

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
    const resolvers = [...this.pendingResolvers.values()];
    this.pendingResolvers.clear();
    for (const resolve of resolvers) resolve(false);
    const questionResolvers = [...this.pendingQuestionResolvers.values()];
    this.pendingQuestionResolvers.clear();
    for (const resolve of questionResolvers) resolve('');
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
    emit: (event: AgentEvent) => void,
    options?: AgentExecutionOptions,
  ): Promise<LLMCompletionResult> {
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

    if (userCtx && detectedCtx && userCtx < detectedCtx) {
      emit({
        type: 'stream_chunk',
        content: `[Note: Your configured context window (${userCtx.toLocaleString()} tokens) is smaller than the model's actual context (${detectedCtx.toLocaleString()} tokens). Using your configured value.]\n`,
      });
    }

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
    let lastResult: LLMCompletionResult = { content: '', toolCalls: [], finishReason: 'stop' };
    const toolLastUsedStep = new Map<string, number>();
    for (const name of ALWAYS_LOADED_TOOLS) {
      toolLastUsedStep.set(name, 0);
    }

    this.activeProcessPromptSteps.clear();
    this.activateInitialProcessPrompts(messages, context);
    this.activeMessages = messages;

    // Compact history on load
    truncateOldToolResults(messages);
    this.injectedMessageCount = 0;
    this._cancelled = false;

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
    });

    const wrappedEmit: typeof emit = (event) => {
      emit(event);
    };

    try {
      while (steps < this.maxSteps) {
        if (this._cancelled || options?.isAborted?.()) {
          wrappedEmit({ type: 'done', content: 'Cancelled.' });
          return { content: 'Cancelled.', toolCalls: [], finishReason: 'stop' };
        }

        steps++;
        this.stripInactiveProcessPrompts(messages, steps);

        // Rebuild system prompt with step-aware abbreviation (saves tokens after step 5)
        if (steps > 1) {
          systemPrompt = this.contextManager.buildSystemPrompt(context, steps);
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

        // Clear previous thinking before new LLM call
        wrappedEmit({ type: 'thinking', content: '' });

        const rawResult = await this.completeWithRetry(wireMessages, {
          tools: wireTools.length > 0 ? wireTools : undefined,
          toolChoice: wireTools.length > 0 ? 'auto' : undefined,
          temperature: this.temperature,
          maxTokens: this.maxTokens,
        });

        // Un-sanitize tool names and dedup tool call IDs using the graph
        // serializer's reverse map.
        lastResult = destructResponse(rawResult, graphReverseMap);

        if (lastResult.reasoning) {
          wrappedEmit({ type: 'thinking', content: lastResult.reasoning });
        }
        if (lastResult.content) {
          wrappedEmit({ type: 'stream_chunk', content: lastResult.content });
        }

        // No tool calls -- done.
        if (lastResult.toolCalls.length === 0 || lastResult.finishReason !== 'tool_calls') {
          const finalContent = lastResult.content || (lastResult.toolCalls.length === 0 && steps > 1 ? 'Task completed.' : '');
          wrappedEmit({ type: 'done', content: finalContent });
          return lastResult;
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

        // Delegate tool execution to ToolExecutor
        this.toolExecutor.opts.currentStep = steps;
        const { cancelled, dupMap } = await this.toolExecutor.executeToolCalls(
          lastResult.toolCalls,
          activeToolNames,
          discoveredToolNames,
          wrappedEmit,
          messages,
          () => this._cancelled || (options?.isAborted?.() ?? false),
          this.pendingResolvers,
          this.pendingQuestionResolvers,
        );

        if (cancelled) {
          wrappedEmit({ type: 'done', content: 'Cancelled.' });
          return { content: 'Cancelled.', toolCalls: [], finishReason: 'stop' };
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
          for (const tc of lastResult.toolCalls) {
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
            for (const tc of lastResult.toolCalls) {
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
        for (const tc of lastResult.toolCalls) {
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
        ? `\u26A0\uFE0F Reached the step limit (${this.maxSteps} steps). ${pendingToolCalls} pending tool call(s) were not executed. You can increase "Max Steps" in Settings \u2192 Commander, or send a follow-up message to continue.`
        : `Reached the step limit (${this.maxSteps} steps). You can increase "Max Steps" in Settings \u2192 Commander if needed.`;
      const finalContent = lastResult.content
        ? `${lastResult.content}\n\n${limitMsg}`
        : limitMsg;
      wrappedEmit({ type: 'done', content: finalContent });
      return lastResult;
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
    maxRetries = 2,
  ): Promise<LLMCompletionResult> {
    let lastErr: unknown;
    for (let i = 0; i <= maxRetries; i++) {
      try {
        return await this.adapter.completeWithTools(messages, opts);
      } catch (err) {
        lastErr = err;
        const isRetryable =
          err instanceof LucidError &&
          (err.code === 'SERVICE_UNAVAILABLE' || err.code === 'RATE_LIMITED');
        if (!isRetryable || i === maxRetries) throw err;
        await new Promise((r) => setTimeout(r, 1000 * (i + 1)));
      }
    }
    throw lastErr;
  }

  private activateProcessPrompts(
    messages: LLMMessage[],
    toolCalls: ReadonlyArray<LLMCompletionResult['toolCalls'][number]>,
    step: number,
  ): void {
    if (!this.resolveProcessPrompt || toolCalls.length === 0) return;

    const seen = new Set<ProcessCategory>();
    for (const toolCall of toolCalls) {
      const processKey = detectProcess(toolCall.name, toolCall.arguments);
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

  private activateInitialProcessPrompts(messages: LLMMessage[], context: AgentContext): void {
    if (!this.resolveProcessPrompt) return;

    const requested = (context.extra as { initialProcessPrompts?: unknown } | undefined)?.initialProcessPrompts;
    if (!Array.isArray(requested) || requested.length === 0) return;

    for (const entry of requested) {
      if (!isProcessCategory(entry)) continue;
      if (messages.some((message) => this.isProcessPromptMessage(message, entry))) continue;
      const prompt = this.resolveProcessPrompt(entry);
      if (!prompt?.trim()) continue;
      this.activeProcessPromptSteps.set(entry, 0);
      messages.splice(1, 0, {
        role: 'system',
        content: this.buildProcessPromptMessage(entry, prompt.trim()),
      });
    }
  }

  private stripInactiveProcessPrompts(messages: LLMMessage[], step: number): void {
    if (this.activeProcessPromptSteps.size === 0) return;

    const staleKeys: ProcessCategory[] = [];
    for (const [processKey, lastUsedStep] of this.activeProcessPromptSteps) {
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

  private buildProcessPromptMessage(processKey: ProcessCategory, prompt: string): string {
    return `[[process-prompt:${processKey}]]\n[Process Guide: ${getProcessCategoryName(processKey)}]\n${prompt}`;
  }

  private isProcessPromptMessage(message: LLMMessage, processKey: ProcessCategory): boolean {
    return message.role === 'system' && message.content.startsWith(`[[process-prompt:${processKey}]]`);
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
    // Today that means `entity-snapshot` + `session-summary`. Guide, user,
    // assistant, tool-result, system-message, and reference items are all
    // re-derived from messages so they stay authoritative.
    for (const seed of this.pendingGraphSeed) {
      if (seed.kind === 'entity-snapshot' || seed.kind === 'session-summary') {
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
