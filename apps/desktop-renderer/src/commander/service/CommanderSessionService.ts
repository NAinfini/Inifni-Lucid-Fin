/**
 * `commander/service/CommanderSessionService.ts` — v2 cutover.
 *
 * Drives user-initiated Commander flows (start a turn, cancel, inject follow-up
 * messages) and forwards incoming timeline events into the v2 timeline slice.
 * Stream events are no longer normalized into the legacy `commanderSlice` —
 * UI consumers read directly from `commanderTimelineSlice.events`.
 *
 * Non-stream side-effects (canvas updates, settings/undo pushes, entity
 * refreshes) still land on their dedicated slices — those channels are
 * orthogonal to the Commander timeline.
 */

import {
  ENTITY_REFRESH_TOOL_ENTITY,
  normalizeLLMProviderRuntimeConfig,
} from '@lucid-fin/contracts';

import type { AppDispatch, RootState } from '../../store/index.js';
import {
  addInjectedMessage,
  addUserMessage,
  updateRunPhase,
  appendFinalizedAssistantMessage,
  ensureActiveSession,
  finishStreaming,
  selectIsStreaming,
  setProviderId,
  startStreaming,
  streamError,
  switchCanvas,
  upsertFinalizedAssistantMessage,
} from '../../store/slices/commander.js';
import {
  addNode,
  addEdge,
  moveNode,
  removeEdges,
  removeNodes,
  renameCanvas,
  renameNode,
  updateEdge,
  updateNodeData,
} from '../../store/slices/canvas.js';
import { setCharacters } from '../../store/slices/characters.js';
import { setEquipment } from '../../store/slices/equipment.js';
import { setLocations } from '../../store/slices/locations.js';
import { upsertPreset } from '../../store/slices/presets.js';
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
import { flushPendingCanvasSave } from '../../store/middleware/persist.js';
import type { LucidAPI } from '../../utils/api.js';
import type {
  CommanderCanvasUpdatedPayload,
  CommanderEntitiesUpdatedPayload,
  CommanderSettingsDispatchPayload,
  CommanderTransport,
  CommanderUndoDispatchPayload,
  Unsub,
} from '../transport/CommanderTransport.js';
import { buildCommanderHistory } from './history-builder.js';
import type { TimelineEvent } from '@lucid-fin/contracts';
import { appendEvent as appendTimelineEvent } from '../state/commander-timeline-slice.js';
import { selectEventsForRun } from '../state/commander-timeline-selectors.js';
import { buildFinalizedAssistantMessage } from '../state/run-derivation.js';
import {
  incrementLLMRetry,
  incrementRunAbort,
  incrementStallWarning,
  incrementStepAbort,
} from './telemetry.js';

type CommanderEntityAPI = Pick<NonNullable<LucidAPI>, 'character' | 'equipment' | 'location'>;
type CommanderPromptGuide = { id: string; name: string; content: string; autoInject?: boolean };

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
  return raw;
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

/**
 * User-initiated `cancel()` waits this long for the backend's
 * `run_end(status='cancelled')` before locally finalizing. Matches D2b
 * in PLAN v7.
 */
const CANCEL_TIMEOUT_MS = 2000;

