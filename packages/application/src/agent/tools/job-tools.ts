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

  const list: AgentTool = {
    name: 'job.list',
    description: 'List generation jobs and their statuses. Supports optional status filtering and offset/limit pagination.',
    context,
    tier: 1,
    parameters: {
      type: 'object',
      properties: {
        status: { type: 'string', description: 'Optional: filter jobs by status (e.g. "pending", "running", "done", "failed").' },
        offset: { type: 'number', description: 'Start index (0-based). Default 0.' },
        limit: { type: 'number', description: 'Max items to return. Default 50.' },
      },
    },
    async execute(args) {
      try {
        const allJobs = await deps.listJobs();
        const status = typeof args.status === 'string' && args.status.trim().length > 0 ? args.status.trim() : undefined;
        const filtered = status ? allJobs.filter((j) => j.status === status) : allJobs;
        const offset = typeof args.offset === 'number' && args.offset >= 0 ? Math.floor(args.offset) : 0;
        const limit = typeof args.limit === 'number' && args.limit > 0 ? Math.floor(args.limit) : 50;
        const jobs = filtered.slice(offset, offset + limit);
        return ok({ total: filtered.length, offset, limit, jobs });
      } catch (error) {
        return fail(error);
      }
    },
  };

  const control: AgentTool = {
    name: 'job.control',
    description: 'Control a generation job: cancel, pause, or resume it by ID.',
    context,
    tier: 4,
    parameters: {
      type: 'object',
      properties: {
        jobId: { type: 'string', description: 'The job ID.' },
        action: { type: 'string', description: 'Action to perform.', enum: ['cancel', 'pause', 'resume'] },
      },
      required: ['jobId', 'action'],
    },
    async execute(args) {
      try {
        const jobId = requireString(args, 'jobId');
        const action = requireString(args, 'action');
        if (action === 'cancel') {
          await deps.cancelJob(jobId);
        } else if (action === 'pause') {
          await deps.pauseJob(jobId);
        } else if (action === 'resume') {
          await deps.resumeJob(jobId);
        } else {
          throw new Error(`Unknown action: ${action}. Must be cancel, pause, or resume.`);
        }
        return ok({ jobId, action });
      } catch (error) {
        return fail(error);
      }
    },
  };

  return [list, control];
}
