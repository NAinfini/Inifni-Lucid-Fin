import { describe, expect, it, vi } from 'vitest';
import { createPromptTools, type PromptToolDeps } from './prompt-tools.js';

function createDeps(): PromptToolDeps {
  return {
    listPrompts: vi.fn(async () => [
      { code: 'scene.system', name: 'Scene', type: 'system', hasCustom: false },
      { code: 'shot.user', name: 'Shot', type: 'user', hasCustom: true },
    ]),
    getPrompt: vi.fn(async (code: string) => (code === 'scene.system'
      ? { code, name: 'Scene', defaultValue: 'default', customValue: null }
      : null)),
    setCustomPrompt: vi.fn(async () => undefined),
    clearCustomPrompt: vi.fn(async () => undefined),
  };
}

function getTool(name: string, deps: PromptToolDeps) {
  const tool = createPromptTools(deps).find((entry) => entry.name === name);
  if (!tool) throw new Error(`Missing tool: ${name}`);
  return tool;
}

describe('createPromptTools', () => {
  it('defines prompt tools with expected names', () => {
    const deps = createDeps();
    expect(createPromptTools(deps).map((tool) => tool.name)).toEqual([
      'prompt.list',
      'prompt.get',
      'prompt.setCustom',
      'prompt.clearCustom',
    ]);
  });

  it('lists, gets, sets, and clears prompts', async () => {
    const deps = createDeps();

    await expect(getTool('prompt.list', deps).execute({ offset: 1, limit: 1 })).resolves.toEqual({
      success: true,
      data: {
        total: 2,
        offset: 1,
        limit: 1,
        prompts: [{ code: 'shot.user', name: 'Shot', type: 'user', hasCustom: true }],
      },
    });
    await expect(getTool('prompt.get', deps).execute({ code: 'scene.system' })).resolves.toEqual({
      success: true,
      data: {
        code: 'scene.system',
        name: 'Scene',
        defaultValue: 'default',
        customValue: null,
      },
    });
    await expect(getTool('prompt.setCustom', deps).execute({
      code: 'scene.system',
      value: ' custom ',
    })).resolves.toEqual({
      success: true,
      data: { code: 'scene.system' },
    });
    expect(deps.setCustomPrompt).toHaveBeenCalledWith('scene.system', 'custom');

    await expect(getTool('prompt.clearCustom', deps).execute({ code: 'scene.system' })).resolves.toEqual({
      success: true,
      data: { code: 'scene.system' },
    });
  });

  it('validates prompt identifiers, values, missing prompts, and dependency failures', async () => {
    const deps = createDeps();
    vi.mocked(deps.clearCustomPrompt).mockRejectedValueOnce(new Error('clear failed'));

    await expect(getTool('prompt.get', deps).execute({ code: 'missing' })).resolves.toEqual({
      success: false,
      error: 'Prompt not found: missing',
    });
    await expect(getTool('prompt.setCustom', deps).execute({ code: 'scene.system', value: '' })).resolves.toEqual({
      success: false,
      error: 'value is required',
    });
    await expect(getTool('prompt.clearCustom', deps).execute({ code: 'scene.system' })).resolves.toEqual({
      success: false,
      error: 'clear failed',
    });
  });
});
