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
    parameters: { type: 'object', properties: {}, required: [] },
    async execute() {
      try {
        return ok(await deps.listProjects());
      } catch (error) {
        return fail(error);
      }
    },
  };

  const snapshot: AgentTool = {
    name: 'project.snapshot',
    description: 'Create a snapshot of the current project state.',
    tier: 4,
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'The snapshot name.' },
      },
      required: ['name'],
    },
    async execute(args) {
      try {
        return ok(await deps.createSnapshot(requireString(args, 'name')));
      } catch (error) {
        return fail(error);
      }
    },
  };

  const snapshotList: AgentTool = {
    name: 'project.snapshotList',
    description: 'List snapshots for the current project.',
    tier: 4,
    parameters: { type: 'object', properties: {}, required: [] },
    async execute() {
      try {
        return ok(await deps.listSnapshots());
      } catch (error) {
        return fail(error);
      }
    },
  };

  const snapshotRestore: AgentTool = {
    name: 'project.snapshotRestore',
    description: 'Restore the current project to a snapshot by ID.',
    tier: 4,
    parameters: {
      type: 'object',
      properties: {
        snapshotId: { type: 'string', description: 'The snapshot ID to restore.' },
      },
      required: ['snapshotId'],
    },
    async execute(args) {
      try {
        const snapshotId = requireString(args, 'snapshotId');
        await deps.restoreSnapshot(snapshotId);
        return ok({ snapshotId });
      } catch (error) {
        return fail(error);
      }
    },
  };

  return [list, snapshot, snapshotList, snapshotRestore];
}
