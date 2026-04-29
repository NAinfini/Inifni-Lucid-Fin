import type { BrowserWindow } from 'electron';
import { registerAllHandlers, type AppDeps } from '../ipc/router.js';

export function initIpc(getWindow: () => BrowserWindow | null, deps: AppDeps): void {
  registerAllHandlers(getWindow, deps);
}
