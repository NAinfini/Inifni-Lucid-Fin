/**
 * Commander event emission helpers.
 *
 * Maps AgentEvent → CommanderStreamPayload and sends to the renderer
 * via the BrowserWindow's webContents.  Also handles structured logging.
 */
import type { BrowserWindow } from 'electron';
import log from '../../logger.js';
import type { AgentEvent } from '@lucid-fin/application';
import type { CanvasStore } from './canvas.handlers.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CommanderStreamPayload = {
  type: 'chunk' | 'tool_call' | 'tool_result' | 'done' | 'error' | 'tool_confirm' | 'tool_question';
  content?: string;
  toolName?: string;
  toolCallId?: string;
  arguments?: Record<string, unknown>;
  result?: unknown;
  error?: string;
  tier?: number;
  question?: string;
  options?: Array<{ label: string; description?: string }>;
  startedAt?: number;
  completedAt?: number;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function emitToWindow(
  getWindow: () => BrowserWindow | null,
  channel: string,
  payload: unknown,
): void {
  const win = getWindow();
  if (!win || win.isDestroyed()) {
    return;
  }
  win.webContents.send(channel, payload);
}

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
// Event → payload mapper + logging
// ---------------------------------------------------------------------------

export function createEmitHandler(
  getWindow: () => BrowserWindow | null,
  canvasId: string,
  canvasStore: CanvasStore,
  mutatingToolNames: Set<string>,
  entityMutatingToolNames: Set<string>,
): (event: AgentEvent) => void {
  return (event: AgentEvent) => {
    const payload: CommanderStreamPayload =
      event.type === 'stream_chunk'
        ? { type: 'chunk', content: event.content }
        : event.type === 'tool_call'
          ? {
              type: 'tool_call',
              toolName: event.toolName,
              toolCallId: event.toolCallId,
              arguments: event.arguments,
              startedAt: event.startedAt,
            }
          : event.type === 'tool_result'
            ? {
                type: 'tool_result',
                toolName: event.toolName,
                toolCallId: event.toolCallId,
                result: event.result,
                startedAt: event.startedAt,
                completedAt: event.completedAt,
              }
            : event.type === 'tool_confirm'
              ? {
                  type: 'tool_confirm',
                  toolName: event.toolName,
                  toolCallId: event.toolCallId,
                  arguments: event.arguments,
                  tier: event.tier,
                }
              : event.type === 'tool_question'
                ? {
                    type: 'tool_question',
                    toolName: event.toolName,
                    toolCallId: event.toolCallId,
                    question: event.question,
                    options: event.options,
                  }
                : event.type === 'done'
                  ? { type: 'done', content: event.content }
                  : {
                      type: 'error',
                      toolCallId: event.toolCallId,
                      error: event.error,
                      startedAt: event.startedAt,
                      completedAt: event.completedAt,
                    };

    emitToWindow(getWindow, 'commander:stream', payload);

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
        emitToWindow(getWindow, 'commander:canvas:dispatch', {
          canvasId,
          canvas,
        });
      }
    }

    // Dispatch entity sync for entity-mutating tools
    if (event.type === 'tool_result' && event.toolName && entityMutatingToolNames.has(event.toolName)) {
      emitToWindow(getWindow, 'commander:entities:updated', { toolName: event.toolName });
    }
  };
}
