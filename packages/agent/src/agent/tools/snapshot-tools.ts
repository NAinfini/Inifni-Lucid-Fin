import { NO_TOOL_RESOURCE, toolResultSchema, type ToolDefinition } from '../tool-registry.js';
import { defineToolModule } from '../tool-module.js';
import { ok, fail, requireString } from './tool-result-helpers.js';
import { authorityFact, contextProjector, records, resultRecord } from './context-replay.js';
import {
  arraySchema,
  booleanSchema,
  numberSchema,
  objectSchema,
  stringSchema,
} from './tool-runtime-schemas.js';

const snapshotSummarySchema = objectSchema({
  id: stringSchema,
  label: stringSchema,
  trigger: stringSchema,
  createdAt: numberSchema,
});

export interface SnapshotToolDeps {
  captureSnapshot: (
    sessionId: string,
    label: string,
    trigger: 'auto' | 'manual',
  ) => { id: string; sessionId: string; label: string; trigger: string; createdAt: number };
  listSnapshots: (
    sessionId: string,
  ) => Array<{ id: string; sessionId: string; label: string; trigger: string; createdAt: number }>;
  restoreSnapshot: (snapshotId: string) => void;
  getSessionId: () => string;
}

export function createSnapshotTools(deps: SnapshotToolDeps): ToolDefinition[] {
  const create: ToolDefinition = {
    name: 'snapshot.create',
    process: 'snapshot-and-rollback',
    category: 'mutation',
    contextReplay: 'authority_reread',
    resource: NO_TOOL_RESOURCE,
    description:
      'Create a rollback snapshot of the current project state. Use before destructive or batch operations (deletes, bulk rewrites, bulk canvas edits, task-list cancellation, preset resets, major imports).',
    tier: 2,
    outputSchema: toolResultSchema(
      objectSchema({ id: stringSchema, label: stringSchema, createdAt: numberSchema }),
    ),
    projectPublicResult: contextProjector((result) => [
      authorityFact('snapshot', 'created', resultRecord(result)?.id),
    ]),
    inputSchema: {
      type: 'object',
      properties: {
        label: {
          type: 'string',
          description: 'Short label describing the purpose of this snapshot.',
        },
      },
      required: ['label'],
    },
    async execute(args) {
      try {
        const label = requireString(args, 'label');
        const sessionId = deps.getSessionId();
        const snap = deps.captureSnapshot(sessionId, label, 'manual');
        return ok({ id: snap.id, label: snap.label, createdAt: snap.createdAt });
      } catch (error) {
        return fail(error);
      }
    },
  };

  const list: ToolDefinition = {
    name: 'snapshot.list',
    process: 'snapshot-and-rollback',
    category: 'query',
    contextReplay: 'authority_reread',
    resource: NO_TOOL_RESOURCE,
    description: 'List available snapshots for the current session. Returns newest first.',
    tier: 1,
    outputSchema: toolResultSchema(
      objectSchema({ total: numberSchema, snapshots: arraySchema(snapshotSummarySchema) }),
    ),
    projectPublicResult: contextProjector((result) =>
      records(resultRecord(result)?.snapshots).map((snapshot) =>
        authorityFact('snapshot', 'read', snapshot.id),
      ),
    ),
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Max items to return. Default 20.' },
      },
    },
    async execute(args) {
      try {
        const sessionId = deps.getSessionId();
        const all = deps.listSnapshots(sessionId);
        const limit =
          typeof args.limit === 'number' && args.limit > 0 ? Math.floor(args.limit) : 20;
        const snapshots = all.slice(0, limit).map(({ id, label, trigger, createdAt }) => ({
          id,
          label,
          trigger,
          createdAt,
        }));
        return ok({ total: all.length, snapshots });
      } catch (error) {
        return fail(error);
      }
    },
  };

  const restore: ToolDefinition = {
    name: 'snapshot.restore',
    process: 'snapshot-and-rollback',
    category: 'mutation',
    contextReplay: 'authority_reread',
    resource: NO_TOOL_RESOURCE,
    uiEffects: [{ kind: 'canvas.refresh' }] as const,
    description:
      'Restore project state from a snapshot. This replaces all entity data with the snapshot contents. Only use after explicit user confirmation.',
    tier: 3,
    outputSchema: toolResultSchema(
      objectSchema({ snapshotId: stringSchema, restored: booleanSchema }),
    ),
    projectPublicResult: contextProjector((_result, args) => [
      authorityFact('snapshot', 'updated', args.snapshotId),
    ]),
    inputSchema: {
      type: 'object',
      properties: {
        snapshotId: { type: 'string', description: 'The snapshot ID to restore.' },
      },
      required: ['snapshotId'],
    },
    async execute(args) {
      try {
        const snapshotId = requireString(args, 'snapshotId');
        deps.restoreSnapshot(snapshotId);
        return ok({ snapshotId, restored: true });
      } catch (error) {
        return fail(error);
      }
    },
  };

  return [create, list, restore];
}

export const snapshotToolModule = defineToolModule({
  name: 'snapshot',
  createTools: createSnapshotTools,
});
