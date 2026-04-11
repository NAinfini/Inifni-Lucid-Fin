import type {
  LLMAdapter,
  LLMMessage,
  LLMCompletionResult,
  LLMToolDefinition,
  LLMToolParameter,
} from '@lucid-fin/contracts';
import { LucidError } from '@lucid-fin/contracts';
import type { AgentToolRegistry, ToolResult } from './tool-registry.js';

export interface AgentContext {
  page?: string;
  sceneId?: string;
  keyframeId?: string;
  segmentId?: string;
  characterId?: string;
  extra?: Record<string, unknown>;
}

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

/**
 * A single entry in the conversation history passed across turns.
 * Text-only entries (backward-compatible) have just role + content.
 * Rich entries include toolCalls (assistant role) or toolCallId (tool role).
 */
export type HistoryEntry =
  | { role: 'user' | 'assistant'; content: string; toolCalls?: Array<{ id: string; name: string; arguments: Record<string, unknown> }> }
  | { role: 'tool'; content: string; toolCallId: string };

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

const HISTORY_TOKEN_BUDGET = 200000;
const ESTIMATED_CHARS_PER_TOKEN = 4;
const HISTORY_CHAR_BUDGET = HISTORY_TOKEN_BUDGET * ESTIMATED_CHARS_PER_TOKEN;
const SMALL_RESULT_LIMIT = 500;
const COLLECTION_SUMMARY_CHAR_BUDGET = 4000;
const COLLECTION_MAX_ITEMS = 50;
const CONTEXT_EXTRA_VALUE_CHAR_LIMIT = 600;
const TOOL_DESCRIPTION_CHAR_LIMIT = 160;
const LIST_ACTION_PREFIXES = ['list', 'search'];
const MUTATION_ACTION_PREFIXES = [
  'add',
  'cancel',
  'clear',
  'connect',
  'create',
  'cut',
  'delete',
  'disconnect',
  'generate',
  'import',
  'move',
  'pause',
  'remove',
  'rename',
  'reorder',
  'restore',
  'resume',
  'retry',
  'save',
  'select',
  'set',
  'toggle',
  'update',
];
const SUMMARY_KEYS = [
  'id',
  'title',
  'name',
  'type',
  'status',
  'providerId',
  'nodeId',
  'canvasId',
  'characterId',
  'equipmentId',
  'locationId',
  'variantCount',
  'selectedVariantIndex',
] as const;

/** Tools always loaded regardless of discovery — the LLM gets these in every request. */
const ALWAYS_LOADED_TOOLS = [
  'tool.list', 'tool.get', 'commander.askUser',
  'canvas.getState', 'canvas.listNodes', 'canvas.getNode',
  'guide.list', 'guide.get',
] as const;

