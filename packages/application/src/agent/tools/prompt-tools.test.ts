import { describe, expect, it, vi } from 'vitest';
import { createPromptTools, type PromptToolDeps } from './prompt-tools.js';

function createDeps(): PromptToolDeps {
  return {
    listPrompts: vi.fn(async () => [
      { code: 'scene.system', name: 'Scene', type: 'system', hasCustom: false },
      { code: 'shot.user', name: 'Shot', type: 'user', hasCustom: true },
    ]),
    getPrompt: vi.fn(async (code: string) =>
      code === 'scene.system'
        ? { code, name: 'Scene', defaultValue: 'default', customValue: null }
        : null,
    ),
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
      'prompt.get',
      'prompt.setCustom',
    ]);
  });

  describe('prompt.get', () => {
    it('lists all prompts when ids is not provided (list mode)', async () => {
      const deps = createDeps();
      await expect(getTool('prompt.get', deps).execute({ offset: 1, limit: 1 })).resolves.toEqual({
        success: true,
        data: {
          total: 2,
          offset: 1,
          limit: 1,
          prompts: [{ code: 'shot.user', name: 'Shot', type: 'user', hasCustom: true }],
        },
      });
    });

    it('returns paginated list with defaults when no args given', async () => {
      const deps = createDeps();
      await expect(getTool('prompt.get', deps).execute({})).resolves.toEqual({
        success: true,
        data: {
          total: 2,
          offset: 0,
          limit: 50,
          prompts: [
            { code: 'scene.system', name: 'Scene', type: 'system', hasCustom: false },
            { code: 'shot.user', name: 'Shot', type: 'user', hasCustom: true },
          ],
        },
      });
    });

    it('fetches a single prompt by string id (fetch mode)', async () => {
      const deps = createDeps();
      await expect(getTool('prompt.get', deps).execute({ ids: 'scene.system' })).resolves.toEqual({
        success: true,
        data: {
          code: 'scene.system',
          name: 'Scene',
          defaultValue: 'default',
          customValue: null,
        },
      });
    });

    it('returns error for missing prompt in fetch mode', async () => {
      const deps = createDeps();
      await expect(getTool('prompt.get', deps).execute({ ids: 'missing' })).resolves.toEqual({
        success: false,
        error: 'Prompt not found: missing',
      });
    });
  });

  describe('prompt.get batch support', () => {
    const scenePrompt = {
      code: 'scene.system',
      name: 'Scene',
      defaultValue: 'default',
      customValue: null,
    };
    const shotPrompt = {
      code: 'shot.user',
      name: 'Shot',
      defaultValue: 'shot default',
      customValue: 'custom shot',
    };

    function createBatchDeps(): PromptToolDeps {
      const store = new Map([
        ['scene.system', scenePrompt],
        ['shot.user', shotPrompt],
      ]);
      return {
        listPrompts: vi.fn(async () => [
          { code: 'scene.system', name: 'Scene', type: 'system', hasCustom: false },
          { code: 'shot.user', name: 'Shot', type: 'user', hasCustom: true },
        ]),
        getPrompt: vi.fn(async (code: string) => store.get(code) ?? null),
        setCustomPrompt: vi.fn(async () => undefined),
        clearCustomPrompt: vi.fn(async () => undefined),
      };
    }

    it('single string ID returns single prompt (backward compat)', async () => {
      const deps = createBatchDeps();
      const result = await getTool('prompt.get', deps).execute({ ids: 'scene.system' });
      expect(result).toEqual({ success: true, data: scenePrompt });
    });

    it('array of IDs returns array of prompts', async () => {
      const deps = createBatchDeps();
      const result = await getTool('prompt.get', deps).execute({
        ids: ['scene.system', 'shot.user'],
      });
      expect(result.success).toBe(true);
      const data = result.data as (typeof scenePrompt)[];
      expect(data).toHaveLength(2);
      expect(data.map((p) => p.code)).toEqual(['scene.system', 'shot.user']);
    });

    it('missing ID in batch returns error for first missing', async () => {
      const deps = createBatchDeps();
      const result = await getTool('prompt.get', deps).execute({
        ids: ['scene.system', 'missing.code'],
      });
      expect(result).toEqual({ success: false, error: 'Prompt not found: missing.code' });
    });
  });

  describe('prompt.setCustom', () => {
    it('sets custom value when value is provided', async () => {
      const deps = createDeps();
      await expect(
        getTool('prompt.setCustom', deps).execute({
          code: 'scene.system',
          value: ' custom ',
        }),
      ).resolves.toEqual({
        success: true,
        data: { code: 'scene.system' },
      });
      expect(deps.setCustomPrompt).toHaveBeenCalledWith('scene.system', 'custom');
    });

    it('clears custom override when value is not provided', async () => {
      const deps = createDeps();
      await expect(
        getTool('prompt.setCustom', deps).execute({ code: 'scene.system' }),
      ).resolves.toEqual({
        success: true,
        data: { code: 'scene.system' },
      });
      expect(deps.clearCustomPrompt).toHaveBeenCalledWith('scene.system');
    });

    it('clears custom override when value is null', async () => {
      const deps = createDeps();
      await expect(
        getTool('prompt.setCustom', deps).execute({ code: 'scene.system', value: null }),
      ).resolves.toEqual({
        success: true,
        data: { code: 'scene.system' },
      });
      expect(deps.clearCustomPrompt).toHaveBeenCalledWith('scene.system');
    });

    it('returns error when value is empty string', async () => {
      const deps = createDeps();
      await expect(
        getTool('prompt.setCustom', deps).execute({ code: 'scene.system', value: '' }),
      ).resolves.toEqual({
        success: false,
        error: 'value is required',
        errorClass: 'validation',
      });
    });

    it('returns error when clearCustomPrompt fails', async () => {
      const deps = createDeps();
      vi.mocked(deps.clearCustomPrompt).mockRejectedValueOnce(new Error('clear failed'));
      await expect(
        getTool('prompt.setCustom', deps).execute({ code: 'scene.system' }),
      ).resolves.toEqual({
        success: false,
        error: 'clear failed',
      });
    });
  });
});
