/**
 * `commander/service/CommanderSessionService.ts` — v2 cutover.
 *
 * Drives user-initiated Commander flows (start a turn, cancel, inject follow-up
 * messages) and forwards incoming timeline events into the v2 timeline slice.
 * Stream events are no longer normalized into the legacy `commanderSlice` —
 * UI consumers read directly from `commanderTimelineSlice.events`.
 *
 * Non-stream side-effects (canvas updates, settings pushes, entity
 * refreshes) still land on their dedicated slices — those channels are
 * orthogonal to the Commander timeline.
 */

import {
  ENTITY_REFRESH_TOOL_ENTITY,
  normalizeLLMProviderRuntimeConfig,
  type CommanderAttachmentInput,
  type CommanderRunIntent,
  type CommanderPromptGuide,
  type CommanderProcessBehaviorSettings,
  type PublicToolDetails,
} from '@lucid-fin/contracts';

export interface CommanderStartResources {
  attachments?: CommanderAttachmentInput[];
  selectedNodes?: Array<{ canvasId: string; nodeId: string }>;
  extraCanvasIds?: string[];
}

import type { AppDispatch, RootState } from '../../store/index.js';
import {
  addInjectedMessage,
  addUserMessage,
  updateRunPhase,
  appendFinalizedAssistantMessage,
  ensureActiveSession,
  finishStreaming,
  setProviderId,
  startStreaming,
  streamError,
} from '../../store/slices/commander.js';
import { applyCommanderCanvasSnapshot } from '../../store/slices/canvas/canvas.js';
import { setCharacters } from '../../store/slices/characters.js';
import { setEquipment } from '../../store/slices/equipment.js';
import { setLocations } from '../../store/slices/locations.js';
import {
  addCustomProvider,
  recordEntityCreate,
  recordError,
  recordPrompt,
  recordProjectActivity,
  recordShotCreate,
  recordToolCall,
  removeCustomProvider,
  setProviderBaseUrl,
  setProviderModel,
  setProviderName,
} from '../../store/slices/settings.js';
import { selectActiveSkills } from '../../store/slices/skillDefinitions.js';
import { addLog } from '../../store/slices/logger.js';
import { loadTaskLists } from '../../store/slices/task-lists.js';
import { flushPendingPersistence } from '../../store/middleware/persist.js';
import type { LucidAPI } from '../../utils/api.js';
import type {
  CommanderCanvasUpdatedPayload,
  CommanderEntitiesUpdatedPayload,
  CommanderSettingsDispatchPayload,
  CommanderTransport,
  Unsub,
} from '../transport/CommanderTransport.js';
import type { TimelineEvent } from '@lucid-fin/contracts';
import { appendEvent as appendTimelineEvent } from '../state/commander-timeline-slice.js';
import { selectEventsForRun } from '../state/commander-timeline-selectors.js';
import { buildFinalizedAssistantMessage } from '../state/run-derivation.js';
import { sanitizeCommanderMessages } from '../state/session-persistence.js';
import {
  incrementLLMRetry,
  incrementRunAbort,
  incrementStallWarning,
  incrementStepAbort,
} from './telemetry.js';

type CommanderEntityAPI = Pick<NonNullable<LucidAPI>, 'character' | 'equipment' | 'location'>;

/**
 * Map well-known runtime error strings (Electron IPC failures, AbortError
 * messages) to localized user-facing strings. Falls through to the raw
 * message when nothing matches — most backend errors are already
 * localization-keyed via CommanderError.
 */
function localizeRuntimeError(raw: string, t: (key: string) => string): string {
  if (/reply was never sent/i.test(raw)) return t('commander.runtimeError.ipcReplyNeverSent');
  if (/operation was aborted|the user aborted a request|AbortError/i.test(raw)) {
    return t('commander.runtimeError.operationAborted');
  }
  return t('commander.unknownError');
}

function selectCommanderPromptGuides(state: RootState): CommanderPromptGuide[] {
  const guides: CommanderPromptGuide[] = [];
  const seen = new Set<string>();

  for (const guide of selectActiveSkills(state.skillDefinitions.skills)) {
    if (seen.has(guide.id)) continue;
    seen.add(guide.id);
    guides.push(guide);
  }

  return guides;
}

