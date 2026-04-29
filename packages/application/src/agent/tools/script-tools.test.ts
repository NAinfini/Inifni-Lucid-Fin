import { describe, expect, it, vi } from 'vitest';
import type { ParsedScene, ScriptDocument } from '@lucid-fin/contracts';
import { createScriptTools, type ScriptToolDeps } from './script-tools.js';

const parsedScenes: ParsedScene[] = [
  { id: 'scene-1', heading: 'INT. ROOM - DAY', content: 'Action', order: 0 },
];

const script: ScriptDocument = {
  id: 'script-1',
  content: 'INT. ROOM - DAY',
  format: 'fountain',
  parsedScenes,
  createdAt: 1,
  updatedAt: 1,
};

function createDeps(): ScriptToolDeps {
  return {
    loadScript: vi.fn(async (path?: string) => (path ? script : script)),
    saveScript: vi.fn(async () => undefined),
    parseScript: vi.fn(() => parsedScenes),
    importScript: vi.fn(async (content: string, format?: string) => ({
      content,
      parsedScenes,
      format,
    })),
  };
}

function getTool(name: string, deps: ScriptToolDeps) {
  const tool = createScriptTools(deps).find((entry) => entry.name === name);
  if (!tool) throw new Error(`Missing tool: ${name}`);
  return tool;
}

describe('createScriptTools', () => {
  it('defines script tools with expected contexts', () => {
    const deps = createDeps();
    const tools = createScriptTools(deps);

    expect(tools.map((tool) => tool.name)).toEqual([
      'script.read',
      'script.write',
      'script.import',
    ]);
    expect(getTool('script.read', deps).context).toEqual([
      'script-editor',
      'storyboard',
      'orchestrator',
    ]);
  });

  it('reads existing or empty script content', async () => {
    const deps = createDeps();

    await expect(getTool('script.read', deps).execute({})).resolves.toEqual({
      success: true,
      data: { content: script.content, parsedScenes },
    });

    vi.mocked(deps.loadScript).mockResolvedValueOnce(null);
    await expect(getTool('script.read', deps).execute({})).resolves.toEqual({
      success: true,
      data: { content: '', parsedScenes: [] },
    });
  });

  it('writes scripts via dependency', async () => {
    const deps = createDeps();

    await expect(
      getTool('script.write', deps).execute({ content: 'INT. HALL - NIGHT' }),
    ).resolves.toEqual({
      success: true,
      data: { parsedScenes },
    });
    expect(deps.saveScript).toHaveBeenCalledWith('INT. HALL - NIGHT');
    expect(deps.parseScript).toHaveBeenCalledWith('INT. HALL - NIGHT');
  });

  it('imports script from path (load mode)', async () => {
    const deps = createDeps();

    await expect(
      getTool('script.import', deps).execute({ path: ' C:/tmp/script.fountain ' }),
    ).resolves.toEqual({
      success: true,
      data: { path: 'C:/tmp/script.fountain' },
    });
    expect(deps.loadScript).toHaveBeenCalledWith('C:/tmp/script.fountain');
  });

  it('imports script from raw content (content mode)', async () => {
    const deps = createDeps();

    await expect(
      getTool('script.import', deps).execute({
        content: 'INT. ROOM - DAY',
        format: 'fountain',
      }),
    ).resolves.toEqual({
      success: true,
      data: { content: 'INT. ROOM - DAY', parsedScenes, format: 'fountain' },
    });
    expect(deps.importScript).toHaveBeenCalledWith('INT. ROOM - DAY', 'fountain');
  });

  it('validates required inputs and wraps dependency failures', async () => {
    const deps = createDeps();
    vi.mocked(deps.importScript).mockRejectedValueOnce(new Error('import failed'));

    await expect(getTool('script.import', deps).execute({})).resolves.toEqual({
      success: false,
      error: 'Either path or content must be provided',
    });
    await expect(getTool('script.import', deps).execute({ path: '   ' })).resolves.toEqual({
      success: false,
      error: 'path is required',
      errorClass: 'validation',
    });
    await expect(getTool('script.import', deps).execute({ content: '   ' })).resolves.toEqual({
      success: false,
      error: 'Either path or content must be provided',
    });
    await expect(
      getTool('script.import', deps).execute({
        content: 'INT. ROOM - DAY',
        format: 'plaintext',
      }),
    ).resolves.toEqual({
      success: false,
      error: 'import failed',
    });
  });
});
