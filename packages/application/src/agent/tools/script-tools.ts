import type { ScriptDocument, ParsedScene } from '@lucid-fin/contracts';
import type { AgentTool } from '../tool-registry.js';

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
  function ok(data?: unknown) {
    return data === undefined ? { success: true } : { success: true, data };
  }

  function fail(err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }

  function requireString(args: Record<string, unknown>, key: string): string {
    const value = args[key];
    if (typeof value !== 'string' || value.trim().length === 0) {
      throw new Error(`${key} is required`);
    }
    return value.trim();
  }

  const scriptRead: AgentTool = {
    name: 'script.read',
    description: 'Read the current script content and its parsed scenes.',
    context: ['script-editor', 'storyboard', 'orchestrator'],
    tier: 1,
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
    async execute(_args) {
      try {
        const script = await deps.loadScript();
        if (!script) {
          return ok({ content: '', parsedScenes: [] });
        }
        return ok({ content: script.content, parsedScenes: script.parsedScenes });
      } catch (err) {
        return fail(err);
      }
    },
  };

  const scriptWrite: AgentTool = {
    name: 'script.write',
    description: 'Replace the full script content with new text.',
    context: ['script-editor'],
    tier: 2,
    parameters: {
      type: 'object',
      properties: {
        content: { type: 'string', description: 'The new full script content to save.' },
      },
      required: ['content'],
    },
    async execute(args) {
      try {
        const content = args.content as string;
        await deps.saveScript(content);
        const parsedScenes = deps.parseScript(content);
        return ok({ parsedScenes });
      } catch (err) {
        return fail(err);
      }
    },
  };

  const scriptLoad: AgentTool = {
    name: 'script.load',
    description: 'Load a script file from disk into the current project.',
    context: ['canvas', 'script-editor', 'storyboard', 'orchestrator'],
    tier: 2,
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute or project-safe path to the script file.' },
      },
      required: ['path'],
    },
    async execute(args) {
      try {
        const path = requireString(args, 'path');
        await deps.loadScript(path);
        return ok({ path });
      } catch (err) {
        return fail(err);
      }
    },
  };

  const scriptImport: AgentTool = {
    name: 'script.import',
    description: 'Import raw script content into the current project and parse its scenes.',
    context: ['canvas', 'script-editor', 'storyboard', 'orchestrator'],
    tier: 2,
    parameters: {
      type: 'object',
      properties: {
        content: { type: 'string', description: 'Raw script content to import.' },
        format: {
          type: 'string',
          description: 'Optional script format hint.',
          enum: ['fountain', 'fdx', 'plaintext'],
        },
      },
      required: ['content'],
    },
    async execute(args) {
      try {
        const content = requireString(args, 'content');
        const format = typeof args.format === 'string' ? args.format : undefined;
        const imported = await deps.importScript(content, format);
        return ok(imported);
      } catch (err) {
        return fail(err);
      }
    },
  };

  return [scriptRead, scriptWrite, scriptLoad, scriptImport];
}