export async function syncCommanderEntitiesForTool(
  api: CommanderEntityAPI | undefined,
  dispatch: AppDispatch,
  toolName?: string,
): Promise<void> {
  const toolDomain = toolName?.split('.')[0];
  if (toolDomain === 'character') {
    const list = await api?.character.list();
    if (Array.isArray(list)) {
      dispatch(setCharacters(list as import('@lucid-fin/contracts').Character[]));
    }
    return;
  }
  if (toolDomain === 'location') {
    const list = await api?.location.list();
    if (Array.isArray(list)) {
      dispatch(setLocations(list as import('@lucid-fin/contracts').Location[]));
    }
    return;
  }
  if (toolDomain === 'equipment') {
    const list = await api?.equipment.list();
    if (Array.isArray(list)) {
      dispatch(setEquipment(list as import('@lucid-fin/contracts').Equipment[]));
    }
  }
}

export interface CommanderSessionServiceDeps {
  transport: CommanderTransport;
  api: LucidAPI | undefined;
  dispatch: AppDispatch;
  getState: () => RootState;
  /** i18n translator — so the service can produce user-facing error strings. */
  t: (key: string) => string;
  /** Current locale — forwarded to the main-process commander handler. */
  getLocale: () => string;
}

export class CommanderSessionService {
  /** Maps in-flight public tool call metadata so result telemetry can be correlated. */
  private readonly toolCallNames = new Map<
    string,
    { name: string; details?: PublicToolDetails }
  >();

  constructor(private readonly deps: CommanderSessionServiceDeps) {}

  /**
   * Primary entry point for the UI: the user hit "send" or enqueued a message.
   * Includes all of the session-start preamble (ensureActiveSession,
   * auto-snapshot, canvas-save) and dispatches into the slice to reflect
   * user intent before hitting the IPC boundary.
   */
  async start(message: string, resources: CommanderStartResources = {}): Promise<boolean> {
    return this.startIntent({ kind: 'user_message', message }, resources);
  }

