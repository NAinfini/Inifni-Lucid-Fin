import type { ScriptDocument, ParsedScene } from '@lucid-fin/contracts';
import type { AgentTool } from '../tool-registry.js';
import { ok, fail, requireString } from './tool-result-helpers.js';

export interface ScriptToolDeps {
  loadScript: (path?: string) => Promise<ScriptDocument | null>;
  saveScript: (content: string) => Promise<void>;
  parseScript: (content: string) => ParsedScene[];
  importScript: (
    content: string,
    format?: string,
  ) => Promise<{ content: string; parsedScenes: ParsedScene[]; format?: string }>;
}

export function createScriptTools(deps: ScriptToolDeps): AgentTool[] {
  const manage: AgentTool = {
    name: 'script.manage',
    description: 'Read or write the project script.',
    context: ['script-editor', 'storyboard', 'orchestrator'],
    tier: 2,
    parameters: {
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
          return ok({ content: script.content, parsedScenes: script.parsedScenes });
        } catch (err) {
          return fail(err);
        }
      } else if (action === 'write') {
        try {
          const content = typeof args.content === 'string' ? args.content : '';
          if (!content) throw new Error('content is required');
          await deps.saveScript(content);
          const parsedScenes = deps.parseScript(content);
          return ok({ parsedScenes });
        } catch (err) {
          return fail(err);
        }
      } else {
        return fail(new Error(`Unknown action: ${action}`));
      }
    },
  };

  const scriptImport: AgentTool = {
    name: 'script.import',
    description:
      'Import a script into the current project. Provide either `path` to load from disk, or `content` to import raw text.',
    context: ['canvas', 'script-editor', 'storyboard', 'orchestrator'],
    tier: 2,
    parameters: {
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
          await deps.loadScript(path);
          return ok({ path });
        }

        const hasContent =
          typeof args.content === 'string' && (args.content as string).trim().length > 0;
        if (!hasContent) {
          throw new Error('Either path or content must be provided');
        }

        const content = requireString(args, 'content');
        const format = typeof args.format === 'string' ? args.format : undefined;
        const imported = await deps.importScript(content, format);
        return ok(imported);
      } catch (err) {
        return fail(err);
      }
    },
  };

  return [manage, scriptImport];
}
