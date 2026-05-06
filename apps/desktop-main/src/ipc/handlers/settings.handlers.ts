import type { IpcMain } from 'electron';
import type { SqliteIndex } from '@lucid-fin/storage';
import log from '../../logger.js';
import { updateSettingsCache } from '../settings-cache.js';

export const APP_SETTINGS_KEY = 'appSettings';

function parseSettings(raw: string): Record<string, unknown> {
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Stored app settings must be an object');
  }
  return parsed as Record<string, unknown>;
}

function assertSettingsObject(data: unknown): asserts data is Record<string, unknown> {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('settings:save requires an object payload');
  }
}

export function registerSettingsHandlers(ipcMain: IpcMain, db: SqliteIndex): void {
  ipcMain.handle('settings:load', async () => {
    const raw = db.repos.projectSettings.get(APP_SETTINGS_KEY);
    if (raw === undefined) return null;
    try {
      const loaded = parseSettings(raw);
      updateSettingsCache(loaded);
      return loaded;
    } catch (err) {
      log.error('Failed to load app settings from SQL', { error: String(err) });
      throw err;
    }
  });

  ipcMain.handle('settings:save', async (_event, data: unknown) => {
    assertSettingsObject(data);
    db.repos.projectSettings.set(APP_SETTINGS_KEY, JSON.stringify(data));
    updateSettingsCache(data);
  });
}
