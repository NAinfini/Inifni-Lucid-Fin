/**
 * Phase 1 — canvas.getSettings / canvas.setSettings tools.
 *
 * Uses a minimal in-memory deps double (no SqliteIndex) so we can
 * verify tool-level behavior: optional-dep guards, patch semantics
 * (null clears, undefined leaves alone), enum passthrough, and
 * Canvas not-found error propagation.
 */
import { describe, expect, it, vi } from 'vitest';
import type { Canvas, CanvasSettings } from '@lucid-fin/contracts';
import { createCanvasCoreTools } from './canvas-core-tools.js';
import type { CanvasToolDeps } from './canvas-tool-utils.js';

function createCanvas(settings?: CanvasSettings): Canvas {
  return {
    id: 'canvas-settings-1',
    name: 'Settings Canvas',
    nodes: [],
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    notes: [],
    settings,
    createdAt: 1,
    updatedAt: 1,
  };
}

function createDeps(canvas: Canvas): Partial<CanvasToolDeps> {
  const current: CanvasSettings = { ...(canvas.settings ?? {}) };
  return {
    getCanvas: vi.fn(async (canvasId: string) => {
      if (canvasId !== canvas.id) throw new Error(`Canvas not found: ${canvasId}`);
      return canvas;
    }),
    getCanvasSettings: vi.fn(async () => ({ ...current })),
    patchCanvasSettings: vi.fn(async (_canvasId: string, patch: CanvasSettings) => {
      for (const [rawKey, value] of Object.entries(patch)) {
        const key = rawKey as keyof CanvasSettings;
        if (value === null || value === undefined) {
          delete current[key];
        } else {
          (current as Record<string, unknown>)[key] = value;
        }
      }
      return { ...current };
    }),
  };
}

function findTool(deps: Partial<CanvasToolDeps>, name: string) {
  const { tools } = createCanvasCoreTools(deps as CanvasToolDeps);
  const tool = tools.find((t) => t.name === name);
  if (!tool) throw new Error(`Tool not registered: ${name}`);
  return tool;
}

describe('canvas.getSettings / canvas.setSettings', () => {
  it('returns empty object when canvas has no overrides', async () => {
    const canvas = createCanvas();
    const deps = createDeps(canvas);
    const tool = findTool(deps, 'canvas.getSettings');

    const result = await tool.execute({ canvasId: canvas.id });

    expect(result.success).toBe(true);
    expect((result as { data: { settings: CanvasSettings } }).data.settings).toEqual({});
  });

  it('returns current settings snapshot', async () => {
    const canvas = createCanvas({ aspectRatio: '9:16', stylePlate: 'neo-noir watercolor' });
    const deps = createDeps(canvas);
    const tool = findTool(deps, 'canvas.getSettings');

    const result = await tool.execute({ canvasId: canvas.id });

    expect(result.success).toBe(true);
    const data = (result as { data: { settings: CanvasSettings } }).data;
    expect(data.settings.aspectRatio).toBe('9:16');
    expect(data.settings.stylePlate).toBe('neo-noir watercolor');
  });

  it('reports failure when getCanvasSettings dep is missing', async () => {
    const canvas = createCanvas();
    const deps = createDeps(canvas);
    delete deps.getCanvasSettings;
    const tool = findTool(deps, 'canvas.getSettings');

    const result = await tool.execute({ canvasId: canvas.id });

    expect(result.success).toBe(false);
  });

  it('patches string fields via setSettings', async () => {
    const canvas = createCanvas();
    const deps = createDeps(canvas);
    const tool = findTool(deps, 'canvas.setSettings');

    const result = await tool.execute({
      canvasId: canvas.id,
      aspectRatio: '2.39:1',
      imageProviderId: 'gemini-3-pro-image-preview',
    });

    expect(result.success).toBe(true);
    const patchCall = (deps.patchCanvasSettings as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(patchCall[1]).toEqual({
      aspectRatio: '2.39:1',
      imageProviderId: 'gemini-3-pro-image-preview',
    });
  });

  it('forwards null to clear a field', async () => {
    const canvas = createCanvas({ stylePlate: 'noir watercolor', aspectRatio: '16:9' });
    const deps = createDeps(canvas);
    const tool = findTool(deps, 'canvas.setSettings');

    const result = await tool.execute({
      canvasId: canvas.id,
      stylePlate: null,
    });

    expect(result.success).toBe(true);
    const patchCall = (deps.patchCanvasSettings as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(patchCall[1]).toEqual({ stylePlate: null });
    const returned = (result as { data: { settings: CanvasSettings } }).data.settings;
    expect(returned.stylePlate).toBeUndefined();
    expect(returned.aspectRatio).toBe('16:9');
  });

  it('ignores absent keys (does not overwrite existing)', async () => {
    const canvas = createCanvas({ aspectRatio: '1:1', llmProviderId: 'anthropic' });
    const deps = createDeps(canvas);
    const tool = findTool(deps, 'canvas.setSettings');

    const result = await tool.execute({ canvasId: canvas.id, aspectRatio: '16:9' });

    expect(result.success).toBe(true);
    const patchCall = (deps.patchCanvasSettings as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(patchCall[1]).toEqual({ aspectRatio: '16:9' });
    const returned = (result as { data: { settings: CanvasSettings } }).data.settings;
    expect(returned.aspectRatio).toBe('16:9');
    expect(returned.llmProviderId).toBe('anthropic');
  });

  it('propagates canvas-not-found error', async () => {
    const canvas = createCanvas();
    const deps = createDeps(canvas);
    const tool = findTool(deps, 'canvas.setSettings');

    const result = await tool.execute({ canvasId: 'missing' });

    expect(result.success).toBe(false);
    expect(deps.patchCanvasSettings).not.toHaveBeenCalled();
  });

  it('patches defaultResolution object via setSettings', async () => {
    const canvas = createCanvas();
    const deps = createDeps(canvas);
    const tool = findTool(deps, 'canvas.setSettings');

    const result = await tool.execute({
      canvasId: canvas.id,
      defaultResolution: { width: 1536, height: 1024 },
    });

    expect(result.success).toBe(true);
    const patchCall = (deps.patchCanvasSettings as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(patchCall[1]).toEqual({ defaultResolution: { width: 1536, height: 1024 } });
  });

  it('rejects defaultResolution with non-positive dimensions', async () => {
    const canvas = createCanvas();
    const deps = createDeps(canvas);
    const tool = findTool(deps, 'canvas.setSettings');

    const result = await tool.execute({
      canvasId: canvas.id,
      defaultResolution: { width: 0, height: 1024 },
    });

    expect(result.success).toBe(false);
    expect(deps.patchCanvasSettings).not.toHaveBeenCalled();
  });

  it('patches negativePrompt via setSettings', async () => {
    const canvas = createCanvas();
    const deps = createDeps(canvas);
    const tool = findTool(deps, 'canvas.setSettings');

    const result = await tool.execute({
      canvasId: canvas.id,
      negativePrompt: 'text, watermark, blurry',
    });

    expect(result.success).toBe(true);
    const patchCall = (deps.patchCanvasSettings as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(patchCall[1]).toEqual({ negativePrompt: 'text, watermark, blurry' });
  });
});
