import { createHash } from 'node:crypto';
import {
  toolRefKey,
  type CommanderContextCache,
  type CommanderContextCacheRun,
  type CommanderErrorCode,
  type CommanderRunRecord,
  type PublicContextFact,
  type PublicContextItem,
  type PublicToolArtifact,
  type TimelineEvent,
} from '@lucid-fin/contracts';

export const PROJECTOR_VERSION = 1;

const EVENT_CHAIN_DOMAIN = 'commander-context-event-v1\0';
const TERMINAL_SUMMARIES = {
  completed: 'Run completed.',
  failed: 'Run failed.',
  blocked: 'Run blocked.',
  cancelled: 'Run cancelled.',
  max_steps: 'Run stopped at the execution limit.',
} as const;

export type EventContextRunHead = Pick<
  CommanderRunRecord,
  'id' | 'sessionId' | 'acceptedAt' | 'status' | 'intent'
>;

export interface EventContextProjectionRun {
  readonly run: EventContextRunHead;
  readonly events: readonly TimelineEvent[];
}

export interface EventContextProjectionInput {
  readonly sessionId: string;
  readonly runs: readonly EventContextProjectionRun[];
}

export type CanonicalJsonValue =
  | null
  | boolean
  | number
  | string
  | readonly CanonicalJsonValue[]
  | { readonly [key: string]: CanonicalJsonValue | undefined };

type ToolCallEvent = Extract<TimelineEvent, { kind: 'tool_call' }>;
type ToolResultEvent = Extract<TimelineEvent, { kind: 'tool_result' }>;
type TerminalStatus = Extract<TimelineEvent, { kind: 'run_end' }>['status'];

