import { NO_TOOL_RESOURCE, type ToolDefinition, type CanvasToolDeps } from './canvas-tool-utils.js';
import { toolResultSchema } from '../tool-registry.js';
import { CANVAS_CONTEXT, ok, fail } from './canvas-tool-utils.js';
import { arraySchema, enumSchema, numberSchema, objectSchema, stringSchema } from './tool-runtime-schemas.js';

const askUser: ToolDefinition = {
  name: 'commander.askUser',
  process: 'meta',
  category: 'meta',
  contextReplay: 'status_only',
  resource: NO_TOOL_RESOURCE,
  description:
    'Ask the user a structured question with clickable options when their input is needed.',
  tags: ['meta', 'interaction'],
  tier: 1,
  outputSchema: toolResultSchema(stringSchema),
  contexts: CANVAS_CONTEXT,
  inputSchema: {
    type: 'object',
    properties: {
      decisionKey: {
        type: 'string',
        description:
          'Stable semantic key for this decision (required when a persistent task list is active), e.g. style.horror.subgenre.',
      },
      question: { type: 'string', description: 'The question to ask the user' },
      allowFreeText: {
        type: 'boolean',
        description:
          'Whether the user may provide a custom answer in addition to the listed options. Defaults to true.',
      },
      options: {
        type: 'array',
        description:
          'Optional clickable choices. Omit this field for a free-text-only question.',
        items: {
          type: 'object',
          description: 'A single option',
          properties: {
            label: { type: 'string', description: 'Short option label (e.g. "Yes", "Style A")' },
            description: {
              type: 'string',
              description: 'Longer description of what this option means',
            },
            previewAssetHash: {
              type: 'string',
              description:
                'Optional SHA-256 CAS image hash to display as a visual preview for this choice.',
            },
          },
          required: ['label'],
        },
      },
    },
    required: ['question'],
  },
  execute: async () => {
    // This tool is NEVER executed directly — the orchestrator intercepts it
    // and routes it through the question flow.
    return { success: true, data: 'Waiting for user response...' };
  },
};

export function createCanvasMetaTools(deps: CanvasToolDeps): ToolDefinition[] {
  const readLogs: ToolDefinition = {
    name: 'logger.list',
    process: 'meta',
    category: 'query',
    contextReplay: 'status_only',
    resource: NO_TOOL_RESOURCE,
    description: 'Read recent application log entries for debugging',
    contexts: CANVAS_CONTEXT,
    tier: 1,
    outputSchema: toolResultSchema(
      arraySchema(
        objectSchema(
          {
            id: stringSchema,
            timestamp: numberSchema,
            level: enumSchema(['debug', 'info', 'warn', 'error', 'fatal']),
            category: stringSchema,
            message: stringSchema,
            detail: stringSchema,
          },
          ['id', 'timestamp', 'level', 'category', 'message'],
        ),
      ),
    ),
    inputSchema: {
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
