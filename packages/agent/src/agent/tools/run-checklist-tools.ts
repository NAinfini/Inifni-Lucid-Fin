/**
 * `runChecklist.manage` — unified agent-facing tool for one transient Commander run
 * run-local run checklist (`RunChecklistStore`). It carries the schemas the LLM sees;
 * the orchestrator factory binds the canonical definition to the per-run store
 * before constructing the orchestrator. ToolExecutor then owns the only
 * execution path.
 */

import { NO_TOOL_RESOURCE, toolResultSchema, type ToolDefinition } from '../tool-registry.js';
import type { PublicChecklistArtifact } from '@lucid-fin/contracts';
import { authorityFact, contextProjector, record, resultRecord } from './context-replay.js';
import type { RunChecklistStore } from './run-checklist-store.js';
import { arraySchema, enumSchema, objectSchema, stringSchema } from './tool-runtime-schemas.js';

const checklistStatusSchema = enumSchema(['pending', 'in_progress', 'done']);
const checklistItemSchema = objectSchema({
  id: stringSchema,
  label: stringSchema,
  status: checklistStatusSchema,
});
const checklistSnapshotSchema = objectSchema({
  checklistId: stringSchema,
  items: arraySchema(checklistItemSchema),
});
const checklistUpdateSchema = objectSchema({ id: stringSchema, status: checklistStatusSchema });
const runChecklistDataSchema = objectSchema(
  {
    runChecklist: checklistSnapshotSchema,
    items: arraySchema(checklistItemSchema),
    applied: arraySchema(checklistUpdateSchema),
  },
  ['runChecklist', 'items'],
);

async function executeRunChecklist(
  store: RunChecklistStore,
  args: Record<string, unknown>,
) {
  if (args.action === 'set') {
    const snapshot = store.set({
      items: (Array.isArray(args.items) ? args.items : []) as Array<{ label: string }>,
    });
    return {
      success: true as const,
      data: { runChecklist: snapshot, items: snapshot.items },
    };
  }
  const { snapshot, applied } = store.update({
    checklistId: typeof args.checklistId === 'string' ? args.checklistId : '',
    updates: (Array.isArray(args.updates) ? args.updates : []) as Array<{
      id: string;
      status: 'pending' | 'in_progress' | 'done';
    }>,
  });
  return {
    success: true as const,
    data: { runChecklist: snapshot, applied, items: snapshot.items },
  };
}

const runChecklistManage: ToolDefinition = {
  name: 'runChecklist.manage',
  process: 'meta',
  category: 'meta',
  contextReplay: 'authority_reread',
  resource: NO_TOOL_RESOURCE,
  description: [
    'Create, replace, or update the run-local checklist.',
    '',
    'Use `action: "set"` to create or replace the checklist. Pass 2-10 short human-readable `items`. The first item is auto-marked `in_progress`; the rest start `pending`. Calling `set` again replaces the prior list and issues a fresh `checklistId`.',
    '',
    'Use `action: "update"` to change item statuses. Multiple updates are applied atomically. At most one item may be `in_progress`; the `checklistId` must match the active checklist or the update is rejected.',
  ].join('\n'),
  tags: ['meta', 'planning'],
  tier: 1,
  outputSchema: toolResultSchema(runChecklistDataSchema),
  projectPublicResult: contextProjector((result, args) => {
    const checklist = record(resultRecord(result)?.runChecklist);
    return [
      authorityFact(
        'run_checklist',
        args.action === 'set' ? 'created' : 'updated',
        checklist?.checklistId ?? args.checklistId,
      ),
    ];
  }, (result) => {
    const data =
      result.success === true && result.data && typeof result.data === 'object'
        ? (result.data as Record<string, unknown>)
        : undefined;
    const checklist =
      data?.runChecklist && typeof data.runChecklist === 'object'
        ? (data.runChecklist as Record<string, unknown>)
        : undefined;
    if (typeof checklist?.checklistId !== 'string' || !Array.isArray(checklist.items)) return {};
    const items: PublicChecklistArtifact['items'] = checklist.items.flatMap((candidate) => {
      if (!candidate || typeof candidate !== 'object') return [];
      const item = candidate as Record<string, unknown>;
      if (
        typeof item.id !== 'string' ||
        typeof item.label !== 'string' ||
        (item.status !== 'pending' && item.status !== 'in_progress' && item.status !== 'done')
      ) {
        return [];
      }
      return [{ id: item.id, label: item.label, status: item.status }];
    });
    return {
      artifacts: [{ kind: 'checklist', id: checklist.checklistId, items }],
    };
  }),
  inputSchema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        description:
          '"set" creates or replaces the run checklist. "update" marks items as done/in_progress.',
        enum: ['set', 'update'],
      },
      items: {
        type: 'array',
        description:
          'Ordered list of 2-10 checklist items (for action "set"). Each item has a short human-facing label (<=120 chars). The user sees this list as a sticky card; write labels they can read at a glance.',
        items: {
          type: 'object',
          description: 'A single checklist item',
          properties: {
            label: {
              type: 'string',
              description:
                'Short human-facing label, e.g. "Sketch the 6 shot prompts" or "Apply style plate". No trailing punctuation.',
            },
          },
          required: ['label'],
        },
      },
      checklistId: {
        type: 'string',
        description:
          'The active run checklist id, as returned by the most recent "set" snapshot (for action "update"). A stale id means the list has been replaced — re-read the current snapshot first.',
      },
      updates: {
        type: 'array',
        description:
          'Non-empty list of { id, status } deltas (for action "update"). Only items referenced here change; others remain as-is.',
        items: {
          type: 'object',
          description: 'A single item status delta.',
          properties: {
            id: {
              type: 'string',
              description: 'The item id from the run checklist snapshot.',
            },
            status: {
              type: 'string',
              description: 'Target status for the item.',
              enum: ['pending', 'in_progress', 'done'],
            },
          },
          required: ['id', 'status'],
        },
      },
    },
    required: ['action'],
  },
  execute: async () => {
    throw new Error('runChecklist.manage must be bound to a run-local RunChecklistStore.');
  },
};

export function bindRunChecklistToolDefinition(
  definition: ToolDefinition,
  store: RunChecklistStore,
): ToolDefinition {
  if (definition.name !== 'runChecklist.manage') {
    throw new Error('Only runChecklist.manage can be bound to RunChecklistStore.');
  }
  return {
    ...definition,
    execute: (args) => executeRunChecklist(store, args),
  };
}

export function createRunChecklistTools(): ToolDefinition[] {
  return [runChecklistManage];
}
