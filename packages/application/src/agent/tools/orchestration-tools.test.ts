import { describe, expect, it, vi } from 'vitest';
import { createOrchestrationTools, type OrchestrationToolDeps } from './orchestration-tools.js';

function createDeps(): OrchestrationToolDeps {
  return {
    listOrchestrations: vi.fn(async () => [
      { id: 'orch-1', sceneId: 'scene-1', sceneTitle: 'Opening', duration: 4 },
      { id: 'orch-2', sceneId: 'scene-2', sceneTitle: 'Middle', duration: 5 },
    ]),
    deleteOrchestration: vi.fn(async () => undefined),
  };
}

function getTool(name: string, deps: OrchestrationToolDeps) {
  const tool = createOrchestrationTools(deps).find((entry) => entry.name === name);
  if (!tool) throw new Error(`Missing tool: ${name}`);
  return tool;
}

describe('createOrchestrationTools', () => {
  it('defines list and delete orchestration tools', () => {
    const deps = createDeps();
    const tools = createOrchestrationTools(deps);

    expect(tools.map((tool) => tool.name)).toEqual(['orchestration.list', 'orchestration.delete']);
    expect(getTool('orchestration.delete', deps).parameters.required).toEqual(['id']);
  });

  it('lists orchestration segments with pagination', async () => {
    const deps = createDeps();

    await expect(getTool('orchestration.list', deps).execute({ offset: 1, limit: 1 })).resolves.toEqual({
      success: true,
      data: {
        total: 2,
        offset: 1,
        limit: 1,
        orchestrations: [{ id: 'orch-2', sceneId: 'scene-2', sceneTitle: 'Middle', duration: 5 }],
      },
    });
  });

  it('deletes an orchestration segment and handles errors', async () => {
    const deps = createDeps();

    await expect(getTool('orchestration.delete', deps).execute({ id: 'orch-1' })).resolves.toEqual({
      success: true,
      data: { id: 'orch-1' },
    });
    expect(deps.deleteOrchestration).toHaveBeenCalledWith('orch-1');

    vi.mocked(deps.deleteOrchestration).mockRejectedValueOnce(new Error('delete failed'));
    await expect(getTool('orchestration.delete', deps).execute({ id: '  ' })).resolves.toEqual({
      success: false,
      error: 'id is required',
    });
    await expect(getTool('orchestration.delete', deps).execute({ id: 'orch-2' })).resolves.toEqual({
      success: false,
      error: 'delete failed',
    });
  });
});
