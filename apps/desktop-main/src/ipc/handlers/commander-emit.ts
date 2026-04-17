/**
 * Commander event emission helpers.
 *
 * Maps AgentEvent → CommanderStreamPayload and sends to the renderer via
 * the typed `RendererPushGateway`. Also handles structured logging.
 *
 * Phase F-split-8a: the payload mapper for `commander:stream` now shapes
 * each variant to satisfy the strict discriminated-union schema in
 * `@lucid-fin/contracts-parse`. Optional `AgentEvent` fields that are
 * required in the schema (e.g. `content` on `chunk` / `thinking` / `done`;
 * `toolName` / `toolCallId` / `arguments` / `startedAt` / `completedAt` on
 * tool_* variants) are defaulted with sentinel values rather than left
 * `undefined`, so payload drift throws loudly in main instead of silently
 * in the renderer.
 */
import type { BrowserWindow } from 'electron';
import {
  commanderStreamChannel,
  commanderCanvasDispatchChannel,
  commanderEntitiesUpdatedChannel,
  type CommanderStreamPayload,
} from '@lucid-fin/contracts-parse';
import log from '../../logger.js';
import type { AgentEvent } from '@lucid-fin/application';
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
// AgentEvent → CommanderStreamPayload mapper
// ---------------------------------------------------------------------------

/**
 * Map an AgentEvent to the strict `commander:stream` discriminated-union
 * schema. Fields that are optional on AgentEvent but required in the
 * schema get default sentinels (empty string / 0 / empty object) so the
 * payload passes `parseStrict` without hiding the missing data.
 *
 * The defaults are deliberate: upstream emitters in
 * `agent-orchestrator.ts` always supply these fields for their respective
 * event types, so the sentinels are defensive padding, not real data.
 * If they ever start appearing in live streams that's a genuine upstream
 * bug worth surfacing — the gateway will then reject before send.
 */
function mapAgentEventToStreamPayload(event: AgentEvent): CommanderStreamPayload {
  switch (event.type) {
    case 'stream_chunk':
      return { type: 'chunk', content: event.content ?? '' };
    case 'tool_call':
      return {
        type: 'tool_call',
        toolName: event.toolName ?? '',
        toolCallId: event.toolCallId ?? '',
        arguments: event.arguments ?? {},
        startedAt: event.startedAt ?? 0,
      };
    case 'tool_result':
      return {
        type: 'tool_result',
        toolName: event.toolName ?? '',
        toolCallId: event.toolCallId ?? '',
        result: event.result,
        startedAt: event.startedAt ?? 0,
        completedAt: event.completedAt ?? 0,
      };
    case 'tool_confirm':
      return {
        type: 'tool_confirm',
        toolName: event.toolName ?? '',
        toolCallId: event.toolCallId ?? '',
        arguments: event.arguments ?? {},
        tier: event.tier ?? 0,
      };
    case 'tool_question':
      return {
        type: 'tool_question',
        toolName: event.toolName ?? '',
        toolCallId: event.toolCallId ?? '',
        question: event.question ?? '',
        options: event.options ?? [],
      };
    case 'thinking':
      return { type: 'thinking', content: event.content ?? '' };
    case 'done':
      return { type: 'done', content: event.content ?? '' };
    case 'error':
      return {
        type: 'error',
        toolCallId: event.toolCallId,
        error: event.error ?? '',
        startedAt: event.startedAt,
        completedAt: event.completedAt,
      };
  }
}

// ---------------------------------------------------------------------------
// Event → payload mapper + logging
// ---------------------------------------------------------------------------

export function createEmitHandler(
  getWindow: () => BrowserWindow | null,
  canvasId: string,
  canvasStore: CanvasStore,
  mutatingToolNames: ReadonlySet<string>,
  entityMutatingToolNames: ReadonlySet<string>,
  pushGateway?: RendererPushGateway,
): (event: AgentEvent) => void {
  const gateway = pushGateway ?? createRendererPushGateway({ getWindow });

  return (event: AgentEvent) => {
    const payload = mapAgentEventToStreamPayload(event);
    gateway.emit(commanderStreamChannel, payload);

    // Structured logging
    if (event.type === 'tool_call') {
      log.debug(`Tool: ${event.toolName}`, {
        category: 'commander',
        toolName: event.toolName,
        toolCallId: event.toolCallId,
        detail: event.arguments ? JSON.stringify(event.arguments, null, 2) : undefined,
      });
    } else if (event.type === 'tool_result') {
      const resultStr = event.result != null ? JSON.stringify(event.result, null, 2) : '';
      log.debug(`Result: ${event.toolName}`, {
        category: 'commander',
        toolName: event.toolName,
        toolCallId: event.toolCallId,
        detail: resultStr || undefined,
      });
    } else if (event.type === 'error') {
      log.error(event.error ?? 'Unknown error', {
        category: 'commander',
        toolCallId: event.toolCallId,
        detail: event.toolCallId ? `Tool call: ${event.toolCallId}` : undefined,
      });
    } else if (event.type === 'done') {
      log.info('Session complete', {
        category: 'commander',
        canvasId,
        responseChars: typeof event.content === 'string' ? event.content.length : 0,
        hasContent: typeof event.content === 'string' ? event.content.trim().length > 0 : false,
      });
    }

    // Dispatch canvas sync for mutating tools
    if (event.type === 'tool_result' && event.toolName && mutatingToolNames.has(event.toolName)) {
      const canvas = canvasStore.get(canvasId);
      if (canvas) {
        gateway.emit(commanderCanvasDispatchChannel, {
          canvasId,
          canvas,
        });
      }
    }

    // Dispatch entity sync for entity-mutating tools
    if (event.type === 'tool_result' && event.toolName && entityMutatingToolNames.has(event.toolName)) {
      gateway.emit(commanderEntitiesUpdatedChannel, { toolName: event.toolName });
    }
  };
}
