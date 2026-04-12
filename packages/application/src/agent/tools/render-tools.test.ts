import { describe, expect, it, vi } from 'vitest';
import { createRenderTools, type RenderToolDeps } from './render-tools.js';

function createDeps(): RenderToolDeps {
  return {
    startRender: vi.fn(async () => ({ renderId: 'render-1' })),
    cancelRender: vi.fn(async () => undefined),
    exportBundle: vi.fn(async (_canvasId: string, _format: string, outputPath: string) => ({ path: outputPath })),
  };
}

function getTool(name: string, deps: RenderToolDeps) {
  const tool = createRenderTools(deps).find((entry) => entry.name === name);
  if (!tool) throw new Error(`Missing tool: ${name}`);
  return tool;
}

describe('createRenderTools', () => {
  it('defines render tools in canvas context', () => {
    const deps = createDeps();
    const tools = createRenderTools(deps);

    expect(tools.map((tool) => tool.name)).toEqual(['render.control', 'render.exportBundle']);
    expect(tools.every((tool) => tool.context?.includes('canvas'))).toBe(true);
  });

  it('starts, cancels, and exports renders', async () => {
    const deps = createDeps();

    await expect(getTool('render.control', deps).execute({
      action: 'start',
      canvasId: 'canvas-1',
      format: 'mp4',
      outputPath: ' C:/tmp/out.mp4 ',
    })).resolves.toEqual({ success: true, data: { renderId: 'render-1' } });
    expect(deps.startRender).toHaveBeenCalledWith('canvas-1', 'mp4', 'C:/tmp/out.mp4');

    await expect(getTool('render.control', deps).execute({ action: 'cancel', canvasId: 'canvas-1' })).resolves.toEqual({
      success: true,
      data: { canvasId: 'canvas-1' },
    });

    await expect(getTool('render.exportBundle', deps).execute({
      canvasId: 'canvas-1',
      format: 'fcpxml',
      outputPath: 'C:/tmp/out.fcpxml',
    })).resolves.toEqual({
      success: true,
      data: { path: 'C:/tmp/out.fcpxml' },
    });
  });

  it('validates required strings, export formats, and dependency failures', async () => {
    const deps = createDeps();
    vi.mocked(deps.cancelRender).mockRejectedValueOnce(new Error('cancel failed'));

    await expect(getTool('render.control', deps).execute({ action: 'start', canvasId: '', format: 'mp4' })).resolves.toEqual({
      success: false,
      error: 'canvasId is required',
    });
    await expect(getTool('render.exportBundle', deps).execute({
      canvasId: 'canvas-1',
      format: 'zip',
      outputPath: 'C:/tmp/out.zip',
    })).resolves.toEqual({
      success: false,
      error: 'format must be "fcpxml" or "edl"',
    });
    await expect(getTool('render.control', deps).execute({ action: 'cancel', canvasId: 'canvas-1' })).resolves.toEqual({
      success: false,
      error: 'cancel failed',
    });
  });
});
