import type { BrowserWindow } from 'electron';
import { registerAllHandlers, type AppDeps } from '../ipc/router.js';

export async function initIpc(getWindow: () => BrowserWindow | null, deps: AppDeps): Promise<void> {
  await registerAllHandlers(getWindow, deps);
}
