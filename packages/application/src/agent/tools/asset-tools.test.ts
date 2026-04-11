import { describe, expect, it, vi } from 'vitest';
import { createAssetTools, type AssetToolDeps } from './asset-tools.js';

function createDeps(): AssetToolDeps {
  return {
    importAsset: vi.fn(async (filePath: string, type: 'image' | 'video' | 'audio') => ({
      assetHash: 'asset-1',
      type,
      label: filePath,
      storageKey: 'storage-key',
      mimeType: 'image/png',
      bytes: 123,
      createdAt: 1,
      updatedAt: 1,
    })),
    listAssets: vi.fn(async (type?: 'image' | 'video' | 'audio') => [
      { id: 'asset-1', hash: 'hash-1', type: type ?? 'image', mimeType: 'image/png', bytes: 1, createdAt: 1, updatedAt: 1 },
      { id: 'asset-2', hash: 'hash-2', type: type ?? 'image', mimeType: 'image/jpeg', bytes: 2, createdAt: 2, updatedAt: 2 },
    ]),
  };
}

function getTool(name: string, deps: AssetToolDeps) {
  const tool = createAssetTools(deps).find((entry) => entry.name === name);
  if (!tool) throw new Error(`Missing tool: ${name}`);
  return tool;
}

describe('createAssetTools', () => {
  it('defines import and list tools with expected required parameters', () => {
    const deps = createDeps();
    const tools = createAssetTools(deps);

    expect(tools.map((tool) => tool.name)).toEqual(['asset.import', 'asset.list']);
    expect(getTool('asset.import', deps).parameters.required).toEqual(['filePath', 'type']);
    expect(getTool('asset.list', deps).parameters.required).toEqual([]);
  });

  it('imports an asset through the dependency', async () => {
    const deps = createDeps();

    await expect(getTool('asset.import', deps).execute({
      filePath: ' C:/tmp/example.png ',
      type: 'image',
    })).resolves.toEqual({
      success: true,
      data: expect.objectContaining({
        assetHash: 'asset-1',
        type: 'image',
        label: 'C:/tmp/example.png',
      }),
    });
    expect(deps.importAsset).toHaveBeenCalledWith('C:/tmp/example.png', 'image');
  });

  it('lists assets with pagination defaults and filtering', async () => {
    const deps = createDeps();

    await expect(getTool('asset.list', deps).execute({
      type: 'video',
      offset: 1.9,
      limit: 1.2,
    })).resolves.toEqual({
      success: true,
      data: {
        total: 2,
        offset: 1,
        limit: 1,
        assets: [
          expect.objectContaining({
            id: 'asset-2',
            type: 'video',
          }),
        ],
      },
    });
    expect(deps.listAssets).toHaveBeenCalledWith('video');
  });

  it('returns validation errors for missing strings and invalid asset types', async () => {
    const deps = createDeps();

    await expect(getTool('asset.import', deps).execute({
      filePath: '   ',
      type: 'image',
    })).resolves.toEqual({ success: false, error: 'filePath is required' });

    await expect(getTool('asset.list', deps).execute({
      type: 'pdf',
    })).resolves.toEqual({ success: false, error: 'type must be one of image, video, or audio' });
  });

  it('wraps dependency failures', async () => {
    const deps = createDeps();
    vi.mocked(deps.importAsset).mockRejectedValueOnce(new Error('disk error'));

    await expect(getTool('asset.import', deps).execute({
      filePath: 'C:/tmp/example.png',
      type: 'image',
    })).resolves.toEqual({ success: false, error: 'disk error' });
  });
});
