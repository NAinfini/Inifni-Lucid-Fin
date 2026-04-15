import type { IpcMain } from 'electron';
import type { ProcessPromptStore } from '@lucid-fin/storage';

export function registerProcessPromptHandlers(
  ipcMain: Pick<IpcMain, 'handle'>,
  processPromptStore: ProcessPromptStore,
): void {
  ipcMain.handle('processPrompt:list', () => processPromptStore.list());

  ipcMain.handle('processPrompt:get', (_event, args: { processKey: string }) => {
    const prompt = processPromptStore.get(args.processKey);
    if (!prompt) {
      throw new Error(`Process prompt not found: ${args.processKey}`);
    }
    return prompt;
  });

  ipcMain.handle(
    'processPrompt:setCustom',
    (_event, args: { processKey: string; value: string }) => {
      processPromptStore.setCustom(args.processKey, args.value);
    },
  );

  ipcMain.handle('processPrompt:reset', (_event, args: { processKey: string }) => {
    processPromptStore.resetToDefault(args.processKey);
  });
}
