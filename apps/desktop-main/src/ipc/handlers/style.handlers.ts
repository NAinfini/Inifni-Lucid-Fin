import type { IpcMain } from 'electron';
import type { StyleGuide } from '@lucid-fin/contracts';

let cachedStyleGuide: StyleGuide | null = null;

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

/** Called by settings handlers to warm the cache on boot. */
export function primeStyleGuideCache(guide: StyleGuide | null): void {
  if (guide && isStyleGuide(guide)) cachedStyleGuide = guide;
}

export function registerStyleHandlers(ipcMain: IpcMain): void {
  ipcMain.handle('style:save', async (_e, args: StyleGuide) => {
    if (!isStyleGuide(args)) throw new Error('Invalid style guide payload');
    cachedStyleGuide = args;
  });

  ipcMain.handle('style:load', async () => {
    return cachedStyleGuide ?? DEFAULT_STYLE_GUIDE;
  });
}
