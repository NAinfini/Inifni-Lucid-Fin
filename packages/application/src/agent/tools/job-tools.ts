import type { AgentTool } from '../tool-registry.js';

export interface JobToolDeps {
  listJobs: () => Promise<Array<{ id: string; status: string; nodeId?: string }>>;
  cancelJob: (jobId: string) => Promise<void>;
  pauseJob: (jobId: string) => Promise<void>;
  resumeJob: (jobId: string) => Promise<void>;
}

type ToolResult = { success: true; data?: unknown } | { success: false; error: string };

function ok(data?: unknown): ToolResult {
  return data === undefined ? { success: true } : { success: true, data };
}

function fail(error: unknown): ToolResult {
  return { success: false, error: error instanceof Error ? error.message : String(error) };
}

function requireString(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${key} is required`);
  }
  return value.trim();
}

export function createJobTools(deps: JobToolDeps): AgentTool[] {
  const context = ['canvas'];

  const cancel: AgentTool = {
    name: 'job.cancel',
    description: 'Cancel a queued or running job by ID.',
    context,
    tier: 4,
    parameters: {
      type: 'object',
      properties: {
        jobId: { type: 'string', description: 'The job ID to cancel.' },
      },
      required: ['jobId'],
    },
    async execute(args) {
      try {
        const jobId = requireString(args, 'jobId');
        await deps.cancelJob(jobId);
        return ok({ jobId });
      } catch (error) {
        return fail(error);
      }
    },
  };

  const pause: AgentTool = {
    name: 'job.pause',
    description: 'Pause a running job by ID.',
    context,
    tier: 4,
    parameters: {
      type: 'object',
      properties: {
        jobId: { type: 'string', description: 'The job ID to pause.' },
      },
      required: ['jobId'],
    },
    async execute(args) {
      try {
        const jobId = requireString(args, 'jobId');
        await deps.pauseJob(jobId);
        return ok({ jobId });
      } catch (error) {
        return fail(error);
      }
    },
  };

  const resume: AgentTool = {
    name: 'job.resume',
    description: 'Resume a paused job by ID.',
    context,
    tier: 4,
    parameters: {
      type: 'object',
      properties: {
        jobId: { type: 'string', description: 'The job ID to resume.' },
      },
      required: ['jobId'],
    },
    async execute(args) {
      try {
        const jobId = requireString(args, 'jobId');
        await deps.resumeJob(jobId);
        return ok({ jobId });
      } catch (error) {
        return fail(error);
      }
    },
  };

  return [cancel, pause, resume];
}
