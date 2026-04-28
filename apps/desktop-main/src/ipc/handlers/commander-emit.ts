/**
 * Commander event emission helpers.
 *
 * The orchestrator stamps every event with `runId`/`step`/`seq`/`emittedAt`
 * via `makeStampedEmit`, producing a `TimelineEvent`. This module wraps the
 * event in a `WireEnvelope` and forwards it to the typed renderer gateway,
 * adds structured logging, and fires companion canvas / entities dispatch
 * channels when a mutating `tool_result` lands.
 *
 * `ToolResultEvent` no longer carries `toolRef` (see Phase A invariant freeze
 * in timeline-event.ts). We maintain a per-handler map of
 * `toolCallId → toolName` populated on `tool_call` so companion dispatch can
 * resolve the tool name when the matching result arrives.
 */
import type { BrowserWindow } from 'electron';
import {
  commanderStreamChannel,
  commanderCanvasDispatchChannel,
  commanderEntitiesUpdatedChannel,
  type CommanderStreamPayload,
} from '@lucid-fin/contracts-parse';
import { COMMANDER_WIRE_VERSION } from '@lucid-fin/contracts';
import type { SessionId } from '@lucid-fin/contracts';
import type { CommanderEventRepository } from '@lucid-fin/storage';
import log from '../../logger.js';
import type { StampedStreamEvent } from '@lucid-fin/application';
import type { CanvasStore } from './canvas.handlers.js';
import {
  createRendererPushGateway,
  type RendererPushGateway,
} from '../../features/ipc/push-gateway.js';

export type { CommanderStreamPayload };

export function safeStringifyForLog(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function formatErrorDetail(error: unknown): string {
  if (error instanceof Error) {
    const lines: string[] = [];
    if (error.stack?.trim()) {
      lines.push(error.stack);
    } else {
      lines.push(`${error.name}: ${error.message}`);
    }

    const extended = error as Error & {
      code?: unknown;
      details?: unknown;
      cause?: unknown;
    };
    const extra: Record<string, unknown> = {};
    if (extended.code !== undefined) {
      extra.code = extended.code;
    }
    if (extended.details !== undefined) {
      const details = extended.details as Record<string, unknown>;
      const { responseText: _responseText, requestBody: _requestBody, responseBody: _responseBody, ...compactDetails } = details;
      extra.details = compactDetails;
    }
    if (extended.cause !== undefined) {
      extra.cause = extended.cause;
    }

    if (Object.keys(extra).length > 0) {
      lines.push(safeStringifyForLog(extra));
    }

    return lines.join('\n');
  }

  return typeof error === 'string' ? error : safeStringifyForLog(error);
}

export function createEmitHandler(
  getWindow: () => BrowserWindow | null,
  canvasId: string,
  canvasStore: CanvasStore,
  mutatingToolNames: ReadonlySet<string>,
  entityMutatingToolNames: ReadonlySet<string>,
  pushGateway?: RendererPushGateway,
  persistence?: {
    sessionId: SessionId | null;
    eventRepo: CommanderEventRepository;
  },
): (event: StampedStreamEvent) => void {
  const gateway = pushGateway ?? createRendererPushGateway({ getWindow });
  const toolNameByCallId = new Map<string, string>();

  return (event: StampedStreamEvent) => {
    gateway.emit(commanderStreamChannel, {
      wireVersion: COMMANDER_WIRE_VERSION,
      event,
    });

    // Phase 5: persist the event to the commander_events table so the
    // renderer can rehydrate the timeline on next session resume. We
    // swallow write errors (same philosophy as ContextGraph side-channel
    // saves — a persistence failure must never abort a live run).
    if (persistence?.sessionId) {
      try {
        persistence.eventRepo.append({
          sessionId: persistence.sessionId,
          runId: event.runId,
          seq: event.seq,
          kind: event.kind,
          step: event.step,
          emittedAt: event.emittedAt,
          payload: JSON.stringify(event),
        });
      } catch (err) {
        log.warn('Commander event persist failed', {
          category: 'commander',
          sessionId: persistence.sessionId,
          runId: event.runId,
          seq: event.seq,
          detail: err instanceof Error ? err.message : String(err),
        });
      }
    }

    switch (event.kind) {
      case 'tool_call': {
        const toolName = `${event.toolRef.domain}.${event.toolRef.action}`;
        toolNameByCallId.set(event.toolCallId, toolName);
        log.debug(`Tool: ${toolName}`, {
          category: 'commander',
          toolName,
          toolCallId: event.toolCallId,
          detail: event.args ? JSON.stringify(event.args, null, 2) : undefined,
        });
        break;
      }
      case 'tool_result': {
        const toolName = toolNameByCallId.get(event.toolCallId);
        const resultStr = event.result != null ? JSON.stringify(event.result, null, 2) : '';
        log.debug(`Result: ${toolName ?? event.toolCallId}`, {
          category: 'commander',
          toolName,
          toolCallId: event.toolCallId,
          detail: resultStr || undefined,
        });
        if (event.error) {
          log.error(event.error.code, {
            category: 'commander',
            toolCallId: event.toolCallId,
            detail: `Tool call: ${event.toolCallId}`,
          });
        }
        break;
      }
      case 'run_end':
        log.info('Session complete', {
          category: 'commander',
          canvasId,
          status: event.status,
          outcome: event.exitDecision?.outcome,
        });
        break;
      case 'cancelled':
        log.info('Session cancelled', {
          category: 'commander',
          canvasId,
          reason: event.reason,
        });
        break;
      case 'phase_note':
        log.info(`Phase note: ${event.note}`, {
          category: 'commander',
          phaseNote: event.note,
          detail: event.params ? JSON.stringify(event.params) : undefined,
        });
        break;
      default:
        break;
    }

    if (event.kind === 'tool_result') {
      const toolName = toolNameByCallId.get(event.toolCallId);
      if (toolName && mutatingToolNames.has(toolName)) {
        const canvas = canvasStore.get(canvasId);
        if (canvas) {
          gateway.emit(commanderCanvasDispatchChannel, {
            canvasId,
            canvas,
          });
        }
      }
      if (toolName && entityMutatingToolNames.has(toolName)) {
        gateway.emit(commanderEntitiesUpdatedChannel, { toolName });
      }
      toolNameByCallId.delete(event.toolCallId);
    }
  };
}
