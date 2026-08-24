/**
 * `commander/transport/CommanderTransport.ts` — v2 cutover.
 *
 * Thin IPC wrapper over the preload `api.commander` bridge. Knows nothing
 * about history, permissions, Redux, or session state.
 *
 * Post-cutover the wire is pure v2: every event is a `TimelineEvent` wrapped
 * in `WireEnvelope<TimelineEvent>` at the IPC boundary. `onStreamEnvelope`
 * returns the full envelope; consumers unwrap `envelope.event` as needed.
 */

import type {
  CommanderEventsHydrateResponse,
  CommanderRunRecord,
  CommanderRunControlRequest,
  CommanderRunControlResponse,
  CommanderRunTreeResponse,
  CommanderStartRequest,
  CommanderStartResponse,
  CommanderWireVersion,
  TimelineEvent,
  WireEnvelope,
} from '@lucid-fin/contracts';
import type { LucidAPI } from '../../utils/api.js';

type CommanderAPI = NonNullable<LucidAPI>['commander'];
type OptionalCommanderAPI = NonNullable<LucidAPI>['commander'] | undefined;

export type CommanderStreamEnvelope = WireEnvelope<TimelineEvent> & { sessionId: string };

export type CommanderCanvasUpdatedPayload = Parameters<
  Parameters<CommanderAPI['onCanvasDispatch']>[0]
>[0];
export type CommanderEntitiesUpdatedPayload = Parameters<
  NonNullable<Parameters<NonNullable<CommanderAPI['onEntitiesUpdated']>>[0]>
>[0];
export type CommanderSettingsDispatchPayload = Parameters<
  NonNullable<Parameters<NonNullable<CommanderAPI['onSettingsDispatch']>>[0]>
>[0];
export type CommanderToolActionResult = Awaited<ReturnType<CommanderAPI['toolDecision']>>;

export type Unsub = () => void;

export class CommanderTransport {
  constructor(private readonly api: OptionalCommanderAPI) {}

  get available(): boolean {
    return !!this.api;
  }

  async start(request: CommanderStartRequest): Promise<CommanderStartResponse> {
    if (!this.api) throw new Error('Commander IPC bridge unavailable');
    return this.api.start(request);
  }

  async cancel(runId: string): Promise<void> {
    if (!this.api) return;
    await this.api.cancel({ runId });
  }

  async cancelCurrentStep(runId: string): Promise<{ escalated: boolean }> {
    if (!this.api) return { escalated: false };
    return this.api.cancelStep({ runId });
  }

  async injectMessage(runId: string, message: string): Promise<void> {
    if (!this.api) return;
    await this.api.injectMessage({ runId, message });
  }

  async confirmTool(
    sessionId: string,
    runId: string,
    toolCallId: string,
    approved: boolean,
  ): Promise<CommanderToolActionResult> {
    if (!this.api) return { accepted: false, code: 'no_active_session' };
    return this.api.toolDecision({ sessionId, runId, toolCallId, approved });
  }

  async answerQuestion(
    sessionId: string,
    runId: string,
    toolCallId: string,
    answer: string,
  ): Promise<CommanderToolActionResult> {
    if (!this.api) return { accepted: false, code: 'no_active_session' };
    return this.api.toolAnswer({ sessionId, runId, toolCallId, answer });
  }

  async getRun(runId: string): Promise<CommanderRunRecord> {
    if (!this.api) throw new Error('Commander IPC bridge unavailable');
    return this.api.runGet({ runId });
  }

  async runControl(request: CommanderRunControlRequest): Promise<CommanderRunControlResponse> {
    if (!this.api) throw new Error('Commander IPC bridge unavailable');
    return this.api.runControl(request);
  }

  async runTree(sessionId: string): Promise<CommanderRunTreeResponse> {
    if (!this.api) throw new Error('Commander IPC bridge unavailable');
    return this.api.runTree({ sessionId });
  }

  async hydrate(
    runId: string,
    afterSeq: number,
  ): Promise<CommanderEventsHydrateResponse> {
    if (!this.api) throw new Error('Commander IPC bridge unavailable');
    return this.api.eventsHydrate({ runId, afterSeq });
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
    return this.api.onCanvasDispatch(cb);
  }

  onEntitiesUpdated(cb: (payload: CommanderEntitiesUpdatedPayload) => void): Unsub {
    if (!this.api?.onEntitiesUpdated) return () => {};
    return this.api.onEntitiesUpdated(cb) ?? (() => {});
  }

  onSettingsDispatch(cb: (payload: CommanderSettingsDispatchPayload) => void): Unsub {
    if (!this.api?.onSettingsDispatch) return () => {};
    return this.api.onSettingsDispatch(cb) ?? (() => {});
  }

}

export type { CommanderWireVersion };
