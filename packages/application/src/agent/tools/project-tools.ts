import type { Snapshot } from '@lucid-fin/contracts';
import type { AgentTool, ToolResult } from '../tool-registry.js';

export interface ProjectToolDeps {
  listProjects: () => Promise<Array<{
    id: string;
    title: string;
    path: string;
    updatedAt: number;
    thumbnail?: string;
  }>>;
  createSnapshot: (name: string) => Promise<{ id: string } | Snapshot>;
  listSnapshots: () => Promise<Snapshot[]>;
  restoreSnapshot: (snapshotId: string) => Promise<void>;
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

export function createProjectTools(deps: ProjectToolDeps): AgentTool[] {
  const list: AgentTool = {
    name: 'project.list',
    description: 'List recent projects available to open.',
    tier: 4,
    parameters: {
      type: 'object',
      properties: {
        offset: { type: 'number', description: 'Start index (0-based). Default 0.' },
        limit: { type: 'number', description: 'Max items to return. Default 50.' },
      },
      required: [],
    },
    async execute(args) {
      try {
        const projects = await deps.listProjects();
        const offset = typeof args.offset === 'number' && args.offset >= 0 ? Math.floor(args.offset) : 0;
        const limit = typeof args.limit === 'number' && args.limit > 0 ? Math.floor(args.limit) : 50;
        return ok({ total: projects.length, offset, limit, projects: projects.slice(offset, offset + limit) });
      } catch (error) {
        return fail(error);
      }
    },
  };

  const snapshot: AgentTool = {
    name: 'project.snapshot',
    description: 'Manage project snapshots: create a new snapshot, list existing snapshots, or restore to a snapshot.',
    tier: 4,
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['create', 'list', 'restore'], description: 'The snapshot action to perform.' },
        name: { type: 'string', description: 'The snapshot name. Required for action=create.' },
        snapshotId: { type: 'string', description: 'The snapshot ID to restore. Required for action=restore.' },
        offset: { type: 'number', description: 'Start index (0-based). Default 0. Used for action=list.' },
        limit: { type: 'number', description: 'Max items to return. Default 50. Used for action=list.' },
      },
      required: ['action'],
    },
    async execute(args) {
      try {
        const action = requireString(args, 'action');
        if (action === 'create') {
          return ok(await deps.createSnapshot(requireString(args, 'name')));
        }
        if (action === 'list') {
          const snapshots = await deps.listSnapshots();
          const offset = typeof args.offset === 'number' && args.offset >= 0 ? Math.floor(args.offset) : 0;
          const limit = typeof args.limit === 'number' && args.limit > 0 ? Math.floor(args.limit) : 50;
          return ok({ total: snapshots.length, offset, limit, snapshots: snapshots.slice(offset, offset + limit) });
        }
        if (action === 'restore') {
          const snapshotId = requireString(args, 'snapshotId');
          await deps.restoreSnapshot(snapshotId);
          return ok({ snapshotId });
        }
        return fail(new Error(`Unknown action: ${action}`));
      } catch (error) {
        return fail(error);
      }
    },
  };

  return [list, snapshot];
}
