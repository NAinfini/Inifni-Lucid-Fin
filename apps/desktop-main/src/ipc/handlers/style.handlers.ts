import type { IpcMain } from 'electron';
import type { StyleGuide } from '@lucid-fin/contracts';
import type { SqliteIndex } from '@lucid-fin/storage';

const STYLE_GUIDE_KEY = 'styleGuide';

function isStyleGuide(v: unknown): v is StyleGuide {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  return (
    !!o.global &&
    typeof o.global === 'object' &&
    !!o.sceneOverrides &&
    typeof o.sceneOverrides === 'object'
  );
}

const DEFAULT_STYLE_GUIDE: StyleGuide = {
  global: {
    artStyle: '',
    colorPalette: { primary: '', secondary: '', forbidden: [] },
    lighting: 'natural',
    texture: '',
    referenceImages: [],
    freeformDescription: '',
  },
  sceneOverrides: {},
};

export function loadStyleGuide(db: SqliteIndex): StyleGuide {
  const stored = db.repos.projectSettings.getJson<StyleGuide>(STYLE_GUIDE_KEY);
  return stored && isStyleGuide(stored) ? stored : DEFAULT_STYLE_GUIDE;
}

export function registerStyleHandlers(ipcMain: IpcMain, db: SqliteIndex): void {
  ipcMain.handle('style:save', async (_e, args: StyleGuide) => {
    if (!isStyleGuide(args)) throw new Error('Invalid style guide payload');
    db.repos.projectSettings.setJson(STYLE_GUIDE_KEY, args);
  });

  ipcMain.handle('style:load', async () => {
    return loadStyleGuide(db);
  });
}
