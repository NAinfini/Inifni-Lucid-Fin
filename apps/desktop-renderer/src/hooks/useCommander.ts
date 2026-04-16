import { useCallback, useEffect } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { normalizeLLMProviderRuntimeConfig } from '@lucid-fin/contracts';
import { store, type AppDispatch, type RootState } from '../store/index.js';
import {
  addToolCall,
  addUserMessage,
  addInjectedMessage,
  appendStreamChunk,
  ensureActiveSession,
  finishStreaming,
  resolveToolCall,
  setProviderId,
  setPendingConfirmation,
  clearPendingConfirmation,
  setPendingQuestion,
  setBackendContextUsage,
  setThinkingContent,
  switchCanvas,
  startStreaming,
  streamError,
} from '../store/slices/commander.js';
import {
  addNode,
  removeNodes,
  updateNodeData,
  moveNode,
  renameNode,
  addEdge,
  removeEdges,
  updateEdge,
  renameCanvas,
} from '../store/slices/canvas.js';
import { setCharacters } from '../store/slices/characters.js';
import { setEquipment } from '../store/slices/equipment.js';
import { setLocations } from '../store/slices/locations.js';
import { upsertPreset } from '../store/slices/presets.js';
import {
  setProviderBaseUrl,
  setProviderModel,
  setProviderName,
  addCustomProvider,
  removeCustomProvider,
  recordToolCall,
  recordPrompt,
  recordError,
  recordProjectActivity,
  recordShotCreate,
  recordEntityCreate,
} from '../store/slices/settings.js';
import { selectActiveTemplates } from '../store/slices/promptTemplates.js';
import { addLog } from '../store/slices/logger.js';
import { t, getLocale } from '../i18n.js';
import { getAPI, type LucidAPI } from '../utils/api.js';

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

