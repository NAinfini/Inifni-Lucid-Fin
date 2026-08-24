/**
 * Commander event emission boundary.
 *
 * Internal events may contain raw model/tool data needed during execution.
 * This boundary projects them to canonical public events before the existing
 * persist-then-broadcast path. Companion canvas/entity dispatch still derives
 * its authorization data transiently from the internal tool call.
 */
import type { BrowserWindow } from 'electron';
import {
  commanderStreamChannel,
  commanderCanvasDispatchChannel,
  commanderEntitiesUpdatedChannel,
  type CommanderStreamPayload,
} from '@lucid-fin/contracts-parse';
import { COMMANDER_WIRE_VERSION, type TimelineEvent } from '@lucid-fin/contracts';
import log from '../../logger.js';
import type { StampedStreamEvent, ToolRegistry } from '@lucid-fin/application';
import type { CanvasStore } from './canvas.handlers.js';
import {
  createRendererPushGateway,
  type RendererPushGateway,
} from '../../features/ipc/push-gateway.js';
import {
  createCommanderPublicProjectionState,
  projectCommanderPublicEvent,
} from './commander-public-event.js';
import {
  deriveCommanderRecoveryRecord,
  sealCommanderRecoveryBatch,
  type CommanderRecoveryCodec,
  type CommanderRecoverySupplement,
} from './commander-recovery.service.js';

export type { CommanderStreamPayload };

export interface CommanderPersistedEvent {
  event: TimelineEvent;
  privatePayload?: Buffer;
}

export interface CommanderInternalRecoveryEnvelope {
  event: StampedStreamEvent;
  recovery: CommanderRecoverySupplement;
}

type CommanderEmitInput = StampedStreamEvent | CommanderInternalRecoveryEnvelope;

export type CommanderEmitHandler = ((event: CommanderEmitInput) => void) & {
  batch(events: readonly CommanderEmitInput[]): void;
};

export function createEmitHandler(
  getWindow: () => BrowserWindow | null,
  sessionId: string,
  defaultCanvasId: string | undefined,
  authorizedCanvasIds: readonly string[],
  canvasStore: CanvasStore,
  tools: Pick<ToolRegistry, 'get' | 'projectPublicCall'>,
  mutatingToolNames: ReadonlySet<string>,
  entityMutatingToolNames: ReadonlySet<string>,
  pushGateway?: RendererPushGateway,
  persist?: (events: readonly CommanderPersistedEvent[]) => void,
  recovery?: { codec: CommanderRecoveryCodec; previousHash: string | null },
): CommanderEmitHandler {
  const gateway = pushGateway ?? createRendererPushGateway({ getWindow });
  const toolByCallId = new Map<
    string,
    { name: string; args: Record<string, unknown>; canvasId?: string }
  >();
  const publicProjection = createCommanderPublicProjectionState();
  let recoveryHead = recovery?.previousHash ?? null;

  const emitBatch = (inputs: readonly CommanderEmitInput[]): void => {
    if (inputs.length === 0) return;
    const events = inputs.map((input) => 'event' in input ? input.event : input);
    const supplements = inputs.map((input) => 'event' in input ? input.recovery : undefined);
    const stagedToolByCallId = new Map(toolByCallId);
    for (const event of events) {
      if (event.kind !== 'tool_call') continue;
      const name = `${event.toolRef.domain}.${event.toolRef.action}`;
      const requestedCanvasId =
        typeof event.args.canvasId === 'string' && authorizedCanvasIds.includes(event.args.canvasId)
          ? event.args.canvasId
          : undefined;
      stagedToolByCallId.set(event.toolCallId, {
        name,
        args: event.args,
        ...(requestedCanvasId ? { canvasId: requestedCanvasId } : {}),
      });
    }

    const publicEvents = events.map((event) => {
      const projected = projectCommanderPublicEvent(event, tools, publicProjection);
      if (!projected) throw new Error(`Unable to project Commander event: ${event.kind}`);
      return projected;
    });

    const sealed = recovery
      ? sealCommanderRecoveryBatch(
          recovery.codec,
          recoveryHead,
          publicEvents.map((event, index) => ({
            event,
            record: deriveCommanderRecoveryRecord(
              events[index]!,
              event,
              tools,
              supplements[index],
            ),
          })),
        )
      : undefined;
    persist?.(publicEvents.map((event, index) => ({
      event,
      ...(sealed?.privatePayloads[index]
        ? { privatePayload: sealed.privatePayloads[index] }
        : {}),
    })));
    if (sealed) recoveryHead = sealed.head;
    for (const publicEvent of publicEvents) {
      gateway.emit(commanderStreamChannel, {
        wireVersion: COMMANDER_WIRE_VERSION,
        sessionId,
        event: publicEvent,
      });
    }

    for (const publicEvent of publicEvents) {
      switch (publicEvent.kind) {
        case 'tool_call': {
          const toolName = `${publicEvent.toolRef.domain}.${publicEvent.toolRef.action}`;
          log.debug(`Tool: ${toolName}`, {
            category: 'commander',
            toolName,
            toolCallId: publicEvent.toolCallId,
            status: publicEvent.status,
          });
          break;
        }
        case 'tool_result': {
          const toolCall = stagedToolByCallId.get(publicEvent.toolCallId);
          const toolName = toolCall?.name;
          log.debug(`Result: ${toolName ?? publicEvent.toolCallId}`, {
            category: 'commander',
            toolName,
            toolCallId: publicEvent.toolCallId,
            status: publicEvent.status,
            durationMs: publicEvent.durationMs,
            errorCode: publicEvent.errorCode,
          });
          if (publicEvent.errorCode) {
            log.error(publicEvent.errorCode, {
              category: 'commander',
              toolCallId: publicEvent.toolCallId,
            });
          }
          if (
            publicEvent.status === 'succeeded' &&
            toolName &&
            toolCall?.canvasId &&
            mutatingToolNames.has(toolName)
          ) {
            const canvas = canvasStore.get(toolCall.canvasId);
            if (canvas) {
              gateway.emit(commanderCanvasDispatchChannel, {
                canvasId: toolCall.canvasId,
                canvas,
              });
            }
          }
          if (toolName && entityMutatingToolNames.has(toolName)) {
            gateway.emit(commanderEntitiesUpdatedChannel, { toolName });
          }
          stagedToolByCallId.delete(publicEvent.toolCallId);
          break;
        }
        case 'run_end':
          log.info('Session complete', {
            category: 'commander',
            defaultCanvasId,
            status: publicEvent.status,
            outcome: publicEvent.exitDecision?.outcome,
          });
          break;
        case 'cancelled':
          log.info('Session cancelled', {
            category: 'commander',
            defaultCanvasId,
            reason: publicEvent.reason,
          });
          break;
        case 'phase_note':
          log.info(`Phase note: ${publicEvent.note}`, {
            category: 'commander',
            phaseNote: publicEvent.note,
          });
          break;
        default:
          break;
      }
    }

    toolByCallId.clear();
    for (const [toolCallId, value] of stagedToolByCallId) toolByCallId.set(toolCallId, value);
  };

  const handler = ((event: CommanderEmitInput) => emitBatch([event])) as CommanderEmitHandler;
  handler.batch = emitBatch;
  return handler;
}