interface RunEndLatch {
  promise: Promise<boolean>;
  resolve: (arrived: boolean) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class CommanderSessionService {
  /** Maps in-flight tool call ids → tool names, so we can record usage on result. */
  private readonly toolCallNames = new Map<string, string>();

  /**
   * D2b — Promise latches indexed by runId. `cancel()` awaits the
   * matching latch; the `run_end` side-effect resolves it. Idempotent on
   * repeat-cancel: a second `cancel()` for the same runId receives the
   * same Promise. Never leaks — timer-expiry clears the entry.
   */
  private readonly runEndLatches = new Map<string, RunEndLatch>();

  constructor(private readonly deps: CommanderSessionServiceDeps) {}

  /**
   * Primary entry point for the UI: the user hit "send" or enqueued a message.
   * Includes all of the session-start preamble (ensureActiveSession,
   * auto-snapshot, canvas-save) and dispatches into the slice to reflect
   * user intent before hitting the IPC boundary.
   */
  async start(message: string): Promise<void> {
    const { dispatch, getState, t, getLocale, transport, api } = this.deps;
    const trimmed = message.trim();
    if (!trimmed) return;

    try {
      if (!transport.available) {
        throw new Error(t('commander.apiUnavailable'));
      }

      // Read fresh state to avoid stale closure values
      const state = getState();
      if (!state.settings.bootstrapped) {
        throw new Error(t('commander.backendNotReady'));
      }
      const currentCanvasId = state.canvas.activeCanvasId;
      if (!currentCanvasId) {
        throw new Error(t('commander.noActiveCanvas'));
      }

      // Sync Commander's canvas binding if it drifted (e.g. cold start)
      if (state.commander.activeCanvasId !== currentCanvasId) {
        dispatch(switchCanvas(currentCanvasId));
      }

      if (selectIsStreaming(state)) {
        dispatch(addInjectedMessage(trimmed));
        await transport.injectMessage(currentCanvasId, trimmed);
        return;
      }

      const history = buildCommanderHistory(state.commander.messages);
      const promptGuides = selectCommanderPromptGuides(state);
      const llmSettings = state.settings.llm;
      const selectedNodeIds = state.canvas.selectedNodeIds;
      const hasUserMessages = state.commander.messages.some((entry) => entry.role === 'user');
      const sessionId = state.commander.activeSessionId ?? crypto.randomUUID();

      if (!state.commander.activeSessionId) {
        dispatch(ensureActiveSession(sessionId));
      }

      // Auto-snapshot: capture project state before the first message of a session
      if (!selectIsStreaming(state) && !hasUserMessages) {
        try {
          // Ensure the session row exists so the FK constraint on snapshots is satisfied
          if (api?.session?.upsert) {
            await api.session.upsert({
              id: sessionId,
              canvasId: currentCanvasId,
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
      flushPendingCanvasSave();
      const { activeCanvasId: canvasId, canvases, viewport } = state.canvas;
      const activeCanvas = canvasId ? canvases.entities[canvasId] : undefined;
      if (activeCanvas && api?.canvas?.save) {
        const canvasToSave =
          activeCanvas.viewport === viewport ? activeCanvas : { ...activeCanvas, viewport };
        try {
          await api.canvas.save(canvasToSave);
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

      dispatch(addUserMessage(trimmed));
      dispatch(startStreaming());
      dispatch(recordPrompt({ wordCount: trimmed.split(/\s+/).length }));

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
            contextWindow: activeProvider.contextWindow,
          })
        : undefined;
      const permissionMode = state.commander.permissionMode;
      const { maxSteps, temperature, maxTokens } = state.commander;

      // Build default provider map from canvas settings
      const defaultProviders: Record<string, string> = {};
      const cs = activeCanvas?.settings;
      if (cs?.imageProviderId) defaultProviders.image = cs.imageProviderId;
      if (cs?.videoProviderId) defaultProviders.video = cs.videoProviderId;
      if (cs?.audioProviderId) defaultProviders.audio = cs.audioProviderId;

      await transport.chat(
        currentCanvasId,
        trimmed,
        history,
        selectedNodeIds,
        promptGuides,
        customLLMProvider,
        permissionMode,
        getLocale(),
        maxSteps,
        temperature,
        maxTokens,
        sessionId,
        Object.keys(defaultProviders).length > 0 ? defaultProviders : undefined,
      );
    } catch (error) {
      const rawMsg = error instanceof Error ? error.message : String(error);
      const msg = localizeRuntimeError(rawMsg, t);
      dispatch(
        addLog({
          level: 'error',
          category: 'commander',
          message: rawMsg,
          detail: error instanceof Error ? (error.stack ?? error.message) : String(error),
        }),
      );
      dispatch(streamError(msg));
    }
  }

  /**
   * User-initiated cancel. Prefers the backend-driven finalize (richer
   * exitDecision/summary) and only falls back to a local `terminalKind=
   * 'cancelled'` finalize when (a) transport unavailable, (b) no
   * activeCanvasId, or (c) `awaitRunEnd` times out. See D2b in PLAN v7.
   */
  async cancel(): Promise<void> {
    const { dispatch, getState, transport } = this.deps;
    incrementRunAbort();

    const state = getState();
    const currentRunId = state.commanderTimeline.currentRunId;
    const activeCanvasId = state.commander.activeCanvasId;

    if (!transport.available || !activeCanvasId) {
      if (currentRunId) this.finalizeLocallyAsCancelled(currentRunId);
      dispatch(finishStreaming());
      this.persistSessionOnTerminal();
      return;
    }

    try {
      await transport.cancel(activeCanvasId);
    } catch {
      // Transport cancel itself failed — fall through to timeout path.
    }

    // Fast-path: if run_end already finalized during the transport.cancel
    // await, no reason to wait further.
    if (!currentRunId || getState().commander.finalizedRunIds.includes(currentRunId)) {
      return;
    }

    const arrived = await this.awaitRunEnd(currentRunId, CANCEL_TIMEOUT_MS);
    if (!arrived) {
      this.finalizeLocallyAsCancelled(currentRunId);
      dispatch(finishStreaming());
      this.persistSessionOnTerminal();
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
    const { dispatch, getState, transport } = this.deps;
    incrementStepAbort();
    const activeCanvasId = getState().canvas.activeCanvasId;
    if (!transport.available || !activeCanvasId) return { escalated: false };
    try {
      const result = await transport.cancelCurrentStep(activeCanvasId);
      if (result.escalated) {
        incrementRunAbort();
        const runId = getState().commanderTimeline.currentRunId;
        if (runId) this.finalizeLocallyAsCancelled(runId);
        dispatch(finishStreaming());
        this.persistSessionOnTerminal();
      }
      return result;
    } catch {
      return { escalated: false };
    }
  }

  /** Build a cancelled-finalize message from the current timeline and
   *  dispatch it through the normal append path (reducer dedup will no-op
   *  if a backend run_end already finalized this runId). */
  private finalizeLocallyAsCancelled(runId: string): void {
    const { dispatch, getState } = this.deps;
    const state = getState();
    const events = selectEventsForRun(state, runId);
    const message = buildFinalizedAssistantMessage(
      runId,
      'cancelled',
      events,
      state.commanderTimeline.locallyResolvedConfirmations,
      state.commanderTimeline.locallyResolvedQuestions,
    );
    if (message) {
      dispatch(appendFinalizedAssistantMessage({ message, runId }));
    }
  }

  /** Resolve a run_end Promise latch if one exists for this runId. No-op
   *  when no latch was created (e.g. normal completion without cancel). */
  private resolveRunEndLatch(runId: string): void {
    const entry = this.runEndLatches.get(runId);
    if (!entry) return;
    clearTimeout(entry.timer);
    this.runEndLatches.delete(runId);
    entry.resolve(true);
  }

  /** Wait for the `run_end` event matching `runId`. Idempotent: repeat
   *  calls receive the same Promise. Timer expiry resolves `false` and
   *  deletes the entry. */
  private awaitRunEnd(runId: string, ms: number): Promise<boolean> {
    const existing = this.runEndLatches.get(runId);
    if (existing) return existing.promise;
    let resolve!: (arrived: boolean) => void;
    const promise = new Promise<boolean>((r) => {
      resolve = r;
    });
    const timer = setTimeout(() => {
      this.runEndLatches.delete(runId);
      resolve(false);
    }, ms);
    this.runEndLatches.set(runId, { promise, resolve, timer });
    return promise;
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
      const event = envelope.event as TimelineEvent;
      dispatch(appendTimelineEvent(event));
      // Phase FSM — drive the legacy `commander.phase` field so the
      // LiveActivityBar / cursor gate / elapsed timers stay honest.
      dispatch(updateRunPhase(event));
      this.applyTimelineSideEffects(event);
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
    const unsubUndo = transport.onUndoDispatch((data) => this.handleUndoDispatch(data));

    return () => {
      unsubStream();
      unsubCanvas();
      unsubEntities();
      unsubSettings();
      unsubUndo();
    };
  }

  /**
   * Side-effects triggered by specific timeline events. UI state lives in
   * the timeline slice; this handler is for things outside that slice —
   * recording telemetry, clearing the `isStreaming` flag on terminal
   * frames, running per-tool entity-refresh dispatches, persisting the
   * session on `run_end`, etc.
   */
  private applyTimelineSideEffects(event: TimelineEvent): void {
    const { dispatch } = this.deps;

    switch (event.kind) {
      case 'tool_call': {
        const toolName = `${event.toolRef.domain}.${event.toolRef.action}`;
        this.toolCallNames.set(event.toolCallId, toolName);
        return;
      }
      case 'tool_result': {
        const toolName = this.toolCallNames.get(event.toolCallId);
        this.toolCallNames.delete(event.toolCallId);
        const isError = !!event.error;
        if (toolName) {
          dispatch(recordToolCall({ toolName, error: isError }));
          if (!isError) {
            const resultRecord =
              typeof event.result === 'object' && event.result !== null
                ? (event.result as { success?: unknown; data?: unknown })
                : undefined;
            if (toolName === 'node.create' || toolName === 'shot.create') {
              dispatch(recordShotCreate());
              dispatch(recordProjectActivity({ nodesCreated: 1 }));
            } else if (toolName === 'edge.create') {
              dispatch(recordProjectActivity({ edgesCreated: 1 }));
            } else if (toolName === 'prop.create') {
              dispatch(recordEntityCreate({ entityType: 'prop' }));
            } else if (toolName.endsWith('.create')) {
              const bucket = ENTITY_REFRESH_TOOL_ENTITY[toolName];
              if (bucket === 'character' || bucket === 'location' || bucket === 'equipment') {
                dispatch(recordEntityCreate({ entityType: bucket }));
              }
            }
            if (
              (toolName === 'preset.create' || toolName === 'preset.update') &&
              resultRecord &&
              'data' in resultRecord &&
              resultRecord.data &&
              typeof resultRecord.data === 'object' &&
              'id' in (resultRecord.data as Record<string, unknown>)
            ) {
              dispatch(
                upsertPreset(resultRecord.data as import('@lucid-fin/contracts').PresetDefinition),
              );
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
        if (event.status === 'failed') dispatch(recordError());

        const events = selectEventsForRun(this.deps.getState(), runId);
        const state = this.deps.getState();
        const message = buildFinalizedAssistantMessage(
          runId,
          event.status,
          events,
          state.commanderTimeline.locallyResolvedConfirmations,
          state.commanderTimeline.locallyResolvedQuestions,
        );
        if (message) {
          const alreadyFinalized = state.commander.finalizedRunIds.includes(runId);
          if (alreadyFinalized) {
            // Late run_end after local cancel: merge backend's richer
            // exitDecision/summary into the existing message.
            dispatch(upsertFinalizedAssistantMessage({ message, runId }));
          } else {
            dispatch(appendFinalizedAssistantMessage({ message, runId }));
          }
        }
        this.resolveRunEndLatch(runId);
        dispatch(finishStreaming());
        this.persistSessionOnTerminal();
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
  private persistSessionOnTerminal(): void {
    const { api, getState } = this.deps;
    const freshState = getState();
    const sid = freshState.commander.activeSessionId;
    if (!sid || freshState.commander.messages.length === 0) return;
    const sess = freshState.commander.sessions.find((s) => s.id === sid);
    if (!sess) return;
    api?.session
      ?.upsert({
        id: sess.id,
        canvasId: freshState.canvas.activeCanvasId ?? null,
        title: sess.title,
        messages: JSON.stringify(sess.messages),
        createdAt: sess.createdAt,
        updatedAt: sess.updatedAt,
      })
      .catch(() => {});
  }

  private handleCanvasUpdate(data: CommanderCanvasUpdatedPayload): void {
    const { dispatch, getState } = this.deps;
    const currentState = getState();
    const currentCanvas = currentState.canvas.canvases.entities[data.canvasId];
    if (!currentCanvas) return;
    const incoming = data.canvas;

    // Canvas-level properties
    if (incoming.name !== currentCanvas.name) {
      dispatch(renameCanvas({ id: data.canvasId, name: incoming.name }));
    }

    // Nodes: detect added, removed, updated
    const currentNodeIds = new Set(currentCanvas.nodes.map((n) => n.id));
    const incomingNodeIds = new Set(incoming.nodes.map((n) => n.id));

    // Added nodes
    for (const node of incoming.nodes) {
      if (!currentNodeIds.has(node.id)) {
        dispatch(
          addNode({
            id: node.id,
            type: node.type,
            title: node.title,
            position: node.position,
            data: node.data,
            width: node.width,
            height: node.height,
          }),
        );
      }
    }

    // Removed nodes
    const removedNodeIds = [...currentNodeIds].filter((id) => !incomingNodeIds.has(id));
    if (removedNodeIds.length > 0) {
      dispatch(removeNodes(removedNodeIds));
    }

    // Updated nodes — compare fields individually to apply granular diffs.
    // No updatedAt gate: the per-field checks below prevent unnecessary
    // dispatches, while an updatedAt gate would silently skip legitimate
    // updates when the renderer has a newer timestamp from a concurrent
    // user edit on a different field.
    for (const inNode of incoming.nodes) {
      if (!currentNodeIds.has(inNode.id)) continue;
      const curNode = currentCanvas.nodes.find((n) => n.id === inNode.id);
      if (!curNode) continue;

      if (curNode.position.x !== inNode.position.x || curNode.position.y !== inNode.position.y) {
        dispatch(moveNode({ id: inNode.id, position: inNode.position }));
      }
      if (curNode.title !== inNode.title) {
        dispatch(renameNode({ id: inNode.id, title: inNode.title }));
      }
      if (JSON.stringify(curNode.data) !== JSON.stringify(inNode.data)) {
        dispatch(updateNodeData({ id: inNode.id, data: inNode.data as Record<string, unknown> }));
      }
    }

    // Edges: detect added, removed, updated
    const currentEdgeIds = new Set(currentCanvas.edges.map((e) => e.id));
    const incomingEdgeIds = new Set(incoming.edges.map((e) => e.id));

    for (const edge of incoming.edges) {
      if (!currentEdgeIds.has(edge.id)) {
        dispatch(addEdge(edge));
      }
    }

    for (const inEdge of incoming.edges) {
      if (!currentEdgeIds.has(inEdge.id)) continue;
      const curEdge = currentCanvas.edges.find((e) => e.id === inEdge.id);
      if (!curEdge) continue;
      const changed =
        curEdge.source !== inEdge.source ||
        curEdge.target !== inEdge.target ||
        curEdge.sourceHandle !== inEdge.sourceHandle ||
        curEdge.targetHandle !== inEdge.targetHandle ||
        JSON.stringify(curEdge.data) !== JSON.stringify(inEdge.data);
      if (changed) {
        dispatch(updateEdge({ id: inEdge.id, changes: inEdge }));
      }
    }

    const removedEdgeIds = [...currentEdgeIds].filter((id) => !incomingEdgeIds.has(id));
    if (removedEdgeIds.length > 0) {
      dispatch(removeEdges(removedEdgeIds));
    }
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

  private handleUndoDispatch(data: CommanderUndoDispatchPayload): void {
    const { dispatch } = this.deps;
    if (data.action === 'undo') {
      dispatch({ type: 'undo/undo' });
    } else if (data.action === 'redo') {
      dispatch({ type: 'undo/redo' });
    }
  }
}
