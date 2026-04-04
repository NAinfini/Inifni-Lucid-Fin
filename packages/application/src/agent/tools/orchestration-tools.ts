import type { AgentTool, ToolResult } from '../tool-registry.js';

export interface OrchestrationListEntry {
  id: string;
  sceneId: string;
  sceneTitle: string;
  motion?: string;
  camera?: string;
  mood?: string;
  duration?: number;
}

export interface OrchestrationToolDeps {
  listOrchestrations: () => Promise<OrchestrationListEntry[]>;
  deleteOrchestration: (id: string) => Promise<void>;
}

function ok(data?: unknown): ToolResult {
  return data === undefined ? { success: true } : { success: true, data };
}

function fail(error: unknown): ToolResult {
  return {
    success: false,
    error: error instanceof Error ? error.message : String(error),
  };
}

function requireString(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${key} is required`);
  }
  return value.trim();
}

export function createOrchestrationTools(deps: OrchestrationToolDeps): AgentTool[] {
  const list: AgentTool = {
    name: 'orchestration.list',
    description: 'List orchestration segments across the current project.',
    tier: 1,
    parameters: { type: 'object', properties: {}, required: [] },
    async execute() {
      try {
        return ok(await deps.listOrchestrations());
      } catch (error) {
        return fail(error);
      }
    },
  };

  const remove: AgentTool = {
    name: 'orchestration.delete',
    description: 'Delete an orchestration segment by ID.',
    tier: 3,
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'The orchestration segment ID to delete.' },
      },
      required: ['id'],
    },
    async execute(args) {
      try {
        const id = requireString(args, 'id');
        await deps.deleteOrchestration(id);
        return ok({ id });
      } catch (error) {
        return fail(error);
      }
    },
  };

  return [list, remove];
}