export function useCommander(): {
  sendMessage: (message: string) => Promise<void>;
  cancel: () => Promise<void>;
  isStreaming: boolean;
} {
  const dispatch = useDispatch<AppDispatch>();
  const activeCanvasId = useSelector((state: RootState) => state.canvas.activeCanvasId);
  const isStreaming = useSelector((state: RootState) => state.commander.streaming);

  const sendMessage = useCallback(
    async (message: string) => {
      const trimmed = message.trim();
      if (!trimmed) return;

      try {
        const api = getAPI();
        if (!api?.commander) {
          throw new Error(t('commander.apiUnavailable'));
        }

        // Read fresh state to avoid stale closure values
        const state = store.getState();
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
          await api.commander.injectMessage(currentCanvasId, trimmed);
          return;
        }

        // Build rich history with tool call context for LLM continuity
        const history: Array<Record<string, unknown>> = [];
        for (const entry of state.commander.messages) {
          if (entry.role === 'assistant' && entry.toolCalls && entry.toolCalls.length > 0) {
            const completedCalls = entry.toolCalls.filter(
              (tc) => tc.status === 'done' || tc.status === 'error',
            );
            if (completedCalls.length > 0) {
              // Push assistant message with tool calls attached
              history.push({
                role: 'assistant',
                content: entry.content,
                toolCalls: completedCalls.map((tc) => ({
                  id: tc.id,
                  name: tc.name,
                  arguments: tc.arguments,
                })),
              });
              // Push corresponding tool result messages
              for (const tc of completedCalls) {
                const resultStr =
                  tc.result != null
                    ? typeof tc.result === 'string'
                      ? tc.result
                      : JSON.stringify(tc.result)
                    : '';
                history.push({
                  role: 'tool',
                  content: resultStr,
                  toolCallId: tc.id,
                });
              }
            } else if (entry.content.trim().length > 0) {
              // All tool calls still pending — treat as plain text message
              history.push({ role: entry.role, content: entry.content });
            }
          } else if (entry.content.trim().length > 0) {
            history.push({ role: entry.role, content: entry.content });
          }
        }
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
            if (api.session?.upsert) {
              await api.session.upsert({
                id: sessionId,
                canvasId: currentCanvasId,
                title: '',
                messages: '[]',
                createdAt: Date.now(),
                updatedAt: Date.now(),
              });
            }
            await api.snapshot?.capture(sessionId, 'Before Commander session', 'auto');
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

        // Save current canvas to DB before Commander reads it
        const { activeCanvasId: canvasId, canvases } = state.canvas;
        const activeCanvas = canvasId ? canvases.entities[canvasId] : undefined;
        if (activeCanvas && api.canvas?.save) {
          await api.canvas.save(activeCanvas).catch(() => {});
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

        await api.commander.chat(
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
        const message = error instanceof Error ? error.message : String(error);
        dispatch(
          addLog({
            level: 'error',
            category: 'commander',
            message,
            detail: error instanceof Error ? (error.stack ?? error.message) : String(error),
          }),
        );
        dispatch(streamError(message));
      }
    },
    [dispatch],
  );
  useEffect(() => {
    const api = getAPI();
    if (!api?.commander) return;

    // Track tool call IDs to tool names for usage tracking
    const toolCallNames = new Map<string, string>();

    const unsubStream = api.commander.onStream((data) => {
      if (data.type === 'chunk' && data.content) {
        dispatch(appendStreamChunk(data.content));
        return;
      }

      if (data.type === 'thinking' && data.content) {
        dispatch(setThinkingContent(data.content));
        return;
      }

      if (data.type === 'tool_call' && data.toolName && data.toolCallId) {
        toolCallNames.set(data.toolCallId, data.toolName);
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
              ? typeof resultRecord.error === 'string'
                ? resultRecord.error
                : t('commander.toolExecutionFailed')
              : undefined,
            completedAt: data.completedAt,
          }),
        );
        // Track individual tool usage
        const toolName = data.toolName ?? toolCallNames.get(data.toolCallId);
        if (toolName) {
          dispatch(recordToolCall({ toolName, error: isError }));
          toolCallNames.delete(data.toolCallId);
        }
        // Track node/edge/entity creation from tool results
        if (toolName && !isError) {
          if (toolName === 'node.create' || toolName === 'shot.create') {
            dispatch(recordShotCreate());
            dispatch(recordProjectActivity({ nodesCreated: 1 }));
          } else if (data.toolName === 'edge.create') {
            dispatch(recordProjectActivity({ edgesCreated: 1 }));
          } else if (data.toolName === 'character.create') {
            dispatch(recordEntityCreate({ entityType: 'character' }));
          } else if (data.toolName === 'location.create') {
            dispatch(recordEntityCreate({ entityType: 'location' }));
          } else if (data.toolName === 'equipment.create') {
            dispatch(recordEntityCreate({ entityType: 'equipment' }));
          } else if (data.toolName === 'prop.create') {
            dispatch(recordEntityCreate({ entityType: 'prop' }));
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
        // Auto-resolve if user previously chose "approve all" or "skip all"
        const { confirmAutoMode } = store.getState().commander;
        if (confirmAutoMode !== 'none') {
          const approved = confirmAutoMode === 'approve';
          const cid = store.getState().canvas.activeCanvasId;
          if (api?.commander && cid) {
            void api.commander.confirmTool(cid, data.toolCallId, approved);
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

        // Persist session to SQLite on error (same as done handler below)
        const errState = store.getState() as RootState;
        const errSid = errState.commander.activeSessionId;
        if (errSid && errState.commander.messages.length > 0) {
          const errSess = errState.commander.sessions.find((s) => s.id === errSid);
          if (errSess) {
            api.session
              ?.upsert({
                id: errSess.id,
                canvasId: errState.canvas.activeCanvasId ?? null,
                title: errSess.title,
                messages: JSON.stringify(errSess.messages),
                createdAt: errSess.createdAt,
                updatedAt: errSess.updatedAt,
              })
              .catch(() => {});
          }
        }
        return;
      }

      if (data.type === 'done') {
        dispatch(finishStreaming(data.content));

        // Persist session to SQLite (fire-and-forget)
        const freshState = store.getState() as RootState;
        const sid = freshState.commander.activeSessionId;
        if (sid && freshState.commander.messages.length > 0) {
          const sess = freshState.commander.sessions.find((s) => s.id === sid);
          if (sess) {
            api.session
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
        }
      }
    });

    const unsubCanvas = api.commander.onCanvasUpdated((data) => {
      // Apply granular diffs between incoming canvas and current Redux state
      const currentState = store.getState() as RootState;
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
      // No updatedAt gate: the per-field checks below prevent unnecessary dispatches,
      // while an updatedAt gate would silently skip legitimate updates when the renderer
      // has a newer timestamp from a concurrent user edit on a different field.
      for (const inNode of incoming.nodes) {
        if (!currentNodeIds.has(inNode.id)) continue;
        const curNode = currentCanvas.nodes.find((n) => n.id === inNode.id);
        if (!curNode) continue;

        // Position changed
        if (curNode.position.x !== inNode.position.x || curNode.position.y !== inNode.position.y) {
          dispatch(moveNode({ id: inNode.id, position: inNode.position }));
        }
        // Title changed
        if (curNode.title !== inNode.title) {
          dispatch(renameNode({ id: inNode.id, title: inNode.title }));
        }
        // Data changed — update entire data object
        if (JSON.stringify(curNode.data) !== JSON.stringify(inNode.data)) {
          dispatch(updateNodeData({ id: inNode.id, data: inNode.data as Record<string, unknown> }));
        }
      }

      // Edges: detect added, removed
      const currentEdgeIds = new Set(currentCanvas.edges.map((e) => e.id));
      const incomingEdgeIds = new Set(incoming.edges.map((e) => e.id));

      // Added edges
      for (const edge of incoming.edges) {
        if (!currentEdgeIds.has(edge.id)) {
          dispatch(addEdge(edge));
        }
      }

      // Updated edges (source, target, or data changed)
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

      // Removed edges
      const removedEdgeIds = [...currentEdgeIds].filter((id) => !incomingEdgeIds.has(id));
      if (removedEdgeIds.length > 0) {
        dispatch(removeEdges(removedEdgeIds));
      }
    });

    const unsubEntities = api.commander.onEntitiesUpdated?.((data) => {
      void syncCommanderEntitiesForTool(api, dispatch, data.toolName);
    });

    const settingsActionMap: Record<string, (payload: never) => unknown> = {
      setProviderBaseUrl: setProviderBaseUrl as (p: never) => unknown,
      setProviderModel: setProviderModel as (p: never) => unknown,
      setProviderName: setProviderName as (p: never) => unknown,
      addCustomProvider: addCustomProvider as (p: never) => unknown,
      removeCustomProvider: removeCustomProvider as (p: never) => unknown,
    };

    const unsubSettings = api.commander.onSettingsDispatch?.((data) => {
      if (data.action === 'setProviderId' && typeof data.payload?.providerId === 'string') {
        dispatch(setProviderId(data.payload.providerId));
        return;
      }
      const actionCreator = settingsActionMap[data.action];
      if (actionCreator) {
        dispatch(actionCreator(data.payload as never) as never);
      }
    });

    const unsubUndo = api.commander.onUndoDispatch?.((data) => {
      if (data.action === 'undo') {
        dispatch({ type: 'undo/undo' });
      } else if (data.action === 'redo') {
        dispatch({ type: 'undo/redo' });
      }
    });

    return () => {
      unsubStream();
      unsubCanvas();
      unsubEntities?.();
      unsubSettings?.();
      unsubUndo?.();
    };
  }, [dispatch]);

  const cancel = useCallback(async () => {
    const api = getAPI();
    if (!api?.commander) {
      dispatch(finishStreaming(undefined));
      return;
    }
    // Always finalize streaming on the renderer side first — the main process
    // session may already be gone (error/timeout already cleaned it up).
    dispatch(finishStreaming(undefined));

    if (activeCanvasId) {
      try {
        await api.commander.cancel(activeCanvasId);
      } catch {
        // Main-process session already gone — safe to ignore
      }
    }
  }, [activeCanvasId, dispatch]);

  return { sendMessage, cancel, isStreaming };
}
