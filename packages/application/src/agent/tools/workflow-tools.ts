import type { AgentTool } from '../tool-registry.js';

export interface WorkflowToolDeps {
  pauseWorkflow: (id: string) => Promise<void>;
  resumeWorkflow: (id: string) => Promise<void>;
  cancelWorkflow: (id: string) => Promise<void>;
  retryWorkflow: (id: string) => Promise<void>;
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

export function createWorkflowTools(deps: WorkflowToolDeps): AgentTool[] {
  const context = ['canvas'];

  const pause: AgentTool = {
    name: 'workflow.pause',
    description: 'Pause a workflow run by ID.',
    context,
    tier: 4,
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Workflow run ID.' },
      },
      required: ['id'],
    },
    async execute(args) {
      try {
        const id = requireString(args, 'id');
        await deps.pauseWorkflow(id);
        return ok({ id });
      } catch (error) {
        return fail(error);
      }
    },
  };

  const resume: AgentTool = {
    name: 'workflow.resume',
    description: 'Resume a paused workflow run by ID.',
    context,
    tier: 4,
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Workflow run ID.' },
      },
      required: ['id'],
    },
    async execute(args) {
      try {
        const id = requireString(args, 'id');
        await deps.resumeWorkflow(id);
        return ok({ id });
      } catch (error) {
        return fail(error);
      }
    },
  };

  const cancel: AgentTool = {
    name: 'workflow.cancel',
    description: 'Cancel a workflow run by ID.',
    context,
    tier: 4,
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Workflow run ID.' },
      },
      required: ['id'],
    },
    async execute(args) {
      try {
        const id = requireString(args, 'id');
        await deps.cancelWorkflow(id);
        return ok({ id });
      } catch (error) {
        return fail(error);
      }
    },
  };

  const retry: AgentTool = {
    name: 'workflow.retry',
    description: 'Retry a workflow run by ID.',
    context,
    tier: 4,
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Workflow run ID.' },
      },
      required: ['id'],
    },
    async execute(args) {
      try {
        const id = requireString(args, 'id');
        await deps.retryWorkflow(id);
        return ok({ id });
      } catch (error) {
        return fail(error);
      }
    },
  };

  return [pause, resume, cancel, retry];
}
