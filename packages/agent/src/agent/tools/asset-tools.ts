import type { AssetEntry, AssetRef, AssetType } from '@lucid-fin/contracts';
import { NO_TOOL_RESOURCE, toolResultSchema, type ToolDefinition } from '../tool-registry.js';
import { arraySchema, assetEntrySchema, assetRefSchema, numberSchema, objectSchema } from './tool-runtime-schemas.js';
import { ok, fail, requireString } from './tool-result-helpers.js';
import { authorityFact, contextProjector, records, resultRecord } from './context-replay.js';

export interface AssetToolDeps {
  importAsset: (filePath: string, type: AssetType) => Promise<AssetRef>;
  listAssets: (type?: AssetType, limit?: number) => Promise<AssetEntry[]>;
}

function parseAssetType(value: unknown): AssetType | undefined {
  if (value === undefined) return undefined;
  if (value === 'image' || value === 'video' || value === 'audio') {
    return value;
  }
  throw new Error('type must be one of image, video, or audio');
}

export function createAssetTools(deps: AssetToolDeps): ToolDefinition[] {
  const importTool: ToolDefinition = {
    name: 'asset.import',
    process: 'asset-library-management',
    category: 'mutation',
    contextReplay: 'authority_reread',
    resource: NO_TOOL_RESOURCE,
    description: 'Import a local asset file into the current project asset library.',
    tier: 2,
    outputSchema: toolResultSchema(assetRefSchema),
    projectPublicResult: contextProjector((result) => {
      const data = resultRecord(result);
      return [
        authorityFact('cas', 'created', data?.hash, { contentHash: data?.hash }),
      ];
    }),
    inputSchema: {
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

  const listTool: ToolDefinition = {
    name: 'asset.list',
    process: 'asset-library-management',
    category: 'query',
    contextReplay: 'authority_reread',
    resource: NO_TOOL_RESOURCE,
    description: 'List assets in the current project, optionally filtered by type.',
    tier: 1,
    outputSchema: toolResultSchema(objectSchema({
      total: numberSchema,
      offset: numberSchema,
      limit: numberSchema,
      assets: arraySchema(assetEntrySchema),
    })),
    projectPublicResult: contextProjector((result) => {
      const data = resultRecord(result);
      return records(data?.assets).map((asset) =>
        authorityFact('asset_entry', 'read', asset.id, { contentHash: asset.hash }),
      );
    }),
    inputSchema: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          description: 'Optional asset type filter.',
          enum: ['image', 'video', 'audio'],
        },
        query: {
          type: 'string',
          description:
            'Optional search query. Matches against asset file name or hash (case-insensitive).',
        },
        offset: { type: 'number', description: 'Start index (0-based). Default 0.' },
        limit: { type: 'number', description: 'Max items to return. Default 50.' },
      },
      required: [],
    },
    async execute(args) {
      try {
        const type = parseAssetType(args.type);
        const offset =
          typeof args.offset === 'number' && args.offset >= 0 ? Math.floor(args.offset) : 0;
        const limit =
          typeof args.limit === 'number' && args.limit > 0 ? Math.floor(args.limit) : 50;
        const assets = await deps.listAssets(type);
        const query =
          typeof args.query === 'string' && args.query.length > 0
            ? args.query.toLowerCase()
            : undefined;
        let filtered = assets;
        if (query) {
          filtered = assets.filter((a) => {
            return (
              a.displayName.toLowerCase().includes(query) || a.hash.toLowerCase().includes(query)
            );
          });
        }
        return ok({
          total: filtered.length,
          offset,
          limit,
          assets: filtered.slice(offset, offset + limit),
        });
      } catch (error) {
        return fail(error);
      }
    },
  };

  return [importTool, listTool];
}
