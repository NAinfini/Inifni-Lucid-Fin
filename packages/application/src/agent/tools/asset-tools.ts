import type { AssetMeta, AssetRef, AssetType } from '@lucid-fin/contracts';
import type { AgentTool } from '../tool-registry.js';
import { ok, fail, requireString } from './tool-result-helpers.js';

export interface AssetToolDeps {
  importAsset: (filePath: string, type: AssetType) => Promise<AssetRef>;
  listAssets: (type?: AssetType, limit?: number) => Promise<AssetMeta[]>;
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
    description: 'List assets in the current project, optionally filtered by type.',
    tier: 1,
    parameters: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          description: 'Optional asset type filter.',
          enum: ['image', 'video', 'audio'],
        },
        query: { type: 'string', description: 'Optional search query. Matches against asset file name or hash (case-insensitive).' },
        offset: { type: 'number', description: 'Start index (0-based). Default 0.' },
        limit: { type: 'number', description: 'Max items to return. Default 50.' },
      },
      required: [],
    },
    async execute(args) {
      try {
        const type = parseAssetType(args.type);
        const offset = typeof args.offset === 'number' && args.offset >= 0 ? Math.floor(args.offset) : 0;
        const limit = typeof args.limit === 'number' && args.limit > 0 ? Math.floor(args.limit) : 50;
        const assets = await deps.listAssets(type);
        const query = typeof args.query === 'string' && args.query.length > 0
          ? args.query.toLowerCase()
          : undefined;
        let filtered = assets;
        if (query) {
          filtered = assets.filter((a) => {
            const meta = a as unknown as Record<string, unknown>;
            const name = typeof meta.name === 'string' ? meta.name.toLowerCase() : '';
            const hash = typeof meta.hash === 'string' ? meta.hash.toLowerCase() : '';
            return name.includes(query) || hash.includes(query);
          });
        }
        return ok({ total: filtered.length, offset, limit, assets: filtered.slice(offset, offset + limit) });
      } catch (error) {
        return fail(error);
      }
    },
  };

  return [importTool, listTool];
}
