import type { IpcMain, BrowserWindow } from 'electron';
import log from '../../logger.js';
import type { AgentOrchestrator, AgentEvent } from '@lucid-fin/application';
import type { PromptStore } from '@lucid-fin/storage';

export function registerAiHandlers(
  ipcMain: IpcMain,
  getWindow: () => BrowserWindow | null,
  agent: AgentOrchestrator | null,
  promptStore: PromptStore,
): void {
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

      const win = getWindow();

      const emit = (event: AgentEvent) => {
        if (!win || win.isDestroyed()) return;
        if (event.type === 'stream_chunk' && event.content) {
          win.webContents.send('ai:stream', event.content);
        }
        win.webContents.send('ai:event', event);
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
        if (win && !win.isDestroyed()) win.webContents.send('ai:stream', msg);
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
