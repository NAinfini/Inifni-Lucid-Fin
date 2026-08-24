import type { ScriptDocument, ParsedScene } from '@lucid-fin/contracts';
import { NO_TOOL_RESOURCE, toolResultSchema, type ToolDefinition } from '../tool-registry.js';
import { ok, fail, requireString } from './tool-result-helpers.js';
import { authorityFact, contextProjector, resultRecord } from './context-replay.js';
import {
  arraySchema,
  numberSchema,
  objectSchema,
  stringArraySchema,
  stringSchema,
  unionSchema,
} from './tool-runtime-schemas.js';

const dialogueLineSchema = objectSchema(
  { character: stringSchema, line: stringSchema, parenthetical: stringSchema },
  ['character', 'line'],
);
const parsedSceneSchema = objectSchema(
  {
    index: numberSchema,
    heading: stringSchema,
    location: stringSchema,
    timeOfDay: stringSchema,
    content: stringSchema,
    characters: stringArraySchema,
    dialogue: arraySchema(dialogueLineSchema),
    mood: stringSchema,
    estDuration: numberSchema,
  },
  ['index', 'heading', 'location', 'timeOfDay', 'content', 'characters', 'dialogue'],
);
const parsedScenesSchema = arraySchema(parsedSceneSchema);

export interface ScriptToolDeps {
  loadScript: (path?: string) => Promise<ScriptDocument | null>;
  saveScript: (content: string) => Promise<void>;
  parseScript: (content: string) => ParsedScene[];
  importScript: (
    content: string,
    format?: string,
  ) => Promise<{ content: string; parsedScenes: ParsedScene[]; format?: string }>;
}

export function createScriptTools(deps: ScriptToolDeps): ToolDefinition[] {
  const manage: ToolDefinition = {
    name: 'script.manage',
    process: 'script-development',
    category: 'mutation',
    contextReplay: 'authority_reread',
    resource: NO_TOOL_RESOURCE,
    description: 'Read or write the project script.',
    contexts: ['script-editor', 'storyboard', 'orchestrator'],
    tier: 2,
    outputSchema: toolResultSchema(
      unionSchema(
        objectSchema(
          { id: stringSchema, content: stringSchema, parsedScenes: parsedScenesSchema },
          ['content', 'parsedScenes'],
        ),
        objectSchema({ id: stringSchema, parsedScenes: parsedScenesSchema }, ['parsedScenes']),
      ),
    ),
    projectPublicResult: contextProjector((result, args) => [
      authorityFact('script', args.action === 'read' ? 'read' : 'updated', resultRecord(result)?.id),
    ]),
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          description: 'Action to perform.',
          enum: ['read', 'write'],
        },
        content: { type: 'string', description: 'The new full script content to save.' },
      },
      required: ['action'],
    },
    async execute(args) {
      const action = args.action as string;
      if (action === 'read') {
        try {
          const script = await deps.loadScript();
          if (!script) {
            return ok({ content: '', parsedScenes: [] });
          }
          return ok({ id: script.id, content: script.content, parsedScenes: script.parsedScenes });
        } catch (err) {
          return fail(err);
        }
      } else if (action === 'write') {
        try {
          const content = typeof args.content === 'string' ? args.content : '';
          if (!content) throw new Error('content is required');
          await deps.saveScript(content);
          const parsedScenes = deps.parseScript(content);
          const script = await deps.loadScript();
          return ok({ id: script?.id, parsedScenes });
        } catch (err) {
          return fail(err);
        }
      } else {
        return fail(new Error(`Unknown action: ${action}`));
      }
    },
  };

  const scriptImport: ToolDefinition = {
    name: 'script.import',
    process: 'script-development',
    category: 'mutation',
    contextReplay: 'authority_reread',
    resource: NO_TOOL_RESOURCE,
    description:
      'Import a script into the current project. Provide either `path` to load from disk, or `content` to import raw text.',
    contexts: ['canvas', 'script-editor', 'storyboard', 'orchestrator'],
    tier: 2,
    outputSchema: toolResultSchema(
      unionSchema(
        objectSchema({ id: stringSchema, path: stringSchema }, ['path']),
        objectSchema(
          {
            id: stringSchema,
            content: stringSchema,
            parsedScenes: parsedScenesSchema,
            format: stringSchema,
          },
          ['content', 'parsedScenes'],
        ),
      ),
    ),
    projectPublicResult: contextProjector((result) => [
      authorityFact('script', 'updated', resultRecord(result)?.id),
    ]),
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute or project-safe path to the script file.' },
        content: { type: 'string', description: 'Raw script content to import.' },
        format: {
          type: 'string',
          description: 'Optional script format hint (only used when importing raw content).',
          enum: ['fountain', 'fdx', 'plaintext'],
        },
      },
      required: [],
    },
    async execute(args) {
      try {
        const pathProvided = 'path' in args && args.path !== undefined && args.path !== null;

        if (pathProvided) {
          const path = requireString(args, 'path');
          const script = await deps.loadScript(path);
          return ok({ id: script?.id, path });
        }

        const hasContent =
          typeof args.content === 'string' && (args.content as string).trim().length > 0;
        if (!hasContent) {
          throw new Error('Either path or content must be provided');
        }

        const content = requireString(args, 'content');
        const format = typeof args.format === 'string' ? args.format : undefined;
        const imported = await deps.importScript(content, format);
        const script = await deps.loadScript();
        return ok({ ...imported, id: script?.id });
      } catch (err) {
        return fail(err);
      }
    },
  };

  return [manage, scriptImport];
}