  async startIntent(
    intent: CommanderRunIntent,
    resources: CommanderStartResources = {},
  ): Promise<boolean> {
    const { dispatch, getState, t, getLocale, transport, api } = this.deps;
    const displayMessage =
      intent.kind === 'user_message' ? intent.message.trim() : intent.label.trim();
    if (!displayMessage) return false;

    let runAccepted = false;
    let hadActiveRun = false;
    let sessionId: string | null = getState().commander.activeSessionId;

    try {
      if (!transport.available) {
        throw new Error(t('commander.apiUnavailable'));
      }

      // Read fresh state to avoid stale closure values
      const state = getState();
      if (!state.settings.bootstrapped) {
        throw new Error(t('commander.backendNotReady'));
      }
      sessionId ??= crypto.randomUUID();
      const session =
        state.commander.sessions.find((candidate) => candidate.id === sessionId) ?? null;
      const defaultCanvasId = session?.defaultCanvasId ?? null;
      if (
        defaultCanvasId &&
        state.canvas.canvases.entities[defaultCanvasId]?.archivedAt !== undefined
      ) {
        throw new Error(t('commander.canvasArchived'));
      }
      const viewedCanvasId = state.canvas.activeCanvasId;
      const selectedNodes = [
        ...(resources.selectedNodes ?? []),
        ...(viewedCanvasId
          ? state.canvas.selectedNodeIds.map((nodeId) => ({ canvasId: viewedCanvasId, nodeId }))
          : []),
      ].filter(({ canvasId, nodeId }, index, nodes) => {
        const canvas = state.canvas.canvases.entities[canvasId];
        return (
          !!canvas?.nodes.some((node) => node.id === nodeId) &&
          nodes.findIndex((node) => node.canvasId === canvasId && node.nodeId === nodeId) === index
        );
      });
      const authorizedCanvasIds = [
        ...new Set(
          [
            defaultCanvasId,
            ...(resources.extraCanvasIds ?? []),
            ...selectedNodes.map((node) => node.canvasId),
          ].filter(
            (canvasId): canvasId is string =>
              typeof canvasId === 'string' && !!state.canvas.canvases.entities[canvasId],
          ),
        ),
      ];
      const currentRunId = state.commanderTimeline.currentRunIdBySessionId[sessionId] ?? null;
      hadActiveRun = currentRunId !== null;

      if (currentRunId) {
        if (intent.kind !== 'user_message') {
          throw new Error('A typed Commander intent must wait for the active run to finish');
        }
        if (
          (resources.attachments?.length ?? 0) > 0 ||
          (resources.extraCanvasIds?.length ?? 0) > 0 ||
          (resources.selectedNodes?.length ?? 0) > 0
        ) {
          throw new Error('Attachments, canvas scope, and node references require the next run');
        }
        dispatch(addInjectedMessage({ sessionId, content: displayMessage }));
        await transport.injectMessage(currentRunId, displayMessage);
        return true;
      }

      if (!session) dispatch(ensureActiveSession({ id: sessionId, defaultCanvasId }));
      const promptGuides = selectCommanderPromptGuides(state);
      const llmSettings = state.settings.llm;
      const hasUserMessages = session?.messages.some((entry) => entry.role === 'user') ?? false;

      // Auto-snapshot: capture project state before the first message of a session
      if (!hasUserMessages) {
        try {
          // Ensure the session row exists so the FK constraint on snapshots is satisfied
          if (api?.session?.upsert) {
            await api.session.upsert({
              id: sessionId,
              defaultCanvasId,
              title: '',
              messages: '[]',
              createdAt: Date.now(),
              updatedAt: Date.now(),
            });
          }
          await api?.snapshot?.capture(sessionId, 'Before Commander session', 'auto');
        } catch (err) {
          // Non-fatal — log and continue
          dispatch(
            addLog({
              level: 'warn',
              category: 'snapshot',
              message: 'Auto-snapshot failed',
              detail: err instanceof Error ? (err.stack ?? err.message) : String(err),
            }),
          );
        }
      }

      // Save current canvas to DB before Commander reads it.
      // Two-step process so the main-process cache reflects the exact state
      // the user sees on screen:
      //   1. flushPendingCanvasSave() cancels the 500ms debounce and forces
      //      any pending canvas/* edits through the normal persist path.
      //   2. Direct api.canvas.save below covers the case where nothing was
      //      pending (first message of a session) but the renderer holds
      //      state that was never persisted (e.g. cold-load drift).
      // Failures here MUST surface — a silent catch lets the AI read an
      // empty/stale canvas and hallucinate "no nodes exist".
      await flushPendingPersistence();
      const { canvases, viewport } = state.canvas;
      const saveCanvas = api?.canvas?.save;
      for (const canvasId of authorizedCanvasIds) {
        if (!saveCanvas) throw new Error(t('commander.canvasSyncFailed'));
        const canvas = canvases.entities[canvasId];
        if (!canvas) {
          throw new Error(t('commander.canvasSyncFailed'));
        }
        const canvasToSave =
          canvasId === viewedCanvasId && canvas.viewport !== viewport
            ? { ...canvas, viewport }
            : canvas;
        try {
          await saveCanvas(canvasToSave);
        } catch (err) {
          dispatch(
            addLog({
              level: 'error',
              category: 'commander',
              message: 'Failed to sync canvas before Commander turn',
              detail: err instanceof Error ? (err.stack ?? err.message) : String(err),
            }),
          );
          throw new Error(t('commander.canvasSyncFailed'), { cause: err });
        }
      }

      if (intent.kind === 'user_message') {
        dispatch(addUserMessage({ sessionId, content: displayMessage }));
      }
      dispatch(startStreaming(sessionId));
      if (intent.kind === 'user_message') {
        dispatch(recordPrompt({ wordCount: displayMessage.split(/\s+/).length }));
      }

      const llmProviders = llmSettings?.providers ?? [];
      const activeProvider =
        llmProviders.find((p) => p.id === state.commander.providerId) ?? llmProviders[0];
      const customLLMProvider = activeProvider
        ? normalizeLLMProviderRuntimeConfig({
            id: activeProvider.id,
            name: activeProvider.name,
            baseUrl: activeProvider.baseUrl,
            model: activeProvider.model,
            protocol: activeProvider.protocol,
            authStyle: activeProvider.authStyle,
            credentialMode: activeProvider.credentialMode,
            oauthTarget: activeProvider.oauthTarget,
            supportsModelOverride: activeProvider.supportsModelOverride,
            supportsReasoningEffort: activeProvider.supportsReasoningEffort,
            reasoningEffortsByModel: activeProvider.reasoningEffortsByModel,
            reasoningEffort: activeProvider.reasoningEffort,
            supportsVision: activeProvider.supportsVision,
            contextWindow: activeProvider.contextWindow,
          })
        : undefined;
      const permissionMode = state.commander.permissionMode;
      const {
        resourceBudget,
        temperature,
        contextWindowTokens,
        maxOutputTokens,
        qualityGateBehavior,
        requireStylePlateBeforeRefImage,
      } = state.commander;
      const processSettings: CommanderProcessBehaviorSettings = {
        qualityGateBehavior,
        requireStylePlateBeforeRefImage,
      };

      // Build default provider map from canvas settings
      const defaultProviders: Record<string, string> = {};
      const cs = defaultCanvasId ? canvases.entities[defaultCanvasId]?.settings : undefined;
      if (cs?.imageProviderId) defaultProviders.image = cs.imageProviderId;
      if (cs?.videoProviderId) defaultProviders.video = cs.videoProviderId;
      if (cs?.audioProviderId) defaultProviders.audio = cs.audioProviderId;

      const accepted = await transport.start({
        ...(defaultCanvasId ? { defaultCanvasId } : {}),
        authorizedCanvasIds,
        sessionId,
        intent,
        selectedNodes,
        attachments: resources.attachments,
        promptGuides,
        customLLMProvider,
        permissionMode,
        locale: getLocale(),
        resourceBudget,
        temperature,
        contextWindowTokens,
        maxOutputTokens,
        defaultProviders: Object.keys(defaultProviders).length > 0 ? defaultProviders : undefined,
        processSettings,
      });
      runAccepted = true;
      await this.hydrateAcceptedRun(accepted.runId, accepted.sessionId);
      return true;
    } catch (error) {
      const rawMsg = error instanceof Error ? error.message : String(error);
      const msg = localizeRuntimeError(rawMsg, t);
      dispatch(
        addLog({
          level: 'error',
          category: 'commander',
          message: 'Commander start failed',
        }),
      );
      if (
        !hadActiveRun &&
        sessionId &&
        getState().commander.sessions.some((session) => session.id === sessionId)
      ) {
        dispatch(streamError({ sessionId, error: msg }));
      }
      return runAccepted;
    }
  }

