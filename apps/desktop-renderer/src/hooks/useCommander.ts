import { useCallback, useEffect } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { normalizeLLMProviderRuntimeConfig } from '@lucid-fin/contracts';
import { store, type AppDispatch, type RootState } from '../store/index.js';
import {
  addToolCall,
  addUserMessage,
  appendStreamChunk,
  finishStreaming,
  resolveToolCall,
  setProviderId,
  setPendingConfirmation,
  setPendingQuestion,
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
import {
  setProviderBaseUrl,
  setProviderModel,
  setProviderName,
  addCustomProvider,
  removeCustomProvider,
} from '../store/slices/settings.js';
import { selectActiveTemplates } from '../store/slices/promptTemplates.js';
import { addLog } from '../store/slices/logger.js';
import { t, getLocale } from '../i18n.js';
import { getAPI, type LucidAPI } from '../utils/api.js';

type CommanderEntityAPI = Pick<NonNullable<LucidAPI>, 'character' | 'equipment' | 'location'>;

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
      const api = getAPI();
      if (!api?.commander) {
        throw new Error(t('commander.apiUnavailable'));
      }

      const trimmed = message.trim();
      if (!trimmed) return;

      // Read fresh state to avoid stale closure values
      const state = store.getState();
      const currentCanvasId = state.canvas.activeCanvasId;
      if (!currentCanvasId) {
        throw new Error(t('commander.noActiveCanvas'));
      }

      if (state.commander.streaming) {
        dispatch(addUserMessage(trimmed));
        await api.commander.injectMessage(currentCanvasId, trimmed);
        return;
      }

      // Build rich history with tool call context for LLM continuity
      const history: Array<Record<string, unknown>> = [];
      for (const entry of state.commander.messages) {
        if (entry.role === 'assistant' && entry.toolCalls && entry.toolCalls.length > 0) {
          const completedCalls = entry.toolCalls.filter((tc) => tc.status === 'done' || tc.status === 'error');
          if (completedCalls.length > 0) {
            // Push assistant message with tool calls attached
            history.push({
              role: 'assistant',
              content: entry.content,
              toolCalls: completedCalls.map((tc) => ({ id: tc.id, name: tc.name, arguments: tc.arguments })),
            });
            // Push corresponding tool result messages
            for (const tc of completedCalls) {
              const resultStr = tc.result != null ? (typeof tc.result === 'string' ? tc.result : JSON.stringify(tc.result)) : '';
              // Truncate tool results to avoid bloating context
              const truncated = resultStr.length > 2000 ? resultStr.slice(0, 2000) + '...(truncated)' : resultStr;
              history.push({
                role: 'tool',
                content: truncated,
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
      const activeTemplates = selectActiveTemplates(state.promptTemplates.templates);
      const llmSettings = state.settings.llm;
      const selectedNodeIds = state.canvas.selectedNodeIds;

      // Save current canvas to DB before Commander reads it
      const { activeCanvasId: canvasId, canvases } = state.canvas;
      const activeCanvas = canvases.find((c) => c.id === canvasId);
      if (activeCanvas && api.canvas?.save) {
        await api.canvas.save(activeCanvas).catch(() => {});
      }

      dispatch(addUserMessage(trimmed));
      dispatch(startStreaming());

      const llmProviders = llmSettings?.providers ?? [];
      const activeProvider =
        llmProviders.find((p) => p.id === state.commander.providerId) ??
        llmProviders[0];
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

      try {
        await api.commander.chat(currentCanvasId, trimmed, history, selectedNodeIds, activeTemplates, customLLMProvider, permissionMode, getLocale(), maxSteps, temperature, maxTokens);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        dispatch(
          addLog({
            level: 'error',
            category: 'commander',
            message,
            detail: error instanceof Error ? error.stack ?? error.message : String(error),
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

    const unsubStream = api.commander.onStream((data) => {
      if (data.type === 'chunk' && data.content) {
        dispatch(appendStreamChunk(data.content));
        return;
      }

      if (data.type === 'tool_call' && data.toolName && data.toolCallId) {
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
        dispatch(
          resolveToolCall({
            id: data.toolCallId,
            result: data.result,
              error:
              resultRecord?.success === false
                ? typeof resultRecord.error === 'string'
                  ? resultRecord.error
                  : t('commander.toolExecutionFailed')
                : undefined,
            completedAt: data.completedAt,
          }),
        );
        return;
      }

      if (data.type === 'tool_confirm' && data.toolCallId && data.toolName) {
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
            options: (data as { options?: Array<{ label: string; description?: string }> }).options ?? [],
          }),
        );
        return;
      }

      if (data.type === 'error') {
        const errMsg = data.error ?? t('commander.unknownError');
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
        return;
      }

      if (data.type === 'done') {
        dispatch(finishStreaming(data.content));
      }
    });

    const unsubCanvas = api.commander.onCanvasUpdated((data) => {
      // Apply granular diffs between incoming canvas and current Redux state
      const currentState = store.getState() as RootState;
      const currentCanvas = currentState.canvas.canvases.find((c) => c.id === data.canvasId);
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
          dispatch(addNode({
            id: node.id,
            type: node.type,
            title: node.title,
            position: node.position,
            data: node.data,
            width: node.width,
            height: node.height,
          }));
        }
      }

      // Removed nodes
      const removedNodeIds = [...currentNodeIds].filter((id) => !incomingNodeIds.has(id));
      if (removedNodeIds.length > 0) {
        dispatch(removeNodes(removedNodeIds));
      }

      // Updated nodes (compare updatedAt timestamp)
      for (const inNode of incoming.nodes) {
        if (!currentNodeIds.has(inNode.id)) continue;
        const curNode = currentCanvas.nodes.find((n) => n.id === inNode.id);
        if (!curNode || curNode.updatedAt >= inNode.updatedAt) continue;

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
      if (
        data.action === 'setProviderId' &&
        typeof data.payload?.providerId === 'string'
      ) {
        dispatch(setProviderId(data.payload.providerId));
        return;
      }
      const actionCreator = settingsActionMap[data.action];
      if (actionCreator) {
        dispatch(actionCreator(data.payload as never) as never);
      }
    });

    return () => {
      unsubStream();
      unsubCanvas();
      unsubEntities?.();
      unsubSettings?.();
    };
  }, [dispatch]);

  const cancel = useCallback(async () => {
    const api = getAPI();
    if (!api?.commander) {
      throw new Error(t('commander.apiUnavailable'));
    }
    if (!activeCanvasId) {
      throw new Error(t('commander.noActiveCanvas'));
    }
    await api.commander.cancel(activeCanvasId);
  }, [activeCanvasId]);

  return { sendMessage, cancel, isStreaming };
}
