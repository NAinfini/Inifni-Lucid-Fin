import type { AssetMeta, AssetRef, AssetType } from '@lucid-fin/contracts';
import type { AgentTool, ToolResult } from '../tool-registry.js';

export interface AssetToolDeps {
  importAsset: (filePath: string, type: AssetType) => Promise<AssetRef>;
  listAssets: (type?: AssetType, limit?: number) => Promise<AssetMeta[]>;
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

function parseAssetType(value: unknown): AssetType | undefined {
  if (value === undefined) return undefined;
  if (value === 'image' || value === 'video' || value === 'audio') {
    return value;
  }
  throw new Error('type must be one of image, video, or audio');
}

export function createAssetTools(deps: AssetToolDeps): AgentTool[] {
  const importTool: AgentTool = {
    name: 'asset.import',
    description: 'Import a local asset file into the current project asset library.',
    tier: 2,
    parameters: {
      type: 'object',
      properties: {
        filePath: { type: 'string', description: 'Absolute file path to import.' },
        type: {
          type: 'string',
          description: 'Asset type.',
          enum: ['image', 'video', 'audio'],
        },
      },
      required: ['filePath', 'type'],
    },
    async execute(args) {
      try {
        const filePath = requireString(args, 'filePath');
        const type = parseAssetType(args.type);
        if (!type) {
          throw new Error('type is required');
        }
        return ok(await deps.importAsset(filePath, type));
      } catch (error) {
        return fail(error);
      }
    },
  };

  const listTool: AgentTool = {
    name: 'asset.list',
    description: 'List assets in the current project, optionally filtered by type and limit.',
    tier: 1,
    parameters: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          description: 'Optional asset type filter.',
          enum: ['image', 'video', 'audio'],
        },
        limit: { type: 'number', description: 'Optional maximum number of assets to return.' },
      },
      required: [],
    },
    async execute(args) {
      try {
        const type = parseAssetType(args.type);
        const limit =
          typeof args.limit === 'number' && Number.isFinite(args.limit)
            ? Math.max(1, Math.round(args.limit))
            : undefined;
        return ok(await deps.listAssets(type, limit));
      } catch (error) {
        return fail(error);
      }
    },
  };

  return [importTool, listTool];
}
