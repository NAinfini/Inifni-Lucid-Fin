/**
 * `commander/transport/CommanderTransport.ts` — v2 cutover.
 *
 * Thin IPC wrapper over the preload `api.commander` bridge. Knows nothing
 * about history, permissions, Redux, or session state.
 *
 * Post-cutover the wire is pure v2: every event is a `TimelineEvent` wrapped
 * in `WireEnvelope<TimelineEvent>` at the IPC boundary. `onStream` returns
 * the raw event (envelope unwrapped); `onStreamEnvelope` returns the full
 * envelope for consumers that need `wireVersion` provenance.
 */

import type {
  CommanderWireVersion,
  TimelineEvent,
  WireEnvelope,
} from '@lucid-fin/contracts';
import type { LucidAPI } from '../../utils/api.js';

type CommanderAPI = NonNullable<LucidAPI>['commander'];
type OptionalCommanderAPI = NonNullable<LucidAPI>['commander'] | undefined;

export type CommanderStreamEnvelope = WireEnvelope<TimelineEvent>;

export type CommanderCanvasUpdatedPayload = Parameters<
  Parameters<CommanderAPI['onCanvasUpdated']>[0]
>[0];
export type CommanderEntitiesUpdatedPayload = Parameters<
  NonNullable<Parameters<NonNullable<CommanderAPI['onEntitiesUpdated']>>[0]>
>[0];
export type CommanderSettingsDispatchPayload = Parameters<
  NonNullable<Parameters<NonNullable<CommanderAPI['onSettingsDispatch']>>[0]>
>[0];
export type CommanderUndoDispatchPayload = Parameters<
  NonNullable<Parameters<NonNullable<CommanderAPI['onUndoDispatch']>>[0]>
>[0];

export type CommanderChatArgs = Parameters<CommanderAPI['chat']>;
export type CommanderChatResult = Awaited<ReturnType<CommanderAPI['chat']>>;

export type Unsub = () => void;

export class CommanderTransport {
  constructor(private readonly api: OptionalCommanderAPI) {}

  get available(): boolean {
    return !!this.api;
  }

  async chat(...args: CommanderChatArgs): Promise<CommanderChatResult> {
    if (!this.api) throw new Error('Commander IPC bridge unavailable');
    return this.api.chat(...args);
  }

  async cancel(canvasId: string): Promise<void> {
    if (!this.api) return;
    await this.api.cancel(canvasId);
  }

  async cancelCurrentStep(canvasId: string): Promise<{ escalated: boolean }> {
    if (!this.api?.cancelCurrentStep) return { escalated: false };
    return this.api.cancelCurrentStep(canvasId);
  }

  async injectMessage(canvasId: string, message: string): Promise<void> {
    if (!this.api) return;
    await this.api.injectMessage(canvasId, message);
  }

  async confirmTool(canvasId: string, toolCallId: string, approved: boolean): Promise<void> {
    if (!this.api) return;
    await this.api.confirmTool(canvasId, toolCallId, approved);
  }

  async answerQuestion(canvasId: string, toolCallId: string, answer: string): Promise<void> {
    if (!this.api) return;
    await this.api.answerQuestion(canvasId, toolCallId, answer);
  }

  /**
   * Subscribe to stream events with envelope unwrapped. Most consumers use
   * this — only provenance-aware paths need the raw envelope.
   */
  onStream(cb: (event: TimelineEvent) => void): Unsub {
    return this.onStreamEnvelope((envelope) => cb(envelope.event));
  }

  /**
   * Subscribe to stream events with the full `WireEnvelope`. The preload
   * layer guarantees envelopes are well-formed; no defensive unwrap needed
   * post-cutover.
   */
  onStreamEnvelope(cb: (envelope: CommanderStreamEnvelope) => void): Unsub {
    if (!this.api) return () => {};
    return this.api.onStream(cb as (e: CommanderStreamEnvelope) => void);
  }

  onCanvasUpdated(cb: (payload: CommanderCanvasUpdatedPayload) => void): Unsub {
    if (!this.api) return () => {};
    return this.api.onCanvasUpdated(cb);
  }

  onEntitiesUpdated(cb: (payload: CommanderEntitiesUpdatedPayload) => void): Unsub {
    if (!this.api?.onEntitiesUpdated) return () => {};
    return this.api.onEntitiesUpdated(cb) ?? (() => {});
  }

  onSettingsDispatch(cb: (payload: CommanderSettingsDispatchPayload) => void): Unsub {
    if (!this.api?.onSettingsDispatch) return () => {};
    return this.api.onSettingsDispatch(cb) ?? (() => {});
  }

  onUndoDispatch(cb: (payload: CommanderUndoDispatchPayload) => void): Unsub {
    if (!this.api?.onUndoDispatch) return () => {};
    return this.api.onUndoDispatch(cb) ?? (() => {});
  }
}

export type { CommanderWireVersion };
