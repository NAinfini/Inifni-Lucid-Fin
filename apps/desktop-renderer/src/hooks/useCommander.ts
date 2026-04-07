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
import { applyCanvasFromCommander } from '../store/slices/canvas.js';
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
        throw new Error('Commander API unavailable');
      }

      const trimmed = message.trim();
      if (!trimmed) return;

      // Read fresh state to avoid stale closure values
      const state = store.getState();
      const currentCanvasId = state.canvas.activeCanvasId;
      if (!currentCanvasId) {
        throw new Error('No active canvas selected');
      }

      if (state.commander.streaming) {
        dispatch(addUserMessage(trimmed));
        await api.commander.injectMessage(currentCanvasId, trimmed);
        return;
      }

      const history = state.commander.messages
        .filter((entry) => entry.content.trim().length > 0)
        .map((entry) => ({ role: entry.role, content: entry.content }));
      const activeTemplates = selectActiveTemplates(state.promptTemplates.templates);
      const llmSettings = state.settings.llm;
      const selectedNodeIds = state.canvas.selectedNodeIds;

      dispatch(addUserMessage(trimmed));
      dispatch(startStreaming());

      const activeProvider =
        llmSettings.providers.find((p) => p.id === state.commander.providerId) ??
        llmSettings.providers[0];
      const customLLMProvider = activeProvider
        ? normalizeLLMProviderRuntimeConfig({
            id: activeProvider.id,
            name: activeProvider.name,
            baseUrl: activeProvider.baseUrl,
            model: activeProvider.model,
            protocol: activeProvider.protocol,
            authStyle: activeProvider.authStyle,
          })
        : undefined;
      const permissionMode = state.commander.permissionMode;

      try {
        await api.commander.chat(currentCanvasId, trimmed, history, selectedNodeIds, activeTemplates, customLLMProvider, permissionMode);
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
          addLog({
            level: 'debug',
            category: 'commander',
            message: `Tool: ${data.toolName}`,
            detail: data.arguments ? JSON.stringify(data.arguments, null, 2) : undefined,
          }),
        );
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
        if (data.toolName) {
          const resultSummary = data.result != null ? JSON.stringify(data.result).slice(0, 500) : '';
          const errorMsg = resultRecord?.success === false
            ? (typeof resultRecord.error === 'string' ? resultRecord.error : 'Tool execution failed')
            : undefined;
          dispatch(
            addLog({
              level: errorMsg ? 'warn' : 'debug',
              category: 'commander',
              message: `Result: ${data.toolName}${errorMsg ? ` — ${errorMsg}` : ''}`,
              detail: resultSummary || undefined,
            }),
          );
        }
        dispatch(
          resolveToolCall({
            id: data.toolCallId,
            result: data.result,
            error:
              resultRecord?.success === false
                ? typeof resultRecord.error === 'string'
                  ? resultRecord.error
                  : 'Tool execution failed'
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
        const errMsg = data.error ?? 'Unknown error';
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
              error: data.error ?? 'Tool execution failed',
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
      dispatch(applyCanvasFromCommander(data.canvas));
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dispatch]);

  const cancel = useCallback(async () => {
    const api = getAPI();
    if (!api?.commander) {
      throw new Error('Commander API unavailable');
    }
    if (!activeCanvasId) {
      throw new Error('No active canvas selected');
    }
    await api.commander.cancel(activeCanvasId);
  }, [activeCanvasId]);

  return { sendMessage, cancel, isStreaming };
}
