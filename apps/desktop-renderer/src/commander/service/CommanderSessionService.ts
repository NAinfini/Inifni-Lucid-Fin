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
  clearPendingConfirmation,
  ensureActiveSession,
  finishStreaming,
  resolveToolCall,
  setBackendContextUsage,
  setPendingConfirmation,
  setPendingQuestion,
  setProviderId,
  setThinkingContent,
  startStreaming,
  streamError,
  switchCanvas,
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
import { selectActiveTemplates } from '../../store/slices/promptTemplates.js';
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

type CommanderEntityAPI = Pick<NonNullable<LucidAPI>, 'character' | 'equipment' | 'location'>;
type CommanderPromptGuide = { id: string; name: string; content: string };

function selectCommanderPromptGuides(state: RootState): CommanderPromptGuide[] {
  const guides: CommanderPromptGuide[] = [];
  const seen = new Set<string>();

  for (const guide of selectActiveTemplates(state.promptTemplates.templates)) {
    if (seen.has(guide.id)) continue;
    seen.add(guide.id);
    guides.push(guide);
  }

  for (const entry of state.workflowDefinitions.entries) {
    if (seen.has(entry.id)) continue;
    seen.add(entry.id);
    guides.push({
      id: entry.id,
      name: entry.name,
      content: entry.content,
    });
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

      if (state.commander.streaming) {
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
      if (!state.commander.streaming && !hasUserMessages) {
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
   * Subscribe to all commander push channels. Returns a single unsub that
   * tears down every listener. Intended to be called once per hook mount.
   */
  subscribe(): Unsub {
    const { transport, api, dispatch } = this.deps;
    if (!transport.available) return () => {};

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
    };
  }

  private handleStreamEvent(data: CommanderStreamEvent): void {
    const { dispatch, getState, t, transport } = this.deps;

    if (data.type === 'chunk' && data.content) {
      dispatch(appendStreamChunk(data.content));
      return;
    }

    if (data.type === 'thinking' && data.content) {
      dispatch(setThinkingContent(data.content));
      return;
    }

    if (data.type === 'tool_call' && data.toolName && data.toolCallId) {
      this.toolCallNames.set(data.toolCallId, data.toolName);
      dispatch(
        addToolCall({
          name: data.toolName,
          id: data.toolCallId,
          arguments: data.arguments ?? {},
          startedAt: data.startedAt,
        }),
      );
      return;
    }

    if (data.type === 'tool_result' && data.toolCallId) {
      const resultRecord =
        typeof data.result === 'object' && data.result !== null
          ? (data.result as { success?: unknown; error?: unknown })
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
        } else if (data.toolName === 'edge.create') {
          dispatch(recordProjectActivity({ edgesCreated: 1 }));
        } else if (data.toolName === 'prop.create') {
          dispatch(recordEntityCreate({ entityType: 'prop' }));
        } else if (toolName.endsWith('.create')) {
          // Catalog-driven: the `.create` tools of entity domains map to
          // their refresh bucket via `ENTITY_REFRESH_TOOL_ENTITY`. Any
          // future entity domain that adds a `.create` tool AND an
          // `entity.refresh` uiEffect automatically records its creation
          // here — no branch edit.
          const bucket = ENTITY_REFRESH_TOOL_ENTITY[toolName];
          if (bucket === 'character' || bucket === 'location' || bucket === 'equipment') {
            dispatch(recordEntityCreate({ entityType: bucket }));
          }
        }
        // Sync AI-created/updated presets to Redux so inspector shows names
        if (
          (toolName === 'preset.create' || toolName === 'preset.update') &&
          resultRecord &&
          typeof resultRecord === 'object' &&
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

    if (data.type === 'tool_confirm' && data.toolCallId && data.toolName) {
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
          args: data.arguments ?? {},
          tier: data.tier ?? 1,
        }),
      );
      return;
    }

    if (data.type === 'tool_question' && data.toolCallId) {
      dispatch(
        setPendingQuestion({
          toolCallId: data.toolCallId,
          question: (data as { question?: string }).question ?? '',
          options:
            (data as { options?: Array<{ label: string; description?: string }> }).options ?? [],
        }),
      );
      return;
    }

    if (data.type === 'context_usage') {
      const payload = data as {
        estimatedTokensUsed?: number;
        contextWindowTokens?: number;
        messageCount?: number;
        systemPromptChars?: number;
        toolSchemaChars?: number;
        messageChars?: number;
        cacheChars?: number;
        cacheEntryCount?: number;
        historyMessagesTrimmed?: number;
        utilizationRatio?: number;
      };
      if (
        typeof payload.estimatedTokensUsed === 'number' &&
        typeof payload.contextWindowTokens === 'number'
      ) {
        dispatch(
          setBackendContextUsage({
            estimatedTokensUsed: payload.estimatedTokensUsed,
            contextWindowTokens: payload.contextWindowTokens,
            messageCount: payload.messageCount ?? 0,
            systemPromptChars: payload.systemPromptChars ?? 0,
            toolSchemaChars: payload.toolSchemaChars ?? 0,
            messageChars: payload.messageChars ?? 0,
            cacheChars: payload.cacheChars ?? 0,
            cacheEntryCount: payload.cacheEntryCount ?? 0,
            historyMessagesTrimmed: payload.historyMessagesTrimmed ?? 0,
            utilizationRatio: payload.utilizationRatio ?? 0,
          }),
        );
      }
      return;
    }

    if (data.type === 'error') {
      const errMsg = data.error ?? t('commander.unknownError');
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
            error: data.error ?? t('commander.toolExecutionFailed'),
            completedAt: data.completedAt,
          }),
        );
        // Don't return — let it also call streamError to finalize the message
      }
      dispatch(streamError(errMsg));
      this.persistSessionOnTerminal();
      return;
    }

    if (data.type === 'done') {
      dispatch(finishStreaming(data.content));
      this.persistSessionOnTerminal();
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
