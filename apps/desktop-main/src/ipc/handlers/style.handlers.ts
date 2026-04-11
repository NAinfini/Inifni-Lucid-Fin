import type { IpcMain } from 'electron';
import fs from 'node:fs';
import type { StyleGuide, ProjectManifest } from '@lucid-fin/contracts';
import { getCurrentProjectPath } from '../project-context.js';
import { assertWithinRoot } from '../validation.js';

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

function requireProjectPath(): string {
  const p = getCurrentProjectPath();
  if (!p) throw new Error('No project open');
  return p;
}

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

export function registerStyleHandlers(ipcMain: IpcMain): void {
  ipcMain.handle('style:save', async (_e, args: StyleGuide) => {
    if (!isStyleGuide(args)) throw new Error('Invalid style guide payload');
    const projectPath = requireProjectPath();

    // Write style-guide.json
    const stylePath = assertWithinRoot(projectPath, 'style-guide.json');
    fs.writeFileSync(stylePath, JSON.stringify(args, null, 2), 'utf-8');

    // Sync to project.json manifest
    const manifestPath = assertWithinRoot(projectPath, 'project.json');
    if (fs.existsSync(manifestPath)) {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as ProjectManifest;
      manifest.styleGuide = args;
      manifest.updatedAt = Date.now();
      fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');
    }
  });

  ipcMain.handle('style:load', async () => {
    const projectPath = requireProjectPath();
    const stylePath = assertWithinRoot(projectPath, 'style-guide.json');

    if (fs.existsSync(stylePath)) {
      const raw = JSON.parse(fs.readFileSync(stylePath, 'utf-8')) as unknown;
      if (isStyleGuide(raw)) return raw;
    }

    // Fallback: read from manifest
    const manifestPath = assertWithinRoot(projectPath, 'project.json');
    if (fs.existsSync(manifestPath)) {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as ProjectManifest;
      if (isStyleGuide(manifest.styleGuide)) {
        fs.writeFileSync(stylePath, JSON.stringify(manifest.styleGuide, null, 2), 'utf-8');
        return manifest.styleGuide;
      }
    }

    // Write default
    fs.writeFileSync(stylePath, JSON.stringify(DEFAULT_STYLE_GUIDE, null, 2), 'utf-8');
    return DEFAULT_STYLE_GUIDE;
  });
}
