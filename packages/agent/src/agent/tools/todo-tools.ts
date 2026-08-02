/**
 * `todo.manage` — unified agent-facing tool that backs the Codex-CLI-style
 * run-local todo list (`TodoRunStore`). It carries the schemas the LLM sees;
 * the orchestrator intercepts the calls in `tool-executor.ts` and routes them
 * through the per-run store, so the `execute` body below is a placeholder
 * that should never run in practice. We keep `execute` defensively ok-returning
 * so that a future refactor that removes the interception cannot accidentally
 * hard-fail the agent loop.
 */

import type { AgentTool } from '../tool-registry.js';

const todoManage: AgentTool = {
  name: 'todo.manage',
  description: [
    'Create/replace or update the run-local todo list.',
    '',
    'Use `action: "set"` to create or replace the todo list. Pass 2-10 short human-readable `items`. The first item is auto-marked `in_progress`; the rest start `pending`. Calling with action "set" again REPLACES the prior list wholesale (a fresh `todoId` is issued) — only do that when the plan fundamentally changed, not to flip a status. Use this IMMEDIATELY when you recognise a multi-step workflow (shot list, style plate, style transfer, continuity check, story-to-video) so the user can see the plan AND so you can hold yourself accountable step-by-step.',
    '',
    'Use `action: "update"` to mark items on the active todo list as `in_progress` or `done`. Batch multiple updates in a single call when they happen together (e.g. mark step 2 `done` and step 3 `in_progress` atomically). At most ONE item may be `in_progress` at any time — update the current `in_progress` item to `done` first, then the next item to `in_progress`. The `todoId` MUST match the active `todoId` from the most recent "set" snapshot; a stale `todoId` will be rejected.',
    '',
    'After a successful "set", immediately perform the first committing action without another narration turn. Flip statuses *as you commit* — do not wait until the end of the run to mark everything done.',
  ].join('\n'),
  tags: ['meta', 'planning'],
  tier: 1,
  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        description:
          '"set" creates or replaces the todo list. "update" marks items as done/in_progress.',
        enum: ['set', 'update'],
      },
      items: {
        type: 'array',
        description:
          'Ordered list of 2-10 todo items (for action "set"). Each item has a short human-facing label (<=120 chars). The user sees this list as a sticky card; write labels they can read at a glance.',
        items: {
          type: 'object',
          description: 'A single todo item',
          properties: {
            label: {
              type: 'string',
              description:
                'Short human-facing label, e.g. "Sketch the 6 shot prompts" or "Apply style plate". No trailing punctuation.',
            },
          },
          required: true,
        },
      },
      todoId: {
        type: 'string',
        description:
          'The active todo list id, as returned by the most recent "set" snapshot (for action "update"). A stale id means the list has been replaced — re-read the current snapshot first.',
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
              description: 'The item id from the todo snapshot.',
            },
            status: {
              type: 'string',
              description: 'Target status for the item.',
              enum: ['pending', 'in_progress', 'done'],
            },
          },
          required: true,
        },
      },
    },
    required: ['action'],
  },
  execute: async () => {
    // Never called — the orchestrator intercepts via ToolExecutor.
    return { success: true, data: 'todo.manage handled by run store' };
  },
};

export function createTodoTools(): AgentTool[] {
  return [todoManage];
}
