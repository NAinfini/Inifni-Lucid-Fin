/**
 * `commander/transport/CommanderTransport.ts` — Phase E split-2.
 *
 * Thin IPC wrapper over the preload `api.commander` bridge. Knows nothing
 * about history, permissions, Redux, or session state. Its sole job is to
 * surface the renderer-side commander IPC surface as a typed object the
 * `CommanderSessionService` can drive.
 *
 * The preload bridge uses **positional** arguments for `commander:chat`
 * (see `apps/desktop-main/src/preload.cts:337`), so this wrapper preserves
 * that signature even though the generated `LucidAPI_Commander` interface
 * models it with a single-object request. That mismatch is handled by
 * Phase B's registry; until the renderer switches over, the transport
 * matches the live runtime shape.
 */

import type { LucidAPI } from '../../utils/api.js';

type CommanderAPI = NonNullable<LucidAPI>['commander'];
type OptionalCommanderAPI = NonNullable<LucidAPI>['commander'] | undefined;

export type CommanderStreamEvent = Parameters<
  Parameters<CommanderAPI['onStream']>[0]
>[0];
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

export type Unsub = () => void;

export class CommanderTransport {
  constructor(private readonly api: OptionalCommanderAPI) {}

  get available(): boolean {
    return !!this.api;
  }

  /**
   * Start a commander chat. Arguments mirror the current preload contract
   * (positional). The main process streams events back via `onStream`.
   */
  async chat(...args: CommanderChatArgs): Promise<unknown> {
    if (!this.api) throw new Error('Commander IPC bridge unavailable');
    return this.api.chat(...args);
  }

  async cancel(canvasId: string): Promise<void> {
    if (!this.api) return;
    await this.api.cancel(canvasId);
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

  onStream(cb: (payload: CommanderStreamEvent) => void): Unsub {
    if (!this.api) return () => {};
    return this.api.onStream(cb);
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