  async cancel(): Promise<void> {
    const { dispatch, getState, transport } = this.deps;
    incrementRunAbort();

    const state = getState();
    const sessionId = state.commander.activeSessionId;
    const currentRunId = sessionId
      ? state.commanderTimeline.currentRunIdBySessionId[sessionId]
      : undefined;
    if (!transport.available || !sessionId || !currentRunId) {
      return;
    }

    try {
      await transport.cancel(currentRunId);
    } catch {
      dispatch(
        addLog({
          level: 'error',
          category: 'commander',
          message: 'Failed to cancel Commander run',
        }),
      );
    }
  }

  /**
   * Step-level cancel. Asks the main-process orchestrator to abort just
   * the currently in-flight LLM step. The agent loop stays alive and
   * kicks off a retry, which the user sees as a `phase_note:llm_retry`
   * segment. A double-tap within 2s escalates to a full run cancel
   * (main-side logic); on escalation we finalize local state like a
   * regular cancel.
   */
  async cancelCurrentStep(): Promise<{ escalated: boolean }> {
    const { getState, transport } = this.deps;
    incrementStepAbort();
    const state = getState();
    const sessionId = state.commander.activeSessionId;
    const runId = sessionId
      ? state.commanderTimeline.currentRunIdBySessionId[sessionId]
      : undefined;
    if (!transport.available || !runId) return { escalated: false };
    try {
      const result = await transport.cancelCurrentStep(runId);
      if (result.escalated) {
        incrementRunAbort();
      }
      return result;
    } catch {
      return { escalated: false };
    }
  }

