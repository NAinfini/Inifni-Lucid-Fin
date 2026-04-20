/**
 * Commander event emission helpers.
 *
 * The orchestrator stamps every event with `runId`/`step`/`emittedAt` via
 * `makeStampedEmit`, so the event it passes here already matches the
 * `commander:stream` wire schema one-to-one. This module just forwards the
 * event to the typed `RendererPushGateway`, adds structured logging, and
 * fires the companion canvas / entities dispatch channels when a mutating
 * tool_result lands.
 *
 * No mapping layer exists anymore. Any drift between the orchestrator's
 * emit shape and the wire schema is a compile error, caught at the import
 * of `CommanderStreamPayload` and the `StampedStreamEvent` alias above it.
 */
import type { BrowserWindow } from 'electron';
import {
  commanderStreamChannel,
  commanderCanvasDispatchChannel,
  commanderEntitiesUpdatedChannel,
  type CommanderStreamPayload,
} from '@lucid-fin/contracts-parse';
import log from '../../logger.js';
import type { StampedStreamEvent } from '@lucid-fin/application';
import type { CanvasStore } from './canvas.handlers.js';
import {
  createRendererPushGateway,
  type RendererPushGateway,
} from '../../features/ipc/push-gateway.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type { CommanderStreamPayload };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function safeStringifyForLog(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch { /* circular reference or non-serializable value — fall back to String() */
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
      // Strip bulky fields that bloat logs (raw HTML error pages, full request bodies)
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

// ---------------------------------------------------------------------------
// Emit handler
// ---------------------------------------------------------------------------

export function createEmitHandler(
  getWindow: () => BrowserWindow | null,
  canvasId: string,
  canvasStore: CanvasStore,
  mutatingToolNames: ReadonlySet<string>,
  entityMutatingToolNames: ReadonlySet<string>,
  pushGateway?: RendererPushGateway,
): (event: StampedStreamEvent) => void {
  const gateway = pushGateway ?? createRendererPushGateway({ getWindow });

  return (event: StampedStreamEvent) => {
    gateway.emit(commanderStreamChannel, event);

    // Structured logging — discriminator is `kind`, not `type`.
    switch (event.kind) {
      case 'tool_call_started':
        log.debug(`Tool: ${event.toolName}`, {
          category: 'commander',
          toolName: event.toolName,
          toolCallId: event.toolCallId,
        });
        break;
      case 'tool_call_args_complete':
        log.debug(`Tool args: ${event.toolCallId}`, {
          category: 'commander',
          toolCallId: event.toolCallId,
          detail: JSON.stringify(event.arguments, null, 2),
        });
        break;
      case 'tool_result': {
        const resultStr = event.result != null ? JSON.stringify(event.result, null, 2) : '';
        log.debug(`Result: ${event.toolName}`, {
          category: 'commander',
          toolName: event.toolName,
          toolCallId: event.toolCallId,
          detail: resultStr || undefined,
        });
        break;
      }
      case 'error':
        log.error(event.error, {
          category: 'commander',
          toolCallId: event.toolCallId,
          detail: event.toolCallId ? `Tool call: ${event.toolCallId}` : undefined,
        });
        break;
      case 'done':
        log.info('Session complete', {
          category: 'commander',
          canvasId,
          responseChars: event.content.length,
          hasContent: event.content.trim().length > 0,
        });
        break;
      case 'phase_note':
        log.info(`Phase note: ${event.note}`, {
          category: 'commander',
          phaseNote: event.note,
          detail: event.detail,
        });
        break;
      default:
        // Other kinds (chunk, thinking_delta, tool_call_args_delta,
        // tool_confirm, tool_question, context_usage) are high-volume /
        // low-signal — logging them would flood the debug log.
        break;
    }

    // Companion dispatches for mutating tools.
    if (event.kind === 'tool_result') {
      if (mutatingToolNames.has(event.toolName)) {
        const canvas = canvasStore.get(canvasId);
        if (canvas) {
          gateway.emit(commanderCanvasDispatchChannel, {
            canvasId,
            canvas,
          });
        }
      }
      if (entityMutatingToolNames.has(event.toolName)) {
        gateway.emit(commanderEntitiesUpdatedChannel, { toolName: event.toolName });
      }
    }
  };
}
