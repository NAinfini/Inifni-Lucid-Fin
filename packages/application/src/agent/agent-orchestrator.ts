import type {
  LLMAdapter,
  LLMMessage,
  LLMCompletionResult,
} from '@lucid-fin/contracts';
import { LucidError } from '@lucid-fin/contracts';
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

// Re-export types so consumers don't break
export type { AgentContext, HistoryEntry };

export interface AgentEvent {
  type: 'tool_call' | 'tool_result' | 'stream_chunk' | 'error' | 'done' | 'tool_confirm' | 'tool_question';
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
}

const HISTORY_CHAR_BUDGET_FALLBACK = Math.floor(200000 * ESTIMATED_CHARS_PER_TOKEN);

export class AgentOrchestrator {
  private adapter: LLMAdapter;
  private tools: AgentToolRegistry;
  private maxSteps: number;
  private temperature: number;
  private maxTokens: number;
  private pendingResolvers = new Map<string, (approved: boolean) => void>();
  private pendingQuestionResolvers = new Map<string, (answer: string) => void>();
  private activeMessages: LLMMessage[] | null = null;
  private _cancelled = false;

  private contextManager: ContextManager;
  private toolExecutor: ToolExecutor;

  private injectedMessageCount = 0;

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

    this.contextManager = new ContextManager(adapter, resolvePrompt);
    this.toolExecutor = new ToolExecutor(tools);
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
    for (const [id, resolve] of this.pendingResolvers) {
      resolve(false);
      this.pendingResolvers.delete(id);
    }
    for (const [id, resolve] of this.pendingQuestionResolvers) {
      resolve('');
      this.pendingQuestionResolvers.delete(id);
    }
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
    const systemPrompt = this.contextManager.buildSystemPrompt(context);

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

    // 95% utilization ceiling
    const inLoopTokenBudget = effectiveCtx
      ? Math.floor(effectiveCtx * 0.95)
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

    this.activeMessages = messages;
    this.toolExecutor = new ToolExecutor(this.tools, { permissionMode: options?.permissionMode });

    // Compact history on load
    truncateOldToolResults(messages);
    this.injectedMessageCount = 0;
    this._cancelled = false;

    try {
      while (steps < this.maxSteps) {
        if (this._cancelled || options?.isAborted?.()) {
          emit({ type: 'done', content: 'Cancelled.' });
          return { content: 'Cancelled.', toolCalls: [], finishReason: 'stop' };
        }

        steps++;

        // Mid-loop compaction
        await this.contextManager.compactWithLLM(messages, inLoopCharBudget);

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

        options?.onLLMRequest?.({
          step: steps,
          toolCount: availableTools.length,
          toolSchemaChars: safeStringify(availableTools).length,
          messageCount: messages.length,
          messageChars: measureMessageChars(messages),
          systemPromptChars: systemPrompt.length,
          promptGuideChars: typeof context.extra?.promptGuides === 'string' ? context.extra.promptGuides.length : 0,
        });

        lastResult = await this.completeWithRetry(messages, {
          tools: availableTools.length > 0 ? availableTools : undefined,
          toolChoice: availableTools.length > 0 ? 'auto' : undefined,
          temperature: this.temperature,
          maxTokens: this.maxTokens,
        });

        if (lastResult.content) {
          emit({ type: 'stream_chunk', content: lastResult.content });
        }

        // No tool calls -- done.
        if (lastResult.toolCalls.length === 0 || lastResult.finishReason !== 'tool_calls') {
          const finalContent = lastResult.content || (lastResult.toolCalls.length === 0 && steps > 1 ? 'Task completed.' : '');
          emit({ type: 'done', content: finalContent });
          return lastResult;
        }

        messages.push({
          role: 'assistant',
          content: lastResult.content,
          toolCalls: lastResult.toolCalls,
        });

        for (const tc of lastResult.toolCalls) {
          toolLastUsedStep.set(tc.name, steps);
        }

        // Delegate tool execution to ToolExecutor
        const { cancelled, dupMap } = await this.toolExecutor.executeToolCalls(
          lastResult.toolCalls,
          activeToolNames,
          discoveredToolNames,
          emit,
          messages,
          () => this._cancelled || (options?.isAborted?.() ?? false),
          this.pendingResolvers,
          this.pendingQuestionResolvers,
        );

        if (cancelled) {
          emit({ type: 'done', content: 'Cancelled.' });
          return { content: 'Cancelled.', toolCalls: [], finishReason: 'stop' };
        }

        // Push results for deduplicated tool calls
        for (const [dupId, firstId] of dupMap) {
          const firstResult = messages.find((m) => m.role === 'tool' && m.toolCallId === firstId);
          if (firstResult) {
            messages.push({ role: 'tool', content: firstResult.content, toolCallId: dupId });
          }
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
      emit({ type: 'done', content: finalContent });
      return lastResult;
    } finally {
      this.activeMessages = null;
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
}
