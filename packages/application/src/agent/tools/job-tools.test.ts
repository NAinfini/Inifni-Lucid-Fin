import { describe, expect, it, vi } from 'vitest';
import { createJobTools, type JobToolDeps } from './job-tools.js';

function createDeps(): JobToolDeps {
  return {
    listJobs: vi.fn(async () => []),
    cancelJob: vi.fn(async () => undefined),
    pauseJob: vi.fn(async () => undefined),
    resumeJob: vi.fn(async () => undefined),
  };
}

function getTool(name: string, deps: JobToolDeps) {
  const tool = createJobTools(deps).find((entry) => entry.name === name);
  if (!tool) throw new Error(`Missing tool: ${name}`);
  return tool;
}

describe('createJobTools', () => {
  it('defines canvas-context lifecycle tools', () => {
    const deps = createDeps();
    const tools = createJobTools(deps);

    expect(tools.map((tool) => tool.name)).toEqual(['job.list', 'job.control']);
    expect(tools.every((tool) => tool.context?.includes('canvas'))).toBe(true);
  });

  it('job.list returns all jobs', async () => {
    const deps = createDeps();
    vi.mocked(deps.listJobs).mockResolvedValueOnce([
      { id: 'job-1', status: 'running', nodeId: 'node-1' },
      { id: 'job-2', status: 'queued' },
    ]);

    await expect(getTool('job.list', deps).execute({})).resolves.toEqual({
      success: true,
      data: {
        total: 2,
        offset: 0,
        limit: 50,
        jobs: [
          { id: 'job-1', status: 'running', nodeId: 'node-1' },
          { id: 'job-2', status: 'queued' },
        ],
      },
    });
  });

  it('delegates cancel, pause, and resume operations via job.control', async () => {
    const deps = createDeps();

    await expect(getTool('job.control', deps).execute({ jobId: 'job-1', action: 'cancel' })).resolves.toEqual({
      success: true,
      data: { jobId: 'job-1', action: 'cancel' },
    });
    await expect(getTool('job.control', deps).execute({ jobId: 'job-2', action: 'pause' })).resolves.toEqual({
      success: true,
      data: { jobId: 'job-2', action: 'pause' },
    });
    await expect(getTool('job.control', deps).execute({ jobId: 'job-3', action: 'resume' })).resolves.toEqual({
      success: true,
      data: { jobId: 'job-3', action: 'resume' },
    });

    expect(vi.mocked(deps.cancelJob)).toHaveBeenCalledWith('job-1');
    expect(vi.mocked(deps.pauseJob)).toHaveBeenCalledWith('job-2');
    expect(vi.mocked(deps.resumeJob)).toHaveBeenCalledWith('job-3');
  });

  it('validates job IDs and wraps dependency failures', async () => {
    const deps = createDeps();
    vi.mocked(deps.pauseJob).mockRejectedValueOnce(new Error('job missing'));

    await expect(getTool('job.control', deps).execute({ jobId: '', action: 'cancel' })).resolves.toEqual({
      success: false,
      error: 'jobId is required',
    });
    await expect(getTool('job.control', deps).execute({ jobId: 'job-9', action: 'pause' })).resolves.toEqual({
      success: false,
      error: 'job missing',
    });
  });

  it('rejects unknown actions', async () => {
    const deps = createDeps();

    await expect(getTool('job.control', deps).execute({ jobId: 'job-1', action: 'explode' })).resolves.toEqual({
      success: false,
      error: 'Unknown action: explode. Must be cancel, pause, or resume.',
    });
  });
});
