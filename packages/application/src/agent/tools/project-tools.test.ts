import { describe, expect, it, vi } from 'vitest';
import type { Snapshot } from '@lucid-fin/contracts';
import { createProjectTools, type ProjectToolDeps } from './project-tools.js';

const snapshot: Snapshot = {
  id: 'snapshot-1',
  projectId: 'project-1',
  name: 'Initial',
  version: 1,
  createdAt: 1,
};

function createDeps(): ProjectToolDeps {
  return {
    listProjects: vi.fn(async () => [
      { id: 'project-1', title: 'One', path: 'C:/one', updatedAt: 1 },
      { id: 'project-2', title: 'Two', path: 'C:/two', updatedAt: 2 },
    ]),
    createSnapshot: vi.fn(async () => snapshot),
    listSnapshots: vi.fn(async () => [snapshot]),
    restoreSnapshot: vi.fn(async () => undefined),
  };
}

function getTool(name: string, deps: ProjectToolDeps) {
  const tool = createProjectTools(deps).find((entry) => entry.name === name);
  if (!tool) throw new Error(`Missing tool: ${name}`);
  return tool;
}

describe('createProjectTools', () => {
  it('defines project listing and snapshot tools', () => {
    const deps = createDeps();
    const tools = createProjectTools(deps);

    expect(tools.map((tool) => tool.name)).toEqual([
      'project.list',
      'project.snapshot',
    ]);
    expect(tools.every((tool) => tool.tier === 4)).toBe(true);
  });

  it('lists projects and snapshots with pagination and delegates snapshot actions', async () => {
    const deps = createDeps();

    await expect(getTool('project.list', deps).execute({ offset: 1, limit: 1 })).resolves.toEqual({
      success: true,
      data: {
        total: 2,
        offset: 1,
        limit: 1,
        projects: [{ id: 'project-2', title: 'Two', path: 'C:/two', updatedAt: 2 }],
      },
    });
    await expect(getTool('project.snapshot', deps).execute({ action: 'create', name: '  Initial  ' })).resolves.toEqual({
      success: true,
      data: snapshot,
    });
    expect(deps.createSnapshot).toHaveBeenCalledWith('Initial');

    await expect(getTool('project.snapshot', deps).execute({ action: 'list' })).resolves.toEqual({
      success: true,
      data: { total: 1, offset: 0, limit: 50, snapshots: [snapshot] },
    });
    await expect(getTool('project.snapshot', deps).execute({ action: 'restore', snapshotId: 'snapshot-1' })).resolves.toEqual({
      success: true,
      data: { snapshotId: 'snapshot-1' },
    });
  });

  it('validates required strings and wraps dependency failures', async () => {
    const deps = createDeps();
    vi.mocked(deps.restoreSnapshot).mockRejectedValueOnce(new Error('restore failed'));

    await expect(getTool('project.snapshot', deps).execute({ action: 'create', name: '   ' })).resolves.toEqual({
      success: false,
      error: 'name is required',
    });
    await expect(getTool('project.snapshot', deps).execute({ action: 'restore', snapshotId: 'snapshot-1' })).resolves.toEqual({
      success: false,
      error: 'restore failed',
    });
  });
});
