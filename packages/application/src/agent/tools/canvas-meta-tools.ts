import type { AgentTool, CanvasToolDeps } from './canvas-tool-utils.js';
import { CANVAS_CONTEXT, ok, fail } from './canvas-tool-utils.js';

const askUser: AgentTool = {
  name: 'commander.askUser',
  description:
    'Ask the user a question with multiple choice options. Use this when you need user input to proceed — for preferences, confirmations, or clarification.',
  tags: ['meta', 'interaction'],
  tier: 1,
  context: CANVAS_CONTEXT,
  parameters: {
    type: 'object',
    properties: {
      question: { type: 'string', description: 'The question to ask the user' },
      options: {
        type: 'array',
        description: 'Array of option objects with label and optional description',
        items: {
          type: 'object',
          description: 'A single option',
          properties: {
            label: { type: 'string', description: 'Short option label' },
            description: { type: 'string', description: 'Longer description of what this option means' },
          },
        },
      },
    },
    required: ['question', 'options'],
  },
  execute: async () => {
    // This tool is NEVER executed directly — the orchestrator intercepts it
    // and routes it through the question flow.
    return { success: true, data: 'Waiting for user response...' };
  },
};

export function createCanvasMetaTools(deps: CanvasToolDeps): AgentTool[] {
  const readLogs: AgentTool = {
    name: 'logger.read',
    description: 'Read recent application log entries for debugging',
    context: CANVAS_CONTEXT,
    tier: 1,
    parameters: {
      type: 'object',
      properties: {
        level: { type: 'string', description: 'Optional log level filter.' },
        category: { type: 'string', description: 'Optional log category filter.' },
        limit: { type: 'number', description: 'Optional max number of log entries to return.' },
      },
      required: [],
    },
    async execute(args) {
      try {
        const level =
          typeof args.level === 'string' && args.level.trim().length > 0
            ? args.level.trim()
            : undefined;
        const category =
          typeof args.category === 'string' && args.category.trim().length > 0
            ? args.category.trim()
            : undefined;
        const limit =
          typeof args.limit === 'number' && Number.isFinite(args.limit)
            ? Math.max(1, Math.floor(args.limit))
            : undefined;
        const entries = await deps.getRecentLogs(level, category, limit);
        return ok(entries);
      } catch (error) {
        return fail(error);
      }
    },
  };

  return [readLogs, askUser];
}