  private async hydrateAcceptedRun(runId: string, sessionId?: string): Promise<void> {
    const existing = selectEventsForRun(this.deps.getState(), runId);
    const afterSeq = existing.at(-1)?.seq ?? -1;
    try {
      const { events } = await this.deps.transport.hydrate(runId, afterSeq);
      const ownerSessionId =
        sessionId ?? this.deps.getState().commanderTimeline.sessionIdByRunId[runId];
      if (!ownerSessionId) return;
      for (const event of events) this.acceptTimelineEvent(ownerSessionId, event);
    } catch {
      this.deps.dispatch(
        addLog({
          level: 'warn',
          category: 'commander',
          message: 'Commander run hydration failed',
        }),
      );
    }
  }

  private acceptTimelineEvent(sessionId: string, event: TimelineEvent): void {
    const { dispatch, getState } = this.deps;
    const existing = selectEventsForRun(getState(), event.runId);
    if ((existing.at(-1)?.seq ?? -1) >= event.seq) return;
    const isSessionCurrentRun =
      event.kind === 'run_start' ||
      event.runId === getState().commanderTimeline.currentRunIdBySessionId[sessionId];
    dispatch(appendTimelineEvent({ sessionId, event }));
    if (isSessionCurrentRun) dispatch(updateRunPhase({ sessionId, event }));
    this.applyTimelineSideEffects(sessionId, event, isSessionCurrentRun);
  }

  /**
   * Subscribe to all commander push channels. Returns a single unsub that
   * tears down every listener. Intended to be called once per hook mount.
   */
  /**
   * Subscribe to all commander push channels. Returns a single unsub that
   * tears down every listener. Intended to be called once per hook mount.
   *
   * Post-cutover: the stream dispatcher appends each `TimelineEvent` to the
   * timeline slice, fires `run_end`/`cancelled` side-effects (record tool
   * call telemetry, persist session, clear streaming flag), and forwards
   * canvas/entities/settings/undo pushes to their respective slices.
   */
  subscribe(): Unsub {
    const { transport, api, dispatch } = this.deps;
    if (!transport.available) return () => {};

    const unsubStream = transport.onStreamEnvelope((envelope) => {
      this.acceptTimelineEvent(envelope.sessionId, envelope.event as TimelineEvent);
    });
    const unsubCanvas = transport.onCanvasUpdated((data) => this.handleCanvasUpdate(data));
    const unsubEntities = transport.onEntitiesUpdated((data) => {
      void syncCommanderEntitiesForTool(
        api as CommanderEntityAPI | undefined,
        dispatch,
        (data as CommanderEntitiesUpdatedPayload).toolName,
      );
    });
    const unsubSettings = transport.onSettingsDispatch((data) => this.handleSettingsDispatch(data));

    return () => {
      unsubStream();
      unsubCanvas();
      unsubEntities();
      unsubSettings();
    };
  }