function needsConfirmation(tier: number, mode: string): boolean {
  if (mode === 'auto') return tier === 4;
  if (mode === 'strict') return tier >= 1;
  // normal: tier >= 3
  return tier >= 3;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function truncateString(value: string, maxLength = 160): string {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength - 3)}...`;
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return JSON.stringify({ success: false, error: 'Failed to serialize tool result' });
  }
}

function summarizeScalar(value: unknown): unknown {
  if (typeof value === 'string') {
    return truncateString(value);
  }
  return value;
}

function summarizeItemsWithinBudget(
  values: unknown[],
  maxItems: number,
  mapEntry: (entry: unknown) => unknown,
): unknown[] {
  const items: unknown[] = [];
  let totalChars = 0;

  for (const entry of values.slice(0, maxItems)) {
    const summary = mapEntry(entry);
    const summaryChars = safeStringify(summary).length;

    if (items.length > 0 && totalChars + summaryChars > COLLECTION_SUMMARY_CHAR_BUDGET) {
      break;
    }

    items.push(summary);
    totalChars += summaryChars;

    if (totalChars >= COLLECTION_SUMMARY_CHAR_BUDGET) {
      break;
    }
  }

  return items;
}

function summarizeValue(value: unknown, depth = 0): unknown {
  if (value == null || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'string') {
    return truncateString(value);
  }
  if (Array.isArray(value)) {
    return {
      count: value.length,
      items: summarizeItemsWithinBudget(value, 5, (entry) => summarizeValue(entry, depth + 1)),
    };
  }
  if (!isRecord(value)) {
    return String(value);
  }

  const summary: Record<string, unknown> = {};
  for (const key of SUMMARY_KEYS) {
    if (key in value && value[key] != null) {
      summary[key] = summarizeScalar(value[key]);
    }
  }

  if (Object.keys(summary).length > 0) {
    return summary;
  }

  const entries = Object.entries(value).slice(0, 6);
  for (const [key, entryValue] of entries) {
    if (depth >= 1) {
      summary[key] = summarizeScalar(
        typeof entryValue === 'string' || typeof entryValue === 'number' || typeof entryValue === 'boolean'
          ? entryValue
          : safeStringify(summarizeValue(entryValue, depth + 1)),
      );
      continue;
    }
    summary[key] = summarizeValue(entryValue, depth + 1);
  }

  return summary;
}

function summarizeCollection(value: unknown): unknown {
  if (Array.isArray(value)) {
    return {
      count: value.length,
      items: summarizeItemsWithinBudget(value, COLLECTION_MAX_ITEMS, (entry) => summarizeValue(entry)),
    };
  }

  if (isRecord(value)) {
    for (const key of ['items', 'results', 'nodes', 'edges', 'characters', 'equipment', 'locations', 'presets', 'tools', 'guides', 'episodes', 'snapshots', 'assets', 'prompts']) {
      if (Array.isArray(value[key])) {
        return {
          count: value[key].length,
          items: summarizeItemsWithinBudget(value[key], COLLECTION_MAX_ITEMS, (entry) => summarizeValue(entry)),
        };
      }
    }
  }

  return summarizeValue(value);
}

function pruneHistory(
  history: HistoryEntry[] | undefined,
): HistoryEntry[] {
  if (!history || history.length === 0) {
    return [];
  }

  const pruned: HistoryEntry[] = [];
  let totalChars = 0;

  for (let index = history.length - 1; index >= 0; index -= 1) {
    const entry = history[index];
    const entryChars = entry.content.length;

    if (pruned.length > 0 && totalChars + entryChars > HISTORY_CHAR_BUDGET) {
      break;
    }

    pruned.unshift(entry);
    totalChars += entryChars;

    if (totalChars >= HISTORY_CHAR_BUDGET) {
      break;
    }
  }

  // Ensure we don't start with a dangling tool result (role='tool') without its
  // preceding assistant message that contains the corresponding toolCalls.
  while (pruned.length > 0 && pruned[0].role === 'tool') {
    pruned.shift();
  }

  // If the first message is an assistant with toolCalls, ensure ALL referenced
  // tool results are present. LLM APIs require a tool result for every toolCall.
  // If any are missing (budget cut mid-group), drop the entire tool exchange.
  if (pruned.length > 0 && pruned[0].role === 'assistant') {
    const first = pruned[0] as { toolCalls?: Array<{ id: string }> };
    if (first.toolCalls && first.toolCalls.length > 0) {
      const requiredIds = new Set(first.toolCalls.map((tc) => tc.id));
      const presentIds = new Set(
        pruned
          .filter((e): e is { role: 'tool'; content: string; toolCallId: string } => e.role === 'tool')
          .map((e) => e.toolCallId),
      );
      const allPresent = [...requiredIds].every((id) => presentIds.has(id));
      if (!allPresent) {
        // Drop the assistant + any orphaned tool results until we hit a clean entry
        while (pruned.length > 0 && (pruned[0].role === 'assistant' || pruned[0].role === 'tool')) {
          const dropped = pruned.shift()!;
          if (dropped.role !== 'tool' && dropped.role !== 'assistant') break;
          if (dropped.role === 'assistant' && !(dropped as { toolCalls?: unknown[] }).toolCalls?.length) {
            // This is a clean assistant message without tool calls — put it back
            pruned.unshift(dropped);
            break;
          }
        }
      }
    }
  }

  return pruned;
}

function stringifyContextExtraValue(value: unknown): string {
  const serialized = typeof value === 'string' ? value : safeStringify(value);
  return truncateString(serialized, CONTEXT_EXTRA_VALUE_CHAR_LIMIT);
}

function compactToolParameter(parameter: LLMToolParameter): LLMToolParameter {
  const compacted: LLMToolParameter = {
    type: parameter.type,
    description: '',
  };

  if (parameter.enum?.length) {
    compacted.enum = [...parameter.enum];
  }
  if (parameter.properties) {
    compacted.properties = Object.fromEntries(
      Object.entries(parameter.properties).map(([key, value]) => [key, compactToolParameter(value)]),
    );
  }
  if (parameter.items) {
    compacted.items = compactToolParameter(parameter.items);
  }

  return compacted;
}

function compactNamedToolDefinitions(
  tools: AgentToolRegistry,
  toolNames: string[],
  contextPage?: string,
): LLMToolDefinition[] {
  const sourceTools = contextPage ? tools.forContext(contextPage) : tools.list();
  return sourceTools
    .filter((tool) => toolNames.includes(tool.name))
    .map((tool) => ({
      name: tool.name,
      description: truncateString(tool.description, TOOL_DESCRIPTION_CHAR_LIMIT),
      parameters: {
        type: 'object' as const,
        required: tool.parameters.required,
        properties: Object.fromEntries(
          Object.entries(tool.parameters.properties).map(([key, value]) => [key, compactToolParameter(value)]),
        ),
      },
    }));
}

function measureMessageChars(messages: LLMMessage[]): number {
  return messages.reduce((total, message) => total + message.content.length, 0);
}

function summarizeMutationResult(value: unknown): unknown {
  if (!isRecord(value)) {
    return summarizeValue(value);
  }

  const summary: Record<string, unknown> = {};
  for (const key of ['id', 'title', 'name', 'nodeTitle', 'nodeId', 'canvasId', 'characterId', 'equipmentId', 'locationId', 'status']) {
    if (key in value && value[key] != null) {
      summary[key] = summarizeScalar(value[key]);
    }
  }

  return Object.keys(summary).length > 0 ? summary : summarizeValue(value);
}

function summarizeToolResult(toolName: string, result: ToolResult): string {
  const serialized = safeStringify(result);
  if (serialized.length <= SMALL_RESULT_LIMIT) {
    return serialized;
  }

  const [, action = ''] = toolName.split('.');
  const summary =
    LIST_ACTION_PREFIXES.some((prefix) => action.startsWith(prefix)) || Array.isArray(result.data)
      ? { success: result.success, data: summarizeCollection(result.data) }
      : MUTATION_ACTION_PREFIXES.some((prefix) => action.startsWith(prefix))
        ? { success: result.success, data: summarizeMutationResult(result.data) }
        : {
            success: result.success,
            error: result.error,
            data: summarizeValue(result.data),
          };

  return safeStringify(summary);
}

export class AgentOrchestrator {
  private adapter: LLMAdapter;
  private tools: AgentToolRegistry;
  private resolvePrompt: (code: string) => string;
  private maxSteps: number;
  private temperature: number;
  private maxTokens: number;
  private pendingResolvers = new Map<string, (approved: boolean) => void>();
  private pendingQuestionResolvers = new Map<string, (answer: string) => void>();
  private activeMessages: LLMMessage[] | null = null;
  private _cancelled = false;

  constructor(
    adapter: LLMAdapter,
    tools: AgentToolRegistry,
    resolvePrompt: (code: string) => string,
    opts?: AgentOptions,
  ) {
    this.adapter = adapter;
    this.tools = tools;
    this.resolvePrompt = resolvePrompt;
    this.maxSteps = opts?.maxSteps ?? 50;
    this.temperature = opts?.temperature ?? 0.7;
    this.maxTokens = opts?.maxTokens ?? 200000;
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

  private injectedMessageCount = 0;

  injectMessage(content: string): void {
    const trimmed = content.trim();
    if (!trimmed || !this.activeMessages) {
      return;
    }
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
    const systemPrompt = this.buildSystemPrompt(context);
    const history = pruneHistory(options?.history);

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

    this.activeMessages = messages;
    this.injectedMessageCount = 0;
    this._cancelled = false;
    try {
      while (steps < this.maxSteps) {
        if (this._cancelled || options?.isAborted?.()) {
          emit({ type: 'done', content: 'Cancelled.' });
          return { content: 'Cancelled.', toolCalls: [], finishReason: 'stop' };
        }

        steps++;

        // Merge always-loaded + discovered tool names
        const activeToolNames = new Set(loadedToolNames);
        for (const name of discoveredToolNames) {
          activeToolNames.add(name);
        }
        const availableTools = compactNamedToolDefinitions(this.tools, Array.from(activeToolNames), context.page);

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

        // No tool calls, we're done.
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
          if (this._cancelled || options?.isAborted?.()) {
            emit({ type: 'done', content: 'Cancelled.' });
            return { content: 'Cancelled.', toolCalls: [], finishReason: 'stop' };
          }

          const tool = this.tools.get(tc.name);
          const tier = tool?.tier ?? 1;
          const mode = options?.permissionMode ?? 'normal';

          // Block unloaded tools — the LLM must call tool.get first
          if (tool && !activeToolNames.has(tc.name)) {
            const unloadedPayload = {
              success: false,
              error: `Tool '${tc.name}' exists but is not loaded. Call tool.get('${tc.name}') first to load its schema.`,
            };
            emit({
              type: 'tool_result',
              toolCallId: tc.id,
              toolName: tc.name,
              result: unloadedPayload,
            });
            messages.push({ role: 'tool', content: safeStringify(unloadedPayload), toolCallId: tc.id });
            continue;
          }

          if (tc.name === 'commander.askUser') {
            const question = typeof tc.arguments.question === 'string' ? tc.arguments.question : '';
            const rawOptions = Array.isArray(tc.arguments.options) ? tc.arguments.options : [];
            const questionOptions = rawOptions.map((opt: unknown) => {
              const option = opt as { label?: string; description?: string };
              return { label: option.label ?? '', description: option.description };
            });

            emit({
              type: 'tool_question',
              toolName: tc.name,
              toolCallId: tc.id,
              question,
              options: questionOptions,
            });

            const answer = await new Promise<string>((resolve) => {
              this.pendingQuestionResolvers.set(tc.id, resolve);
            });

            const answerPayload = { success: true, data: { answer } };
            emit({
              type: 'tool_result',
              toolCallId: tc.id,
              toolName: tc.name,
              result: answerPayload,
            });
            messages.push({ role: 'tool', content: safeStringify(answerPayload), toolCallId: tc.id });
            continue;
          }

          if (needsConfirmation(tier, mode)) {
            emit({
              type: 'tool_confirm',
              toolName: tc.name,
              toolCallId: tc.id,
              arguments: tc.arguments,
              tier,
            });

            const approved = await new Promise<boolean>((resolve) => {
              this.pendingResolvers.set(tc.id, resolve);
            });

            if (!approved) {
              const skippedPayload = {
                success: false,
                error: 'Tool execution skipped by user',
              };
              emit({
                type: 'tool_result',
                toolCallId: tc.id,
                toolName: tc.name,
                result: skippedPayload,
              });
              messages.push({ role: 'tool', content: safeStringify(skippedPayload), toolCallId: tc.id });
              continue;
            }
          }

          const startedAt = Date.now();
          emit({
            type: 'tool_call',
            toolName: tc.name,
            toolCallId: tc.id,
            arguments: tc.arguments,
            startedAt,
          });

          let resultContent: string;
          try {
            const toolResult = await this.tools.execute(tc.name, tc.arguments);
            const completedAt = Date.now();
            resultContent = summarizeToolResult(tc.name, toolResult);
            // When tool.get succeeds, inject discovered tools for next iteration
            if (tc.name === 'tool.get' && toolResult.success && toolResult.data != null) {
              const data = toolResult.data;
              const items = Array.isArray(data) ? data : [data];
              for (const item of items) {
                if (isRecord(item) && typeof item.name === 'string' && this.tools.get(item.name)) {
                  discoveredToolNames.add(item.name);
                }
              }
            }
            emit({
              type: 'tool_result',
              toolCallId: tc.id,
              toolName: tc.name,
              result: toolResult,
              startedAt,
              completedAt,
            });
          } catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err);
            const completedAt = Date.now();
            resultContent = safeStringify({ success: false, error: errMsg });
            emit({
              type: 'error',
              toolCallId: tc.id,
              error: errMsg,
              startedAt,
              completedAt,
            });
          }

          messages.push({ role: 'tool', content: resultContent, toolCallId: tc.id });
        }

        // Check for user messages injected during tool execution.
        // These are already in the messages array (pushed by injectMessage).
        // Add a system hint so the LLM knows to address them in the next turn.
        if (this.injectedMessageCount > 0) {
          const count = this.injectedMessageCount;
          this.injectedMessageCount = 0;
          messages.push({
            role: 'system',
            content: `[${count} new user message${count > 1 ? 's were' : ' was'} received while you were working. Check the latest user messages above and address them before continuing your current task.]`,
          });
        }
      }

      // Reached maxSteps — notify the user explicitly
      const pendingToolCalls = lastResult.toolCalls.length;
      const limitMsg = pendingToolCalls > 0
        ? `⚠️ Reached the step limit (${this.maxSteps} steps). ${pendingToolCalls} pending tool call(s) were not executed. You can increase "Max Steps" in Settings → Commander, or send a follow-up message to continue.`
        : `Reached the step limit (${this.maxSteps} steps). You can increase "Max Steps" in Settings → Commander if needed.`;
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

  private buildSystemPrompt(context: AgentContext): string {
    // Core prompt — always included, kept short
    let prompt = this.resolvePrompt('agent-system');

    // Append context
    const contextLines: string[] = [];
    if (context.page) contextLines.push(`Current page: ${context.page}`);
    if (context.sceneId) contextLines.push(`Active scene ID: ${context.sceneId}`);
    if (context.keyframeId) contextLines.push(`Active keyframe ID: ${context.keyframeId}`);
    if (context.segmentId) contextLines.push(`Active segment ID: ${context.segmentId}`);
    if (context.characterId) contextLines.push(`Active character ID: ${context.characterId}`);
    if (context.extra) {
      for (const [k, v] of Object.entries(context.extra)) {
        contextLines.push(`${k}: ${stringifyContextExtraValue(v)}`);
      }
    }
    if (contextLines.length > 0) {
      prompt += `\n\n## Current Context\n${contextLines.join('\n')}`;
    }

    return prompt;
  }
}
