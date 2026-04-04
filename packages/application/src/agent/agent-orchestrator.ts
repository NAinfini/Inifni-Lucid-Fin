import type { LLMAdapter, LLMMessage, LLMCompletionResult } from '@lucid-fin/contracts';
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

export interface AgentExecutionOptions {
  history?: Array<{ role: 'user' | 'assistant'; content: string }>;
  isAborted?: () => boolean;
  permissionMode?: 'auto' | 'normal' | 'strict';
}

const HISTORY_TOKEN_BUDGET = 8000;
const ESTIMATED_CHARS_PER_TOKEN = 4;
const HISTORY_CHAR_BUDGET = HISTORY_TOKEN_BUDGET * ESTIMATED_CHARS_PER_TOKEN;
const SMALL_RESULT_LIMIT = 500;
const COLLECTION_SUMMARY_CHAR_BUDGET = 2000;
const CONTEXT_EXTRA_VALUE_CHAR_LIMIT = 2000;
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
      items: summarizeItemsWithinBudget(value, 10, (entry) => summarizeValue(entry)),
    };
  }

  if (isRecord(value)) {
    for (const key of ['items', 'results', 'nodes', 'characters', 'equipment', 'locations', 'presets']) {
      if (Array.isArray(value[key])) {
        return {
          count: value[key].length,
          items: summarizeItemsWithinBudget(value[key], 10, (entry) => summarizeValue(entry)),
        };
      }
    }
  }

  return summarizeValue(value);
}

function pruneHistory(
  history: Array<{ role: 'user' | 'assistant'; content: string }> | undefined,
): Array<{ role: 'user' | 'assistant'; content: string }> {
  if (!history || history.length === 0) {
    return [];
  }

  const pruned: Array<{ role: 'user' | 'assistant'; content: string }> = [];
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

  return pruned;
}

function stringifyContextExtraValue(value: unknown): string {
  const serialized = typeof value === 'string' ? value : safeStringify(value);
  return truncateString(serialized, CONTEXT_EXTRA_VALUE_CHAR_LIMIT);
}

function summarizeMutationResult(value: unknown): unknown {
  if (!isRecord(value)) {
    return summarizeValue(value);
  }

  const summary: Record<string, unknown> = {};
  for (const key of ['id', 'nodeId', 'canvasId', 'characterId', 'equipmentId', 'locationId', 'status']) {
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

  constructor(
    adapter: LLMAdapter,
    tools: AgentToolRegistry,
    resolvePrompt: (code: string) => string,
    opts?: AgentOptions,
  ) {
    this.adapter = adapter;
    this.tools = tools;
    this.resolvePrompt = resolvePrompt;
    this.maxSteps = opts?.maxSteps ?? 20;
    this.temperature = opts?.temperature ?? 0.7;
    this.maxTokens = opts?.maxTokens ?? 4096;
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

  injectMessage(content: string): void {
    const trimmed = content.trim();
    if (!trimmed || !this.activeMessages) {
      return;
    }
    this.activeMessages.push({ role: 'user', content: trimmed });
  }

  async execute(
    userMessage: string,
    context: AgentContext,
    emit: (event: AgentEvent) => void,
    options?: AgentExecutionOptions,
  ): Promise<LLMCompletionResult> {
    const systemPrompt = this.buildSystemPrompt(context);
    const availableTools = this.tools.toLLMTools(context.page);
    const history = pruneHistory(options?.history);

    const messages: LLMMessage[] = [
      { role: 'system', content: systemPrompt },
      ...history.map((entry) => ({
        role: entry.role,
        content: entry.content,
      })),
      { role: 'user', content: userMessage },
    ];

    let steps = 0;
    let lastResult: LLMCompletionResult = { content: '', toolCalls: [], finishReason: 'stop' };

    this.activeMessages = messages;
    try {
      while (steps < this.maxSteps) {
        if (options?.isAborted?.()) {
          emit({ type: 'done', content: 'Cancelled.' });
          return { content: 'Cancelled.', toolCalls: [], finishReason: 'stop' };
        }

        steps++;

        lastResult = await this.adapter.completeWithTools(messages, {
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
          emit({ type: 'done', content: lastResult.content });
          return lastResult;
        }

        messages.push({
          role: 'assistant',
          content: lastResult.content,
          toolCalls: lastResult.toolCalls,
        });

        for (const tc of lastResult.toolCalls) {
          if (options?.isAborted?.()) {
            emit({ type: 'done', content: 'Cancelled.' });
            return { content: 'Cancelled.', toolCalls: [], finishReason: 'stop' };
          }

          const tool = this.tools.get(tc.name);
          const tier = tool?.tier ?? 1;
          const mode = options?.permissionMode ?? 'normal';

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
      }

      emit({ type: 'done', content: lastResult.content || 'Reached maximum steps.' });
      return lastResult;
    } finally {
      this.activeMessages = null;
    }
  }

  private buildSystemPrompt(context: AgentContext): string {
    let prompt = this.resolvePrompt('agent-system');

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
