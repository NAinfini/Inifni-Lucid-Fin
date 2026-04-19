import { describe, expect, it, vi } from 'vitest';
import { createColorStyleTools, type ColorStyleToolDeps } from './color-style-tools.js';

function createDeps(): ColorStyleToolDeps {
  return {
    listColorStyles: vi.fn(async () => [
      { id: 'style-1', name: 'Warm' },
      { id: 'style-2', name: 'Cool' },
    ]),
    saveColorStyle: vi.fn(async () => undefined),
    deleteColorStyle: vi.fn(async () => undefined),
  };
}

function getTool(name: string, deps: ColorStyleToolDeps) {
  const tool = createColorStyleTools(deps).find((entry) => entry.name === name);
  if (!tool) throw new Error(`Missing tool: ${name}`);
  return tool;
}

describe('createColorStyleTools', () => {
  it('defines the expected tool names and tiers', () => {
    const deps = createDeps();
    const tools = createColorStyleTools(deps);

    expect(tools.map((tool) => [tool.name, tool.tier])).toEqual([
      ['colorStyle.list', 1],
      ['colorStyle.save', 2],
      ['colorStyle.delete', 3],
    ]);
  });

  it('lists styles with pagination', async () => {
    const deps = createDeps();

    await expect(getTool('colorStyle.list', deps).execute({ offset: 1, limit: 1 })).resolves.toEqual({
      success: true,
      data: {
        total: 2,
        offset: 1,
        limit: 1,
        colorStyles: [{ id: 'style-2', name: 'Cool' }],
      },
    });
  });

  it('saves and deletes styles using dependencies', async () => {
    const deps = createDeps();
    const style = { id: 'style-3', name: 'Noir', palette: ['#000000'] };

    await expect(getTool('colorStyle.save', deps).execute({ style })).resolves.toEqual({
      success: true,
      data: { style },
    });
    expect(deps.saveColorStyle).toHaveBeenCalledWith(style);

    await expect(getTool('colorStyle.delete', deps).execute({ id: 'style-3' })).resolves.toEqual({
      success: true,
      data: { id: 'style-3' },
    });
    expect(deps.deleteColorStyle).toHaveBeenCalledWith('style-3');
  });

  it('validates required arguments and wraps dependency errors', async () => {
    const deps = createDeps();
    vi.mocked(deps.deleteColorStyle).mockRejectedValueOnce(new Error('cannot delete'));

    await expect(getTool('colorStyle.save', deps).execute({ style: [] })).resolves.toEqual({
      success: false,
      error: 'style is required',
    });
    await expect(getTool('colorStyle.delete', deps).execute({ id: '  ' })).resolves.toEqual({
      success: false,
      error: 'id is required',
      errorClass: 'validation',
    });
    await expect(getTool('colorStyle.delete', deps).execute({ id: 'style-1' })).resolves.toEqual({
      success: false,
      error: 'cannot delete',
    });
  });
});
