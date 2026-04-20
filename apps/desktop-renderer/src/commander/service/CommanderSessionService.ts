/**
 * `commander/service/CommanderSessionService.ts` — Phase E split-2.
 *
 * Holds all commander session orchestration that was previously inlined in
 * `hooks/useCommander.ts`. Pure TypeScript — no React, no hooks, so the
 * behavior is directly unit-testable.
 *
 * Responsibilities (in dependency order):
 *   - resolve the active provider / canvas / history from the Redux store
 *   - drive the auto-snapshot + canvas-save preamble before a new turn
 *   - call `transport.chat(...)` with the positional preload contract
 *   - normalize the incoming stream events and dispatch slice actions
 *   - mirror main-process canvas updates into renderer state with granular diffs
 *   - fan out settings / undo / entities push payloads to the store
 *
 * Lifecycle: the hook creates a service on mount, calls `subscribe()` inside
 * a `useEffect`, and tears it down with the returned unsubscriber.
 */

import { ENTITY_REFRESH_TOOL_ENTITY, normalizeLLMProviderRuntimeConfig } from '@lucid-fin/contracts';

import type { AppDispatch, RootState } from '../../store/index.js';
import {
  addInjectedMessage,
  addToolCall,
  addUserMessage,
  appendStreamChunk,
  appendThinking,
  applyStreamEvent,
  clearPendingConfirmation,
  collapseThinking,
  ensureActiveSession,
  finishStreaming,
  pushPhaseNote,
  resolveToolCall,
  selectIsStreaming,
  setBackendContextUsage,
  setPendingConfirmation,
  setPendingQuestion,
  setProviderId,
  startStreaming,
  streamError,
  switchCanvas,
  updateToolCallArguments,
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
  CommanderStreamEvent,
  CommanderTransport,
  CommanderUndoDispatchPayload,
  Unsub,
} from '../transport/CommanderTransport.js';
import { buildCommanderHistory } from './history-builder.js';
import {
  incrementLLMRetry,
  incrementParseFailure,
  incrementRunAbort,
  incrementStallWarning,
  incrementStepAbort,
  incrementUnknownKind,
  recordCoalescedBatch,
  recordRenderLagSample,
} from './telemetry.js';
import { BatchedDispatcher, type BatchedDeltaKind } from './batched-dispatcher.js';

/**
 * Exhaustiveness helper. If the `kind` switch below ever fails to cover a
 * new discriminator, TypeScript forces this call to become a type error —
 * surfacing the missing case at compile time rather than a silent drop at
 * runtime. Boundary check has already normalized shape before we hit here.
 */
function assertNever(value: never): never {
  throw new Error(`Unhandled commander stream kind: ${JSON.stringify(value)}`);
}

/**
 * Known Commander stream event kinds. This set is the renderer-side mirror of
 * the zod-owned `CommanderStreamPayload.kind` union in
 * `@lucid-fin/contracts-parse`. We duplicate it here because the renderer
 * bundle must not pull zod in — but the duplication is guarded: the
 * `kind` TS narrowing in the switch below covers exactly these literals, so a
 * drift between this set and the schema becomes a compile error at the
 * `assertNever` call.
 */
const COMMANDER_STREAM_KINDS = new Set<string>([
  'chunk',
  'tool_call_started',
  'tool_call_args_delta',
  'tool_call_args_complete',
  'tool_result',
  'tool_confirm',
  'tool_question',
  'thinking_delta',
  'phase_note',
  'done',
  'error',
  'context_usage',
]);

function isCommanderStreamEvent(raw: unknown): raw is CommanderStreamEvent {
  if (typeof raw !== 'object' || raw === null) return false;
  const record = raw as Record<string, unknown>;
  return (
    typeof record.kind === 'string' &&
    COMMANDER_STREAM_KINDS.has(record.kind) &&
    typeof record.runId === 'string' &&
    typeof record.step === 'number' &&
    typeof record.emittedAt === 'number'
  );
}

