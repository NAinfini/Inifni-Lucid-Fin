import {
  COMMANDER_ERROR_CODES,
  PHASE_NOTE_CODES,
  type CommanderErrorCode,
  type PhaseNoteCode,
  type PublicContextFact,
  type PublicToolArtifact,
  type PublicToolDetails,
  type ResourceAmount,
  type ResourceRemaining,
  type RunBlocker,
  type RunResourceBudget,
  type RunResourceClock,
  type RunResourceRemainder,
  type RunResourceUsage,
  type TimelineEvent,
  type ToolRef,
} from '@lucid-fin/contracts';
import type { StampedStreamEvent, ToolRegistry } from '@lucid-fin/application';
import { PublicContextFactSchema } from '@lucid-fin/contracts-parse';

export type CommanderPublicProjectionState = Record<string, never>;

export function createCommanderPublicProjectionState(): CommanderPublicProjectionState {
  return {};
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function string(value: unknown, max = 240): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : undefined;
}

function number(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function integer(value: unknown): number | undefined {
  const parsed = number(value);
  return parsed !== undefined && Number.isInteger(parsed) ? parsed : undefined;
}

function publicDetails(value: unknown): PublicToolDetails | undefined {
  const source = record(value);
  if (!source) return undefined;
  const details: PublicToolDetails = {};
  for (const [key, item] of Object.entries(source).slice(0, 32)) {
    if (typeof item === 'string') details[key.slice(0, 80)] = item.slice(0, 240);
    else if (typeof item === 'number' && Number.isFinite(item)) details[key.slice(0, 80)] = item;
    else if (typeof item === 'boolean' || item === null) details[key.slice(0, 80)] = item;
  }
  return Object.keys(details).length ? details : undefined;
}

function publicArtifacts(value: unknown): PublicToolArtifact[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const artifacts: PublicToolArtifact[] = [];
  for (const candidate of value.slice(0, 32)) {
    const item = record(candidate);
    const kind = item?.kind;
    const id = string(item?.id, 160);
    if (!item || !id) continue;
    const label = string(item.label, 240);
    if (kind === 'checklist' && Array.isArray(item.items)) {
      const items: Extract<PublicToolArtifact, { kind: 'checklist' }>['items'] = [];
      for (const entry of item.items.slice(0, 200)) {
        const row = record(entry);
        const rowId = string(row?.id, 160);
        const rowLabel = string(row?.label, 240);
        const status = row?.status;
        if (
          rowId &&
          rowLabel &&
          (status === 'pending' || status === 'in_progress' || status === 'done')
        ) {
          items.push({ id: rowId, label: rowLabel, status });
        }
      }
      artifacts.push({ kind, id, ...(label ? { label } : {}), items });
    } else if (kind === 'asset') {
      const contentHash = string(item.contentHash, 160);
      const mediaType = item.mediaType;
      artifacts.push({
        kind,
        id,
        ...(label ? { label } : {}),
        ...(contentHash ? { contentHash } : {}),
        ...(mediaType === 'image' ||
        mediaType === 'video' ||
        mediaType === 'audio' ||
        mediaType === 'document'
          ? { mediaType }
          : {}),
      });
    } else if (kind === 'canvas_node') {
      const assetHash = string(item.assetHash, 160);
      artifacts.push({
        kind,
        id,
        ...(label ? { label } : {}),
        ...(assetHash ? { assetHash } : {}),
      });
    }
  }
  return artifacts.length ? artifacts : undefined;
}

function toolRef(value: unknown): ToolRef {
  const source = record(value);
  return {
    domain: string(source?.domain, 80) ?? 'unknown',
    action: string(source?.action, 120) ?? 'unknown',
    ...(integer(source?.version) !== undefined ? { version: integer(source?.version) } : {}),
  };
}

function toolName(ref: ToolRef): string {
  return `${ref.domain}.${ref.action}`;
}

function errorCode(value: unknown): CommanderErrorCode | undefined {
  return typeof value === 'string' &&
    (COMMANDER_ERROR_CODES as readonly string[]).includes(value)
    ? (value as CommanderErrorCode)
    : undefined;
}

function base(value: Record<string, unknown>) {
  return {
    runId: string(value.runId, 160) ?? 'unknown',
    step: integer(value.step) ?? 0,
    seq: integer(value.seq) ?? 0,
    emittedAt: integer(value.emittedAt) ?? 0,
  };
}

function publicParams(note: TimelineEvent & { kind: 'phase_note' }, value: unknown) {
  const source = record(value) ?? {};
  const allowed: Partial<Record<typeof note.note, readonly string[]>> = {
    llm_retry: ['attempt', 'totalAttempts', 'delayMs', 'stall'],
    tool_skipped_dedup: ['toolDomain', 'toolAction', 'priorStep', 'priorWasError'],
    compacted: ['phase', 'reloaded'],
    prompt_loaded: ['process'],
    max_steps_warning: ['step', 'maxSteps'],
  };
  const params: Record<string, string | number | boolean | null> = {};
  for (const key of allowed[note.note] ?? []) {
    const item = source[key];
    if (typeof item === 'string') params[key] = item.slice(0, 240);
    else if (typeof item === 'number' && Number.isFinite(item)) params[key] = item;
    else if (typeof item === 'boolean' || item === null) params[key] = item;
  }
  return params;
}

function safePublicProjection(value: unknown) {
  const source = record(value) ?? {};
  return {
    ...(string(source.summary) ? { summary: string(source.summary) } : {}),
    ...(publicDetails(source.details) ? { details: publicDetails(source.details) } : {}),
    ...(publicArtifacts(source.artifacts) ? { artifacts: publicArtifacts(source.artifacts) } : {}),
  };
}

function publicContextFacts(value: unknown): PublicContextFact[] {
  if (!Array.isArray(value)) throw new Error('context_fact facts must be an array');
  return value.map((fact) => PublicContextFactSchema.parse(fact));
}

function publicResourceBudget(value: unknown): RunResourceBudget {
  const source = record(value) ?? {};
  const budget: RunResourceBudget = {};
  const maxTokens = integer(source.maxTokens);
  const maxToolCalls = integer(source.maxToolCalls);
  const maxWallTimeMs = integer(source.maxWallTimeMs);
  const maxCostUsd = number(source.maxCostUsd);
  if (maxTokens !== undefined) budget.maxTokens = maxTokens;
  if (maxToolCalls !== undefined) budget.maxToolCalls = maxToolCalls;
  if (maxWallTimeMs !== undefined) budget.maxWallTimeMs = maxWallTimeMs;
  if (maxCostUsd !== undefined) budget.maxCostUsd = maxCostUsd;
  return budget;
}

function publicResourceAmount(value: unknown): ResourceAmount | undefined {
  const source = record(value);
  if (!source || typeof source.knowledge !== 'string') return undefined;
  if (source.knowledge === 'unknown') return { knowledge: 'unknown' };
  const amount = number(source.value);
  if (
    amount === undefined ||
    (source.knowledge !== 'known' && source.knowledge !== 'estimated')
  ) {
    return undefined;
  }
  return { knowledge: source.knowledge, value: amount };
}

function publicResourceRemaining(value: unknown): ResourceRemaining | undefined {
  const source = record(value);
  if (!source || typeof source.state !== 'string') return undefined;
  if (source.state === 'unlimited' || source.state === 'unknown') {
    return { state: source.state };
  }
  const amount = number(source.value);
  if (
    amount === undefined ||
    (source.state !== 'known' && source.state !== 'estimated')
  ) {
    return undefined;
  }
  return { state: source.state, value: amount };
}

function publicRunBlocker(value: unknown): RunBlocker | undefined {
  const source = record(value);
  if (!source || typeof source.kind !== 'string') return undefined;
  if (
    source.kind === 'resource_budget' &&
    (source.metric === 'tokens' ||
      source.metric === 'tool_calls' ||
      source.metric === 'wall_time' ||
      source.metric === 'cost') &&
    (source.reason === 'exhausted' || source.reason === 'unavailable')
  ) {
    return { kind: source.kind, metric: source.metric, reason: source.reason };
  }
  if (
    source.kind === 'safety_limit' &&
    (source.limit === 'context_window' ||
      source.limit === 'provider_limit' ||
      source.limit === 'recovery_required')
  ) {
    return { kind: source.kind, limit: source.limit };
  }
  return undefined;
}

function publicResourceUsage(value: unknown): RunResourceUsage | undefined {
  const source = record(value);
  const tokens = publicResourceAmount(source?.tokens);
  const costUsd = publicResourceAmount(source?.costUsd);
  const toolCalls = integer(source?.toolCalls);
  const wallTimeMs = integer(source?.wallTimeMs);
  if (!tokens || !costUsd || toolCalls === undefined || wallTimeMs === undefined) return undefined;
  return { tokens, toolCalls, wallTimeMs, costUsd };
}

function publicResourceRemainder(value: unknown): RunResourceRemainder | undefined {
  const source = record(value);
  const tokens = publicResourceRemaining(source?.tokens);
  const toolCalls = publicResourceRemaining(source?.toolCalls);
  const wallTimeMs = publicResourceRemaining(source?.wallTimeMs);
  const costUsd = publicResourceRemaining(source?.costUsd);
  if (!tokens || !toolCalls || !wallTimeMs || !costUsd) return undefined;
  return { tokens, toolCalls, wallTimeMs, costUsd };
}

function publicResourceClock(value: unknown): RunResourceClock | undefined {
  const source = record(value);
  const activeMs = integer(source?.activeMs);
  const changedAt = integer(source?.changedAt);
  if (
    !source ||
    (source.state !== 'active' &&
      source.state !== 'waiting_user' &&
      source.state !== 'paused' &&
      source.state !== 'stopped') ||
    activeMs === undefined ||
    changedAt === undefined
  ) {
    return undefined;
  }
  return { state: source.state, activeMs, changedAt };
}

function publicResourceState(
  value: Record<string, unknown>,
  stamp: { runId: string; step: number; seq: number; emittedAt: number },
): Extract<TimelineEvent, { kind: 'resource_state' }> | undefined {
  if (value.schemaVersion !== 1) return undefined;
  const sourceCause = record(value.cause);
  let cause: Extract<TimelineEvent, { kind: 'resource_state' }>['cause'];
  if (sourceCause?.kind === 'initialized') {
    cause = { kind: 'initialized' };
  } else if (
    (sourceCause?.kind === 'reserved' || sourceCause?.kind === 'settled') &&
    (sourceCause.source === 'model' || sourceCause.source === 'tool')
  ) {
    const operationId = string(sourceCause.operationId, 160);
    if (!operationId) return undefined;
    cause = { kind: sourceCause.kind, operationId, source: sourceCause.source };
  } else if (
    sourceCause?.kind === 'wait_started' ||
    sourceCause?.kind === 'wait_ended' ||
    sourceCause?.kind === 'pause_started' ||
    sourceCause?.kind === 'pause_ended'
  ) {
    cause = { kind: sourceCause.kind };
  } else if (sourceCause?.kind === 'boundary') {
    const blocker = publicRunBlocker(sourceCause.blocker);
    if (!blocker) return undefined;
    cause = { kind: 'boundary', blocker };
  } else {
    return undefined;
  }

  const usage = publicResourceUsage(value.usage);
  const remaining = publicResourceRemainder(value.remaining);
  const clock = publicResourceClock(value.clock);
  if (!usage || !remaining || !clock) return undefined;
  return { kind: 'resource_state', schemaVersion: 1, cause, usage, remaining, clock, ...stamp };
}

/**
 * Convert an internal or legacy Commander event into the only event shape
 * permitted to cross the main-process boundary. Raw fields are intentionally
 * never copied, and unregistered tools fail closed to identity/status only.
 */
export function projectCommanderPublicEvent(
  input: StampedStreamEvent | unknown,
  registry: Pick<ToolRegistry, 'get' | 'projectPublicCall'>,
  _state: CommanderPublicProjectionState,
): TimelineEvent | undefined {
  const value = record(input);
  const kind = value?.kind;
  if (!value || typeof kind !== 'string') return undefined;
  const stamp = base(value);

  switch (kind) {
    case 'run_start':
      return {
        kind,
        ...stamp,
        intent: string(value.intent, 8_000) ?? '',
        resourceBudget: publicResourceBudget(value.resourceBudget),
        workType:
          value.workType === 'subagent' || value.workType === 'tool_program'
            ? value.workType
            : 'agent',
        ...(string(value.parentRunId, 160)
          ? { parentRunId: string(value.parentRunId, 160) }
          : {}),
        ...(string(value.retryOfRunId, 160)
          ? { retryOfRunId: string(value.retryOfRunId, 160) }
          : {}),
        ...(string(value.displayName, 240)
          ? { displayName: string(value.displayName, 240) }
          : {}),
        ...(string(value.objective, 4_000)
          ? { objective: string(value.objective, 4_000) }
          : {}),
        ...(string(value.continuationOfRunId, 160)
          ? { continuationOfRunId: string(value.continuationOfRunId, 160) }
          : {}),
      };
    case 'run_paused':
    case 'run_resumed':
      return { kind, ...stamp };
    case 'catalog_frozen': {
      const tools = Array.isArray(value.tools)
        ? value.tools.flatMap((entry) => {
            const tool = record(entry);
            const name = string(tool?.name, 160);
            const description = string(tool?.description, 1_000);
            const tier = integer(tool?.tier);
            const inputSchemaHash = string(tool?.inputSchemaHash, 160);
            const outputSchemaHash = string(tool?.outputSchemaHash, 160);
            if (
              !name ||
              !description ||
              !inputSchemaHash ||
              !outputSchemaHash ||
              !tier ||
              tier > 4
            ) return [];
            return [{
              name,
              description,
              tier: tier as 1 | 2 | 3 | 4,
              tags: Array.isArray(tool?.tags)
                ? tool.tags.flatMap((tag) => string(tag, 80) ?? []).slice(0, 100)
                : [],
              contexts: Array.isArray(tool?.contexts)
                ? tool.contexts.flatMap((context) => string(context, 80) ?? []).slice(0, 100)
                : [],
              inputSchemaHash,
              outputSchemaHash,
            }];
          })
        : [];
      return {
        kind,
        ...stamp,
        catalogHash: string(value.catalogHash, 160) ?? '',
        tools,
      };
    }
    case 'run_end': {
      const status = value.status;
      if (
        status !== 'completed' &&
        status !== 'failed' &&
        status !== 'cancelled' &&
        status !== 'blocked' &&
        status !== 'max_steps'
      ) {
        return undefined;
      }
      const blocker = publicRunBlocker(value.blocker);
      const decision = record(value.exitDecision);
      const outcome = string(decision?.outcome, 160);
      const exitDecision = outcome
        ? {
            outcome,
            ...(string(decision?.contractId, 160)
              ? { contractId: string(decision?.contractId, 160) }
              : {}),
            ...(string(decision?.blocker, 240)
              ? { blocker: string(decision?.blocker, 240) }
              : {}),
          }
        : undefined;
      if (status === 'blocked') {
        if (!blocker) return undefined;
        return {
          kind,
          ...stamp,
          status,
          blocker,
          ...(exitDecision ? { exitDecision } : {}),
        };
      }
      return {
        kind,
        ...stamp,
        status,
        ...(exitDecision ? { exitDecision } : {}),
      };
    }
    case 'user_message':
      return { kind, ...stamp, content: typeof value.content === 'string' ? value.content : '' };
    case 'assistant_text':
      return {
        kind,
        ...stamp,
        content: typeof value.content === 'string' ? value.content : '',
        isDelta: value.isDelta === true,
      };
    case 'thinking':
      return {
        kind: 'public_progress',
        ...stamp,
        operationId: `model:${stamp.step}`,
        status: 'running',
      };
    case 'public_progress': {
      const status = value.status;
      if (status !== 'running' && status !== 'completed' && status !== 'failed') return undefined;
      return {
        kind,
        ...stamp,
        operationId: string(value.operationId, 160) ?? `model:${stamp.step}`,
        status,
        ...(string(value.summary) ? { summary: string(value.summary) } : {}),
      };
    }
    case 'resource_usage': {
      const promptTokens = integer(value.promptTokens);
      const completionTokens = integer(value.completionTokens);
      const reasoningTokens = integer(value.reasoningTokens);
      return {
        kind,
        ...stamp,
        operationId: string(value.operationId, 160) ?? `model:${stamp.step}`,
        source: 'model',
        ...(promptTokens !== undefined ? { promptTokens } : {}),
        ...(completionTokens !== undefined ? { completionTokens } : {}),
        ...(reasoningTokens !== undefined ? { reasoningTokens } : {}),
      };
    }
    case 'resource_state':
      return publicResourceState(value, stamp);
    case 'tool_call': {
      const ref = toolRef(value.toolRef);
      const args = record(value.args) ?? {};
      const name = toolName(ref);
      const configured = registry.get(name) !== undefined;
      const projected = value.args === undefined
        ? safePublicProjection(value)
        : configured
          ? safePublicProjection(registry.projectPublicCall(name, args))
          : {};
      return {
        kind,
        ...stamp,
        toolCallId: string(value.toolCallId, 160) ?? '',
        toolRef: ref,
        status: 'started',
        ...(projected.summary ? { summary: projected.summary } : {}),
        ...(projected.details ? { details: projected.details } : {}),
      };
    }
    case 'tool_confirm_prompt': {
      const ref = toolRef(value.toolRef);
      const args = record(value.args) ?? {};
      const name = toolName(ref);
      const configured = registry.get(name) !== undefined;
      const projected = value.args === undefined
        ? safePublicProjection(value)
        : configured
          ? safePublicProjection(registry.projectPublicCall(name, args))
          : {};
      return {
        kind,
        ...stamp,
        toolCallId: string(value.toolCallId, 160) ?? '',
        toolRef: ref,
        tier: integer(value.tier) ?? 1,
        status: 'awaiting_confirmation',
        ...(projected.summary ? { summary: projected.summary } : {}),
        ...(projected.details ? { details: projected.details } : {}),
      };
    }
    case 'tool_result': {
      const toolCallId = string(value.toolCallId, 160) ?? '';
      const projected = safePublicProjection(record(value.projection) ?? value);
      const code = errorCode(value.errorCode);
      const status =
        value.status === 'succeeded' || value.status === 'failed' || value.status === 'skipped'
          ? value.status
          : value.skipped === true
            ? 'skipped'
            : value.error !== undefined || code
              ? 'failed'
              : Object.prototype.hasOwnProperty.call(value, 'result')
                ? 'succeeded'
                : undefined;
      if (status !== 'succeeded' && status !== 'failed' && status !== 'skipped') {
        throw new Error('tool_result requires a normalized status');
      }
      const durationMs = number(value.durationMs);
      return {
        kind,
        ...stamp,
        toolCallId,
        status,
        ...(projected.summary ? { summary: projected.summary } : {}),
        ...(projected.details ? { details: projected.details } : {}),
        ...(projected.artifacts ? { artifacts: projected.artifacts } : {}),
        ...(code ? { errorCode: code } : {}),
        ...(durationMs !== undefined ? { durationMs } : {}),
        ...(value.skipped === true ? { skipped: true } : {}),
        ...(value.synthetic === true ? { synthetic: true } : {}),
      };
    }
    case 'context_fact': {
      const completeness = value.completeness;
      if (completeness !== 'complete' && completeness !== 'unavailable') {
        throw new Error('context_fact requires a valid completeness');
      }
      const facts = publicContextFacts(value.facts);
      if (completeness === 'complete' ? facts.length === 0 : facts.length !== 0) {
        throw new Error(`Invalid ${completeness} context_fact payload`);
      }
      const rawSource = record(value.source);
      const source = rawSource?.kind === 'run_input'
        ? { kind: 'run_input' as const }
        : rawSource?.kind === 'tool_result' &&
            string(rawSource.toolCallId, 160) &&
            integer(rawSource.toolResultSeq) !== undefined
          ? {
              kind: 'tool_result' as const,
              toolCallId: string(rawSource.toolCallId, 160)!,
              toolResultSeq: integer(rawSource.toolResultSeq)!,
            }
          : undefined;
      if (!source) throw new Error('context_fact requires a valid source');
      return {
        kind,
        ...stamp,
        schemaVersion: 1,
        source,
        completeness,
        facts,
      };
    }
    case 'user_confirmation':
      return {
        kind,
        ...stamp,
        toolCallId: string(value.toolCallId, 160) ?? '',
        approved: value.approved === true,
      };
    case 'question_prompt': {
      const options = Array.isArray(value.options)
        ? value.options.flatMap((entry) => {
            const option = record(entry);
            const id = string(option?.id, 160);
            const label = string(option?.label, 240);
            return id && label
              ? [{
                  id,
                  label,
                  ...(string(option?.description, 1_000) ? { description: string(option?.description, 1_000) } : {}),
                  ...(string(option?.previewAssetHash, 160) ? { previewAssetHash: string(option?.previewAssetHash, 160) } : {}),
                }]
              : [];
          })
        : undefined;
      return {
        kind,
        ...stamp,
        questionId: string(value.questionId, 160) ?? '',
        prompt: typeof value.prompt === 'string' ? value.prompt : '',
        ...(options?.length ? { options } : {}),
        allowFreeText: value.allowFreeText === true,
      };
    }
    case 'user_answer':
      return {
        kind,
        ...stamp,
        questionId: string(value.questionId, 160) ?? '',
        answer: typeof value.answer === 'string' ? value.answer : '',
        ...(string(value.selectedOptionId, 160) ? { selectedOptionId: string(value.selectedOptionId, 160) } : {}),
      };
    case 'phase_note': {
      if (!(PHASE_NOTE_CODES as readonly string[]).includes(String(value.note))) return undefined;
      const note = value.note as PhaseNoteCode;
      const event = { kind, ...stamp, note, params: {} } as TimelineEvent & { kind: 'phase_note' };
      return { ...event, params: publicParams(event, value.params) };
    }
    case 'cancelled': {
      const reason = value.reason;
      if (reason !== 'user' && reason !== 'timeout' && reason !== 'error') return undefined;
      return {
        kind,
        ...stamp,
        reason,
        completedToolCalls: integer(value.completedToolCalls) ?? 0,
        pendingToolCalls: integer(value.pendingToolCalls) ?? 0,
        ...(typeof value.partialContent === 'string' ? { partialContent: value.partialContent } : {}),
      };
    }
    default:
      return undefined;
  }
}
