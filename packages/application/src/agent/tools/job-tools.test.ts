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

    expect(tools.map((tool) => tool.name)).toEqual(['job.cancel', 'job.pause', 'job.resume']);
    expect(tools.every((tool) => tool.context?.includes('canvas'))).toBe(true);
  });

  it('delegates cancel, pause, and resume operations', async () => {
    const deps = createDeps();

    await expect(getTool('job.cancel', deps).execute({ jobId: 'job-1' })).resolves.toEqual({
      success: true,
      data: { jobId: 'job-1' },
    });
    await expect(getTool('job.pause', deps).execute({ jobId: 'job-2' })).resolves.toEqual({
      success: true,
      data: { jobId: 'job-2' },
    });
    await expect(getTool('job.resume', deps).execute({ jobId: 'job-3' })).resolves.toEqual({
      success: true,
      data: { jobId: 'job-3' },
    });
  });

  it('validates job IDs and wraps dependency failures', async () => {
    const deps = createDeps();
    vi.mocked(deps.pauseJob).mockRejectedValueOnce(new Error('job missing'));

    await expect(getTool('job.cancel', deps).execute({ jobId: '' })).resolves.toEqual({
      success: false,
      error: 'jobId is required',
    });
    await expect(getTool('job.pause', deps).execute({ jobId: 'job-9' })).resolves.toEqual({
      success: false,
      error: 'job missing',
    });
  });
});
