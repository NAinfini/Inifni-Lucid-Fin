import type {
  LLMAdapter,
  LLMMessage,
  LLMCompletionResult,
  ProviderProfile,
} from '@lucid-fin/contracts';
import { LucidError, DEFAULT_PROVIDER_PROFILE } from '@lucid-fin/contracts';
import type { AgentToolRegistry } from './tool-registry.js';
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
import { buildMessagesForRequest, destructLLMResponse } from './message-constructor.js';
import { ToolResultCache } from './tool-result-cache.js';
import { TranscriptIndex } from './transcript-index.js';
import type { ToolResult } from './tool-registry.js';
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
 * Feature flag: when truthy, the ContextGraph path is used instead of the
 * legacy ContextManager + ToolResultCache path (OpenAI provider only).
 * Default: off. Enable by setting env var LUCID_CONTEXT_GRAPH=1.
 */
/**
 * Feature flag: ContextGraph cutover path (Phase G2b).
 * Default: off. Enable by setting env var LUCID_CONTEXT_GRAPH=1.
 * Read at call time (not module init) so tests can toggle it.
 */
function isContextGraphEnabled(): boolean {
  return process.env['LUCID_CONTEXT_GRAPH'] === '1';
}

/**
 * Strip context-injected parameters from a tool schema. Matches the helper
 * in message-constructor.ts — needed locally for the graph serializer path.
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
  private resultCache: ToolResultCache | null = null;
  private transcriptIndex: TranscriptIndex;
  /** Cached tool schema JSON to avoid re-serialization each step. */
  private _lastToolSchemaJson = '';
  private _lastToolSchemaChars = 0;
  private _lastToolCount = 0;

  private contextManager: ContextManager;
  private toolExecutor: ToolExecutor;

  /** Active ContextGraph for the current execute() session (graph-path only). */
  private contextGraph: ContextGraph | null = null;

  private injectedMessageCount = 0;
  private readonly resolveProcessPrompt?: (processKey: ProcessCategory) => string | null;
  private activeProcessPromptSteps = new Map<ProcessCategory, number>();

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
    return this.contextManager.compactNow(this.activeMessages, instructions, this.resultCache ?? undefined);
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

    // Initialize tool result cache + prewarm from history
    this.resultCache = new ToolResultCache();
    this.transcriptIndex = new TranscriptIndex();

    // Create tool executor with cache reference (must be after cache init)
    const canvasId = typeof context.extra?.canvasId === 'string' ? context.extra.canvasId : undefined;
    this.toolExecutor = new ToolExecutor(this.tools, {
      permissionMode: options?.permissionMode,
      cache: this.resultCache,
      canvasId,
    });

    // Pre-populate transcript index from history messages
    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      if (msg.role === 'assistant' && msg.toolCalls?.length) {
        this.transcriptIndex.registerAssistantToolCalls(i, msg.toolCalls);
      }
    }

    this.resultCache.warmFromHistory(messages, this.transcriptIndex);

    // ── G2a-6: Initialize ContextGraph (graph path only) ─────────────────
    // The graph is rebuilt each step from the canonical `messages` array
    // immediately before serialization. This keeps the graph in sync with
    // mid-loop mutations (system prompt refresh, injected process prompts,
    // batch warnings, new user messages) without tracking them twice.
    const graphFlagOn = isContextGraphEnabled();
    const useGraphPath = graphFlagOn && this.adapter.id === 'openai';
    if (graphFlagOn && !useGraphPath) {
      console.warn('[ContextGraph] Feature flag enabled but provider is not openai — falling back to legacy path.');
    }
    if (useGraphPath) {
      this.contextGraph = new ContextGraph();
    }
    // ─────────────────────────────────────────────────────────────────────

    // Wrap emit to absorb raw tool results into cache
    // toolCallArgsMap is populated before each tool execution round
    const toolCallArgsMap = new Map<string, Record<string, unknown>>();
    const wrappedEmit: typeof emit = (event) => {
      if (event.type === 'tool_result' && event.result && event.toolName && event.toolCallId) {
        const args = toolCallArgsMap.get(event.toolCallId) ?? {};
        this.resultCache!.absorbResult(
          event.toolName,
          args,
          event.result as ToolResult,
          steps,
        );
      }
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
          await this.contextManager.compactWithLLM(messages, inLoopCharBudget, this.resultCache ?? undefined);
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

        // --- Message Constructor: budget enforcement + tool name sanitization ---
        const injectedParams: string[] = [];
        if (canvasId) injectedParams.push('canvasId');
        const messageBuildInput = {
          messages,
          tools: availableTools,
          profile: this.profile,
          contextWindowTokens: effectiveCtx ?? 200000,
          cache: this.resultCache ?? undefined,
          transcriptIndex: this.transcriptIndex,
          injectedParams: injectedParams.length > 0 ? injectedParams : undefined,
          // reserveTokensForOutput defaults to 4096 inside buildMessagesForRequest
        };
        const { wireMessages: legacyWireMessages, wireTools: legacyWireTools, buildCtx } = buildMessagesForRequest(messageBuildInput);

        // G2b-1: When graph path is active, rebuild the graph from `messages`
        // and produce wireMessages + wireTools via the graph serializer.
        // The legacy path output is still computed above (for buildCtx) but
        // ignored when the flag is on.
        let wireMessages = legacyWireMessages;
        let wireTools = legacyWireTools;
        let graphReverseMap: Map<string, string> | undefined;
        if (useGraphPath && this.contextGraph) {
          this.rebuildGraphFromMessages(messages, steps);
          const graphToolsInput = injectedParams.length > 0
            ? availableTools.map((t) => stripInjectedParamsFromTool(t, injectedParams))
            : availableTools;
          const graphOut = serializeForOpenAI({
            graph: this.contextGraph,
            contextWindowTokens: effectiveCtx ?? 200000,
            tools: graphToolsInput,
            profile: this.profile,
            cache: this.resultCache ?? undefined,
          });
          wireMessages = graphOut.wireMessages;
          wireTools = graphOut.wireTools;
          graphReverseMap = graphOut.toolNameReverseMap;
        }

        const ctxWindow = effectiveCtx ?? 200000;
        const estimatedTokens = buildCtx.estimatedTokensUsed;

        // Cache tool schema serialization — only re-serialize when tool count changes
        if (availableTools.length !== this._lastToolCount) {
          this._lastToolSchemaJson = safeStringify(availableTools);
          this._lastToolSchemaChars = this._lastToolSchemaJson.length;
          this._lastToolCount = availableTools.length;
        }

        options?.onLLMRequest?.({
          step: steps,
          toolCount: availableTools.length,
          toolSchemaChars: this._lastToolSchemaChars,
          messageCount: wireMessages.length,
          messageChars: measureMessageChars(messages),
          systemPromptChars: systemPrompt.length,
          promptGuideChars: typeof context.extra?.promptGuides === 'string' ? context.extra.promptGuides.length : 0,
          estimatedTokensUsed: estimatedTokens,
          contextWindowTokens: ctxWindow,
          cacheChars: this.resultCache?.sizeChars ?? 0,
          cacheEntryCount: this.resultCache?.entryCount ?? 0,
          historyMessagesTrimmed: buildCtx.historyMessagesTrimmed,
          utilizationRatio: ctxWindow > 0 ? estimatedTokens / ctxWindow : 0,
        });

        // Clear previous thinking before new LLM call
        wrappedEmit({ type: 'thinking', content: '' });

        const rawResult = await this.completeWithRetry(wireMessages, {
          tools: wireTools.length > 0 ? wireTools : undefined,
          toolChoice: wireTools.length > 0 ? 'auto' : undefined,
          temperature: this.temperature,
          maxTokens: this.maxTokens,
        });

        // --- Message Destructor: un-sanitize tool names + dedup ---
        // When graph path is on, use the graph serializer's reverse map so
        // tool names sanitized by the graph path are un-sanitized correctly.
        const destructCtx = graphReverseMap
          ? { ...buildCtx, toolNameReverseMap: graphReverseMap }
          : buildCtx;
        lastResult = destructLLMResponse(rawResult, destructCtx);

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
          toolCallArgsMap.set(tc.id, tc.arguments as Record<string, unknown>);
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

        // Stub old cached messages + invalidate for mutations
        this.resultCache!.processRound(messages, steps, this.transcriptIndex);

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
        const utilizationRatio = buildCtx.estimatedTokensUsed / ctxTokens;
        if (utilizationRatio > 0.90) {
          // Critical: full compaction (Phase 1 + Phase 2 LLM summarization)
          await this.contextManager.compactWithLLM(messages, inLoopCharBudget, this.resultCache ?? undefined);
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
      this.activeMessages = null;
      this.resultCache = null;
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
   *     TranscriptIndex + ToolResultCache, so `(toolKey, paramsHash)` is stable.
   *   - For seeded/historical tool messages without known args (e.g. rehydrated
   *     from a resumed session), the `toolCallId` is folded into `paramsHash`
   *     to give each message a unique identity (no accidental dedup).
   */
  private rebuildGraphFromMessages(messages: LLMMessage[], step: number): void {
    if (!this.contextGraph) return;
    this.contextGraph = new ContextGraph();
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
        this.contextGraph.add({
          kind: 'tool-result',
          itemId: freshContextItemId(),
          producedAtStep: step,
          toolKey,
          paramsHash,
          content: m.content,
          schemaVersion: 1,
          toolCallId: m.toolCallId,
        } satisfies ContextItem);
      }
    }
  }
}