function canonicalJsonInternal(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Canonical JSON does not support non-finite numbers');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJsonInternal(entry)).join(',')}]`;
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const fields = Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJsonInternal(record[key])}`);
    return `{${fields.join(',')}}`;
  }
  throw new Error(`Canonical JSON does not support ${typeof value}`);
}

export function canonicalJson(value: CanonicalJsonValue): string {
  return canonicalJsonInternal(value);
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function sha256CanonicalJson(value: CanonicalJsonValue): string {
  return sha256(canonicalJson(value));
}

export function hashEventChain(events: readonly TimelineEvent[]): string {
  if (events.length === 0) throw new Error('Cannot hash an empty Commander event chain');
  let hash = '';
  events.forEach((event, index) => {
    const fact = canonicalJson(event as unknown as CanonicalJsonValue);
    hash = sha256(index === 0 ? EVENT_CHAIN_DOMAIN + fact : `${hash}\0${fact}`);
  });
  return hash;
}

export function hashCommanderContextProjection(
  envelope: Omit<CommanderContextCache, 'projectionHash'>,
): string {
  return sha256CanonicalJson(envelope as unknown as CanonicalJsonValue);
}

function compareRuns(left: EventContextProjectionRun, right: EventContextProjectionRun): number {
  if (left.run.acceptedAt !== right.run.acceptedAt) {
    return left.run.acceptedAt < right.run.acceptedAt ? -1 : 1;
  }
  return left.run.id < right.run.id ? -1 : left.run.id > right.run.id ? 1 : 0;
}

function validateEventSequence(runId: string, events: readonly TimelineEvent[]): void {
  if (events.length === 0) throw new Error(`Commander run "${runId}" has no events`);
  events.forEach((event, expectedSeq) => {
    if (event.runId !== runId) {
      throw new Error(
        `Invalid event sequence for run "${runId}": received event for ${event.runId} at seq ${event.seq}`,
      );
    }
    if (event.seq !== expectedSeq) {
      throw new Error(
        `Invalid event sequence for run "${runId}": expected seq ${expectedSeq}, received ${event.seq}`,
      );
    }
  });
}

function resultFactKey(toolCallId: string, toolResultSeq: number): string {
  return `${toolCallId}\0${toolResultSeq}`;
}

function cloneFacts(facts: readonly PublicContextFact[]): PublicContextFact[] {
  return facts.map((fact) => ({ ...fact }));
}

function cloneArtifacts(artifacts: readonly PublicToolArtifact[]): PublicToolArtifact[] {
  return artifacts.map((artifact) =>
    artifact.kind === 'checklist'
      ? { ...artifact, items: artifact.items.map((item) => ({ ...item })) }
      : { ...artifact },
  );
}

function terminalErrorCode(
  status: TerminalStatus,
  lastFailedToolCode: CommanderErrorCode | undefined,
): CommanderErrorCode | undefined {
  if (status === 'cancelled') return 'RUN_CANCELLED';
  if (status === 'max_steps') return 'RUN_MAX_STEPS';
  return status === 'failed' ? lastFailedToolCode : undefined;
}

function indexRunEvents(runId: string, events: readonly TimelineEvent[]) {
  const toolCalls = new Map<string, ToolCallEvent>();
  const toolResults = new Map<number, ToolResultEvent>();

  for (const event of events) {
    if (event.kind === 'tool_call' && !toolCalls.has(event.toolCallId)) {
      toolCalls.set(event.toolCallId, event);
    } else if (event.kind === 'tool_result') {
      toolResults.set(event.seq, event);
    } else if (event.kind === 'context_fact' && event.completeness === 'unavailable') {
      throw new Error(`Unavailable context_fact in run "${runId}" at seq ${event.seq}`);
    }
  }

  const factsByResult = new Map<string, PublicContextFact[]>();
  for (const event of events) {
    if (event.kind !== 'context_fact' || event.source.kind !== 'tool_result') continue;
    const result = toolResults.get(event.source.toolResultSeq);
    if (!result || result.toolCallId !== event.source.toolCallId) {
      throw new Error(
        `context_fact in run "${runId}" at seq ${event.seq} does not match tool result ${event.source.toolCallId}/${event.source.toolResultSeq}`,
      );
    }
    const key = resultFactKey(event.source.toolCallId, event.source.toolResultSeq);
    const facts = factsByResult.get(key) ?? [];
    facts.push(...event.facts);
    factsByResult.set(key, facts);
  }

  return { factsByResult, toolCalls };
}

function projectRun(source: EventContextProjectionRun): CommanderContextCacheRun {
  const { run, events } = source;
  validateEventSequence(run.id, events);
  const { factsByResult, toolCalls } = indexRunEvents(run.id, events);
  const items: PublicContextItem[] = [];
  const hasUserMessage = events.some((event) => event.kind === 'user_message');
  const hasRunInputContext = events.some(
    (event) => event.kind === 'context_fact' && event.source.kind === 'run_input',
  );
  let legacyInputAdded = false;
  let assistantAttempt:
    | { step: number; item: Extract<PublicContextItem, { kind: 'assistant_text' }> | undefined }
    | undefined;
  let lastFailedToolCode: CommanderErrorCode | undefined;

  for (const event of events) {
    if (assistantAttempt && event.step !== assistantAttempt.step) assistantAttempt = undefined;

    switch (event.kind) {
      case 'run_start':
        if (!hasUserMessage && !hasRunInputContext && !legacyInputAdded) {
          items.push({ kind: 'user_input', runId: run.id, seq: event.seq, content: event.intent });
          legacyInputAdded = true;
        }
        break;
      case 'user_message':
        items.push({ kind: 'user_input', runId: run.id, seq: event.seq, content: event.content });
        break;
      case 'assistant_text': {
        if (!assistantAttempt || assistantAttempt.step !== event.step) {
          assistantAttempt = { step: event.step, item: undefined };
        }
        if (!event.isDelta) {
          if (assistantAttempt.item) {
            assistantAttempt.item.content = event.content;
          } else {
            assistantAttempt.item = {
              kind: 'assistant_text',
              runId: run.id,
              step: event.step,
              content: event.content,
            };
            items.push(assistantAttempt.item);
          }
        }
        break;
      }
      case 'phase_note':
        if (event.note === 'llm_retry' && assistantAttempt?.item) {
          const index = items.indexOf(assistantAttempt.item);
          if (index >= 0) items.splice(index, 1);
          assistantAttempt = undefined;
        } else if (event.note === 'llm_retry') {
          assistantAttempt = undefined;
        }
        break;
      case 'context_fact':
        if (event.source.kind === 'run_input') {
          items.push({
            kind: 'run_context',
            runId: run.id,
            seq: event.seq,
            facts: cloneFacts(event.facts),
          });
        }
        break;
      case 'tool_result': {
        if (event.status === 'failed' && event.errorCode) lastFailedToolCode = event.errorCode;
        const call = toolCalls.get(event.toolCallId);
        if (!call) break;
        const facts = factsByResult.get(resultFactKey(event.toolCallId, event.seq));
        items.push({
          kind: 'tool_observation',
          runId: run.id,
          toolCallId: event.toolCallId,
          toolName: toolRefKey(call.toolRef),
          status: event.status === 'failed' ? 'failed' : 'completed',
          ...(event.summary ?? call.summary ? { summary: event.summary ?? call.summary } : {}),
          ...(event.details ?? call.details
            ? { details: { ...(event.details ?? call.details) } }
            : {}),
          ...(event.artifacts ? { artifacts: cloneArtifacts(event.artifacts) } : {}),
          ...(facts?.length ? { contextFacts: cloneFacts(facts) } : {}),
        });
        break;
      }
      case 'question_prompt':
        items.push({
          kind: 'interaction',
          runId: run.id,
          seq: event.seq,
          interaction: 'question',
          content: event.prompt,
        });
        break;
      case 'user_answer':
        items.push({
          kind: 'interaction',
          runId: run.id,
          seq: event.seq,
          interaction: 'answer',
          content: event.answer,
        });
        break;
      case 'user_confirmation':
        items.push({
          kind: 'interaction',
          runId: run.id,
          seq: event.seq,
          interaction: 'confirmation',
          content: event.approved ? 'Approved' : 'Declined',
        });
        break;
      case 'run_end': {
        const errorCode = terminalErrorCode(event.status, lastFailedToolCode);
        items.push({
          kind: 'terminal_summary',
          runId: run.id,
          status: event.status,
          summary: TERMINAL_SUMMARIES[event.status],
          ...(errorCode ? { errorCode } : {}),
        });
        break;
      }
      case 'catalog_frozen':
      case 'public_progress':
      case 'resource_usage':
      case 'resource_state':
      case 'run_paused':
      case 'run_resumed':
      case 'tool_call':
      case 'tool_confirm_prompt':
      case 'cancelled':
        break;
      default: {
        const exhaustive: never = event;
        throw new Error(`Unhandled timeline event: ${String(exhaustive)}`);
      }
    }
  }

  return {
    runId: run.id,
    acceptedAt: run.acceptedAt,
    status: run.status,
    throughSeq: events[events.length - 1]!.seq,
    eventHash: hashEventChain(events),
    items,
  };
}

export function projectCommanderContext(
  input: EventContextProjectionInput,
): CommanderContextCache {
  const envelope: Omit<CommanderContextCache, 'projectionHash'> = {
    kind: 'commander_context_cache',
    version: 2,
    projectorVersion: PROJECTOR_VERSION,
    sessionId: input.sessionId,
    runs: [...input.runs].sort(compareRuns).map(projectRun),
  };
  return { ...envelope, projectionHash: hashCommanderContextProjection(envelope) };
}