  /**
   * Side-effects triggered by specific timeline events. UI state lives in
   * the timeline slice; this handler is for things outside that slice —
   * recording telemetry, clearing the `isStreaming` flag on terminal
   * frames, running per-tool entity-refresh dispatches, persisting the
   * session on `run_end`, etc.
   */
  private applyTimelineSideEffects(
    sessionId: string,
    event: TimelineEvent,
    isSessionCurrentRun: boolean,
  ): void {
    const { dispatch } = this.deps;

    switch (event.kind) {
      case 'tool_call': {
        const toolName = `${event.toolRef.domain}.${event.toolRef.action}`;
        this.toolCallNames.set(`${event.runId}:${event.toolCallId}`, {
          name: toolName,
          ...(event.details ? { details: event.details } : {}),
        });
        return;
      }
      case 'tool_result': {
        const key = `${event.runId}:${event.toolCallId}`;
        const entry = this.toolCallNames.get(key);
        this.toolCallNames.delete(key);
        const toolName = entry?.name;
        const toolDetails = entry?.details;
        const isError = event.status === 'failed';
        if (toolName) {
          dispatch(recordToolCall({ toolName, error: isError }));
          if (!isError) {
            if (toolName === 'node.create' || toolName === 'shot.create') {
              dispatch(recordShotCreate());
              dispatch(recordProjectActivity({ nodesCreated: 1 }));
            } else if (toolName === 'edge.create') {
              dispatch(recordProjectActivity({ edgesCreated: 1 }));
            } else if (toolName === 'prop.create') {
              dispatch(recordEntityCreate({ entityType: 'prop' }));
            } else if (toolName === 'entity.create') {
              const entityType = toolDetails?.type;
              if (
                entityType === 'character' ||
                entityType === 'location' ||
                entityType === 'equipment'
              ) {
                dispatch(recordEntityCreate({ entityType }));
              }
            } else if (toolName.endsWith('.create')) {
              const bucket = ENTITY_REFRESH_TOOL_ENTITY[toolName];
              if (bucket === 'character' || bucket === 'location' || bucket === 'equipment') {
                dispatch(recordEntityCreate({ entityType: bucket }));
              }
            }
          }
        }
        return;
      }
      case 'phase_note':
        if (event.note === 'llm_retry') {
          incrementLLMRetry();
          const stall = event.params?.stall;
          if (stall === true || stall === 'true') incrementStallWarning();
        }
        return;
      case 'run_end': {
        const runId = event.runId;
        const events = selectEventsForRun(this.deps.getState(), runId);
        const state = this.deps.getState();
        const message = buildFinalizedAssistantMessage(
          runId,
          event.status,
          events,
          state.commanderTimeline.locallyResolvedConfirmationsBySessionId[sessionId]?.[runId] ?? [],
          state.commanderTimeline.locallyResolvedQuestionsBySessionId[sessionId]?.[runId] ?? [],
        );
        if (message) {
          dispatch(appendFinalizedAssistantMessage({ sessionId, message, runId }));
        }
        if (!isSessionCurrentRun) return;
        if (event.status === 'failed') dispatch(recordError());
        dispatch(finishStreaming(sessionId));
        this.persistSessionOnTerminal(sessionId);
        dispatch(loadTaskLists({}));
        return;
      }
      case 'cancelled':
        // Informational-only per D2. The subsequent run_end(status=
        // 'cancelled') drives finalize. Its partialContent survives in
        // the timeline and is read during run-derivation.
        return;
      default:
        return;
    }
  }

  /** Persist the active commander session to SQLite after a terminal stream event. */
  private persistSessionOnTerminal(sessionId: string): void {
    const { api, getState } = this.deps;
    const freshState = getState();
    const sess = freshState.commander.sessions.find((session) => session.id === sessionId);
    if (!sess || sess.messages.length === 0) return;
    api?.session
      ?.upsert({
        id: sess.id,
        defaultCanvasId: sess.defaultCanvasId,
        title: sess.title,
        messages: JSON.stringify(sanitizeCommanderMessages(sess.messages)),
        createdAt: sess.createdAt,
        updatedAt: sess.updatedAt,
      })
      .catch(() => {});
  }

  private handleCanvasUpdate(data: CommanderCanvasUpdatedPayload): void {
    this.deps.dispatch(applyCommanderCanvasSnapshot(data));
  }

  private handleSettingsDispatch(data: CommanderSettingsDispatchPayload): void {
    const { dispatch } = this.deps;
    if (data.action === 'setProviderId' && typeof data.payload?.providerId === 'string') {
      dispatch(setProviderId(data.payload.providerId));
      return;
    }
    const settingsActionMap: Record<string, (payload: never) => unknown> = {
      setProviderBaseUrl: setProviderBaseUrl as (p: never) => unknown,
      setProviderModel: setProviderModel as (p: never) => unknown,
      setProviderName: setProviderName as (p: never) => unknown,
      addCustomProvider: addCustomProvider as (p: never) => unknown,
      removeCustomProvider: removeCustomProvider as (p: never) => unknown,
    };
    const actionCreator = settingsActionMap[data.action];
    if (actionCreator) {
      dispatch(actionCreator(data.payload as never) as never);
    }
  }
}
