import type { IpcMain, BrowserWindow } from 'electron';
import { aiStreamChannel, aiEventChannel } from '@lucid-fin/contracts-parse';
import { COMMANDER_WIRE_VERSION } from '@lucid-fin/contracts';
import log from '../../logger.js';
import type { AgentOrchestrator, StampedStreamEvent } from '@lucid-fin/application';
import type { PromptStore } from '@lucid-fin/storage';
import {
  createRendererPushGateway,
  type RendererPushGateway,
} from '../../features/ipc/push-gateway.js';

export function registerAiHandlers(
  ipcMain: IpcMain,
  getWindow: () => BrowserWindow | null,
  agent: AgentOrchestrator | null,
  promptStore: PromptStore,
  pushGateway?: RendererPushGateway,
): void {
  // `ai:stream` and `ai:event` are typed push channels; route them through
  // the gateway so payload drift surfaces loudly in main instead of silently
  // in the renderer. Fall back to a locally-constructed gateway when callers
  // predate Phase F-split-6.
  const gateway = pushGateway ?? createRendererPushGateway({ getWindow });

  ipcMain.handle(
    'ai:chat',
    async (
      _e,
      args: {
        message: string;
        context?: Record<string, unknown>;
      },
    ) => {
      if (!args || typeof args.message !== 'string' || !args.message.trim()) {
        throw new Error('message is required');
      }

      if (!agent) {
        throw new Error('No LLM adapter configured. Please set an API key in Settings.');
      }

      const emit = (event: StampedStreamEvent) => {
        if (event.kind === 'assistant_text' && event.content && event.isDelta !== false) {
          gateway.emit(aiStreamChannel, event.content);
        }
        gateway.emit(aiEventChannel, {
          wireVersion: COMMANDER_WIRE_VERSION,
          event,
        });
      };

      try {
        const result = await agent.execute(
          args.message,
          (args.context ?? {}) as Record<string, unknown>,
          emit,
        );
        return result.content;
      } catch (err) {
        log.error('AI agent error:', err);
        const msg = err instanceof Error ? err.message : 'AI agent failed';
        gateway.emit(aiStreamChannel, msg);
        return msg;
      }
    },
  );

  // Prompt template CRUD
  ipcMain.handle('ai:prompt:list', () => {
    return promptStore.list().map((p) => ({
      code: p.code,
      name: p.name,
      type: p.type,
      hasCustom: p.customValue !== null,
    }));
  });

  ipcMain.handle('ai:prompt:get', (_e, args: { code: string }) => {
    const p = promptStore.get(args.code);
    if (!p) throw new Error(`Prompt not found: ${args.code}`);
    return { code: p.code, name: p.name, defaultValue: p.defaultValue, customValue: p.customValue };
  });

  ipcMain.handle('ai:prompt:setCustom', (_e, args: { code: string; value: string }) => {
    promptStore.setCustom(args.code, args.value);
  });

  ipcMain.handle('ai:prompt:clearCustom', (_e, args: { code: string }) => {
    promptStore.clearCustom(args.code);
  });
}