type CommanderEntityAPI = Pick<NonNullable<LucidAPI>, 'character' | 'equipment' | 'location'>;
type CommanderPromptGuide = { id: string; name: string; content: string };

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
  /** Maps in-flight tool call ids → tool names, so we can record usage on result. */
  private readonly toolCallNames = new Map<string, string>();
  /**
   * Accumulates tool_call args as they stream in via `tool_call_args_delta`.
   * Buffered per-`toolCallId`; cleared on `tool_call_args_complete`. Kept in
   * service state (not the Redux store) because it's a transient parse
   * artefact — consumers only ever see the parsed `arguments` record.
   */
  private readonly toolCallArgBuffers = new Map<string, string>();

  /**
   * Coalesces high-frequency delta events (text / thinking / tool args)
   * into one dispatch per animation frame. Created lazily on `subscribe`
   * and disposed on unsubscribe so the scheduler handle doesn't leak
   * across tests.
   */
  private batcher: BatchedDispatcher | null = null;

  /**
   * Push-timestamp map so `recordRenderLagSample` can report honest
   * end-to-end latency. Keyed by the same `(kind, key)` compound as the
   * batcher's internal buffer; cleared on flush.
   */
  private readonly batchPushStart = new Map<string, number>();

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

      // Build default provider map from settings
      const defaultProviders: Record<string, string> = {};
      for (const group of ['image', 'video', 'audio'] as const) {
        const id = state.settings[group].defaultProviderId;
        if (id) defaultProviders[group] = id;
      }

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
      const msg = error instanceof Error ? error.message : String(error);
      dispatch(
        addLog({
          level: 'error',
          category: 'commander',
          message: msg,
          detail: error instanceof Error ? (error.stack ?? error.message) : String(error),
        }),
      );
      dispatch(streamError(msg));
    }
  }

  /** User-initiated cancel. Finalizes local streaming state even if the
   *  main-process session is already gone. */
  async cancel(): Promise<void> {
    const { dispatch, getState, transport } = this.deps;
    incrementRunAbort();
    this.batcher?.flushNow();
    if (!transport.available) {
      dispatch(finishStreaming(undefined));
      return;
    }
    dispatch(finishStreaming(undefined));
    const activeCanvasId = getState().canvas.activeCanvasId;
    if (activeCanvasId) {
      try {
        await transport.cancel(activeCanvasId);
      } catch {
        /* main-process session already gone */
      }
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
    this.batcher?.flushNow();
    const activeCanvasId = getState().canvas.activeCanvasId;
    if (!transport.available || !activeCanvasId) return { escalated: false };
    try {
      const result = await transport.cancelCurrentStep(activeCanvasId);
      if (result.escalated) {
        incrementRunAbort();
        dispatch(finishStreaming(undefined));
      }
      return result;
    } catch {
      return { escalated: false };
    }
  }

  /**
   * Subscribe to all commander push channels. Returns a single unsub that
   * tears down every listener. Intended to be called once per hook mount.
   */
  subscribe(): Unsub {
    const { transport, api, dispatch } = this.deps;
    if (!transport.available) return () => {};

    this.batcher = new BatchedDispatcher({
      flush: (kind, key, joined) => {
        const compound = `${kind}\u0000${key}`;
        const startedAt = this.batchPushStart.get(compound);
        if (startedAt !== undefined) {
          recordRenderLagSample(performance.now() - startedAt);
          this.batchPushStart.delete(compound);
        }
        this.applyCoalescedFlush(kind, key, joined);
      },
      onCoalesced: (batchSize) => recordCoalescedBatch(batchSize),
    });

    const unsubStream = transport.onStream((data) => this.handleStreamEvent(data));
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
      this.batcher?.dispose();
      this.batcher = null;
      this.batchPushStart.clear();
    };
  }

  /**
   * Route a deferred batched delta into the same reducer path the
   * un-batched case would have taken. Called exclusively by the
   * BatchedDispatcher's rAF flush.
   */
  private applyCoalescedFlush(kind: BatchedDeltaKind, key: string, joined: string): void {
    const { dispatch } = this.deps;
    switch (kind) {
      case 'text_delta':
        dispatch(collapseThinking());
        dispatch(appendStreamChunk(joined));
        return;
      case 'thinking_delta':
        dispatch(appendThinking(joined));
        return;
      case 'tool_call_args_delta': {
        const prior = this.toolCallArgBuffers.get(key) ?? '';
        this.toolCallArgBuffers.set(key, prior + joined);
        return;
      }
    }
  }

  /**
   * Push a delta into the batcher, timestamping the first push per
   * (kind, key) so render-lag samples measure honest end-to-end latency
   * instead of just the final flush.
   */
  private enqueueDelta(kind: BatchedDeltaKind, key: string, delta: string): void {
    if (!this.batcher) return;
    const compound = `${kind}\u0000${key}`;
    if (!this.batchPushStart.has(compound)) {
      this.batchPushStart.set(compound, performance.now());
    }
    this.batcher.push(kind, key, delta);
  }

  private handleStreamEvent(raw: CommanderStreamEvent): void {
    const { dispatch, getState, t, transport } = this.deps;

    // Boundary check: re-validate shape at the renderer edge. `onStream` is
    // typed, but in dev a stale preload or manually-crafted test double can
    // deliver a payload TS accepts but our union rejects. Count the drop,
    // log, and return — never throw — so one bad event cannot kill the
    // session. Full zod validation is done in the preload; this check is
    // the last line of defense before the narrowed switch below.
    if (!isCommanderStreamEvent(raw)) {
      incrementParseFailure();
      dispatch(
        addLog({
          level: 'warn',
          category: 'commander',
          message: 'Dropped malformed commander:stream event',
          detail: JSON.stringify(raw),
        }),
      );
      return;
    }
    const data = raw;

    // Keep the RunPhase state machine in sync before the event-specific
    // reducers run. The phase is what LiveActivityBar + elapsed timers + the
    // cursor gate all read, so it has to lead.
    dispatch(applyStreamEvent(data));

    switch (data.kind) {
      case 'chunk':
        if (data.content) {
          this.enqueueDelta('text_delta', '', data.content);
        }
        return;

      case 'thinking_delta':
        this.enqueueDelta('thinking_delta', '', data.content);
        return;

      case 'tool_call_started':
        // Any buffered thinking/text must reach the store before the
        // tool-card renders — otherwise the tool card flips to "running"
        // above text that hasn't landed yet.
        this.batcher?.flushNow();
        dispatch(collapseThinking());
        this.toolCallNames.set(data.toolCallId, data.toolName);
        // Buffer args as they stream in; persisted in `toolCallArgBuffers`
        // until `tool_call_args_complete` (LLM-originated) or the
        // tool-executor's `tool_call_args_complete` for non-LLM paths.
        this.toolCallArgBuffers.set(data.toolCallId, '');
        dispatch(
          addToolCall({
            name: data.toolName,
            id: data.toolCallId,
            arguments: {},
            startedAt: data.startedAt,
          }),
        );
        return;

      case 'tool_call_args_delta': {
        this.enqueueDelta('tool_call_args_delta', data.toolCallId, data.delta);
        return;
      }

      case 'tool_call_args_complete': {
        // Drain any pending args deltas for this id so the final parsed
        // arguments land after (not before) the streamed partial text.
        this.batcher?.flushNow();
        this.toolCallArgBuffers.delete(data.toolCallId);
        dispatch(
          updateToolCallArguments({
            id: data.toolCallId,
            arguments: data.arguments,
          }),
        );
        return;
      }

      case 'tool_result': {
        this.batcher?.flushNow();
        const resultRecord =
          typeof data.result === 'object' && data.result !== null
            ? (data.result as { success?: unknown; error?: unknown; data?: unknown })
            : undefined;
        const isError = resultRecord?.success === false;
        dispatch(
          resolveToolCall({
            id: data.toolCallId,
            result: data.result,
            error: isError
              ? typeof resultRecord?.error === 'string'
                ? resultRecord.error
                : t('commander.toolExecutionFailed')
              : undefined,
            completedAt: data.completedAt,
          }),
        );
        const toolName = data.toolName ?? this.toolCallNames.get(data.toolCallId);
        if (toolName) {
          dispatch(recordToolCall({ toolName, error: isError }));
          this.toolCallNames.delete(data.toolCallId);
        }
        if (toolName && !isError) {
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
        return;
      }

      case 'tool_confirm': {
        const { confirmAutoMode } = getState().commander;
        if (confirmAutoMode !== 'none') {
          const approved = confirmAutoMode === 'approve';
          const cid = getState().canvas.activeCanvasId;
          if (cid) {
            void transport.confirmTool(cid, data.toolCallId, approved);
          }
          dispatch(clearPendingConfirmation());
          return;
        }
        dispatch(
          setPendingConfirmation({
            toolCallId: data.toolCallId,
            toolName: data.toolName,
            args: data.arguments,
            tier: data.tier,
          }),
        );
        return;
      }

      case 'tool_question':
        dispatch(
          setPendingQuestion({
            toolCallId: data.toolCallId,
            question: data.question,
            options: data.options,
          }),
        );
        return;

      case 'context_usage':
        dispatch(
          setBackendContextUsage({
            estimatedTokensUsed: data.estimatedTokensUsed,
            contextWindowTokens: data.contextWindowTokens,
            messageCount: data.messageCount,
            systemPromptChars: data.systemPromptChars,
            toolSchemaChars: data.toolSchemaChars,
            messageChars: data.messageChars,
            cacheChars: data.cacheChars,
            cacheEntryCount: data.cacheEntryCount,
            historyMessagesTrimmed: data.historyMessagesTrimmed ?? 0,
            utilizationRatio: data.utilizationRatio,
          }),
        );
        return;

      case 'phase_note':
        // Flush so buffered text lands before the note segment — the
        // segment appears as a status line between prior output and
        // whatever comes next (retry, new call, etc).
        this.batcher?.flushNow();
        if (data.note === 'llm_retry') {
          incrementLLMRetry();
          // The orchestrator tags stall-triggered retries with `(stall)`
          // in the detail string. Keeping the attribution here (instead
          // of a separate wire kind) avoids growing the surface for a
          // purely observability concern.
          if (data.detail.includes('(stall)')) incrementStallWarning();
        }
        dispatch(pushPhaseNote({ note: data.note, detail: data.detail }));
        return;

      case 'error': {
        this.batcher?.flushNow();
        const errMsg = data.error || t('commander.unknownError');
        dispatch(recordError());
        dispatch(
          addLog({
            level: 'error',
            category: 'commander',
            message: errMsg,
            detail: data.toolCallId ? `Tool call ID: ${data.toolCallId}` : undefined,
          }),
        );
        if (data.toolCallId) {
          dispatch(
            resolveToolCall({
              id: data.toolCallId,
              error: data.error || t('commander.toolExecutionFailed'),
              completedAt: data.completedAt,
            }),
          );
        }
        dispatch(streamError(errMsg));
        this.persistSessionOnTerminal();
        return;
      }

      case 'done': {
        this.batcher?.flushNow();
        // Phase E — forward the ExitDecision meta so MessageList can render
        // a non-satisfied banner. Pre-Phase-E builds won't ship these
        // fields; the reducer treats the old string payload as
        // before.
        const ed = data.exitDecision;
        const exitDecisionMeta = ed
          ? {
              outcome: ed.outcome,
              contractId:
                'contractId' in ed
                  ? (ed as { contractId?: string }).contractId
                  : undefined,
              reason:
                'reason' in ed
                  ? (ed as { reason?: string }).reason
                  : undefined,
              blockerKind:
                'blocker' in ed &&
                ed.blocker &&
                typeof ed.blocker === 'object' &&
                'kind' in ed.blocker
                  ? String((ed.blocker as { kind?: unknown }).kind ?? '')
                  : undefined,
            }
          : undefined;
        dispatch(
          finishStreaming(
            exitDecisionMeta
              ? { content: data.content, exitDecision: exitDecisionMeta }
              : data.content,
          ),
        );
        this.persistSessionOnTerminal();
        return;
      }

      // Phase B/D shadow events — carried in the `done` payload, but also
      // emitted as dedicated telemetry events for the harness. The
      // renderer has no separate reaction.
      case 'evidence_appended':
      case 'exit_decision':
      case 'preflight_decision':
        return;

      default:
        incrementUnknownKind();
        assertNever(data);
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
        dispatch(
          updateNodeData({ id: inNode.id, data: inNode.data as Record<string, unknown> }),
        );
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
