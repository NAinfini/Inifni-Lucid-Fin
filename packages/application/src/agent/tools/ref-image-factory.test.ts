import { describe, expect, it, vi } from 'vitest';
import { createRefImageTool, type RefImageFactoryConfig, type RefImageEntity } from './ref-image-factory.js';

interface TestEntity extends RefImageEntity {
  name: string;
}

function createConfig(overrides?: Partial<RefImageFactoryConfig<TestEntity>>): RefImageFactoryConfig<TestEntity> {
  return {
    toolName: 'test.refImage',
    entityLabel: 'test entity',
    tags: ['test'],
    getEntity: vi.fn(async (id) => id === 'e1' ? { id: 'e1', name: 'Entity 1', referenceImages: [] } : null),
    saveEntity: vi.fn(async () => {}),
    generateImage: vi.fn(async () => ({ assetHash: 'hash-123' })),
    buildPrompt: vi.fn(() => 'test prompt'),
    isStandardSlot: vi.fn((slot) => slot === 'portrait'),
    ...overrides,
  };
}

describe('createRefImageTool', () => {
  describe('tool metadata', () => {
    it('has correct name', () => {
      const tool = createRefImageTool(createConfig());
      expect(tool.name).toBe('test.refImage');
    });

    it('has correct tags', () => {
      const tool = createRefImageTool(createConfig());
      expect(tool.tags).toEqual(['test']);
    });

    it('has tier 3', () => {
      const tool = createRefImageTool(createConfig());
      expect(tool.tier).toBe(3);
    });

    it('has no context set', () => {
      const tool = createRefImageTool(createConfig());
      expect(tool.context).toBeUndefined();
    });

    it('uses default description when none provided', () => {
      const tool = createRefImageTool(createConfig());
      expect(tool.description).toBe('Manage reference images for a test entity.');
    });

    it('uses custom description when provided', () => {
      const tool = createRefImageTool(createConfig({ description: 'Custom description' }));
      expect(tool.description).toBe('Custom description');
    });

    it('includes generate in actionEnum when generateImage is provided', () => {
      const tool = createRefImageTool(createConfig());
      const actionParam = tool.parameters.properties['action'];
      expect(actionParam.enum).toContain('generate');
    });

    it('excludes generate from actionEnum when generateImage is not provided', () => {
      const tool = createRefImageTool(createConfig({ generateImage: undefined }));
      const actionParam = tool.parameters.properties['action'];
      expect(actionParam.enum).not.toContain('generate');
    });
  });

  describe('action: generate', () => {
    it('generates image and saves entity with new ref image', async () => {
      const config = createConfig();
      const tool = createRefImageTool(config);

      const result = await tool.execute({ action: 'generate', id: 'e1', slot: 'portrait' });

      expect(result.success).toBe(true);
      expect(result.data).toMatchObject({ assetHash: 'hash-123', slot: 'portrait' });
      expect(config.generateImage).toHaveBeenCalledWith('test prompt', expect.objectContaining({ width: 1536, height: 1024 }));
      expect(config.saveEntity).toHaveBeenCalledOnce();
      const savedEntity = (config.saveEntity as ReturnType<typeof vi.fn>).mock.calls[0][0] as TestEntity;
      expect(savedEntity.referenceImages).toHaveLength(1);
      expect(savedEntity.referenceImages![0]).toMatchObject({ slot: 'portrait', assetHash: 'hash-123', isStandard: true });
    });

    it('defaults slot to "main" when slot not provided', async () => {
      const config = createConfig();
      const tool = createRefImageTool(config);

      const result = await tool.execute({ action: 'generate', id: 'e1' });

      expect(result.success).toBe(true);
      const data = result.data as { slot: string };
      expect(data.slot).toBe('main');
    });

    it('uses custom prompt override when provided', async () => {
      const config = createConfig();
      const tool = createRefImageTool(config);

      await tool.execute({ action: 'generate', id: 'e1', slot: 'portrait', prompt: 'custom prompt' });

      expect(config.generateImage).toHaveBeenCalledWith('custom prompt', expect.anything());
      expect(config.buildPrompt).not.toHaveBeenCalled();
    });

    it('returns fail for missing entity', async () => {
      const config = createConfig();
      const tool = createRefImageTool(config);

      const result = await tool.execute({ action: 'generate', id: 'missing' });

      expect(result).toEqual({ success: false, error: 'Test entity not found: missing' });
    });

    it('returns fail when generateImage is not available', async () => {
      const config = createConfig({ generateImage: undefined });
      const tool = createRefImageTool(config);

      const result = await tool.execute({ action: 'generate', id: 'e1', slot: 'portrait' });

      expect(result).toEqual({ success: false, error: 'Image generation not available' });
    });

    it('pushes previous assetHash to variants on re-generate', async () => {
      const config = createConfig({
        getEntity: vi.fn(async () => ({
          id: 'e1',
          name: 'Entity 1',
          referenceImages: [{ slot: 'portrait', assetHash: 'old-hash', isStandard: true }],
        })),
      });
      const tool = createRefImageTool(config);

      const result = await tool.execute({ action: 'generate', id: 'e1', slot: 'portrait' });

      expect(result.success).toBe(true);
      const savedEntity = (config.saveEntity as ReturnType<typeof vi.fn>).mock.calls[0][0] as TestEntity;
      const portrait = savedEntity.referenceImages?.find((r) => r.slot === 'portrait');
      expect(portrait?.assetHash).toBe('hash-123');
      expect(portrait?.variants).toContain('old-hash');
    });
  });

  describe('action: set', () => {
    it('sets ref image from existing asset', async () => {
      const config = createConfig();
      const tool = createRefImageTool(config);

      const result = await tool.execute({ action: 'set', id: 'e1', slot: 'portrait', assetHash: 'abc' });

      expect(result.success).toBe(true);
      expect(result.data).toMatchObject({ assetHash: 'abc', slot: 'portrait' });
      expect(config.saveEntity).toHaveBeenCalledOnce();
      const savedEntity = (config.saveEntity as ReturnType<typeof vi.fn>).mock.calls[0][0] as TestEntity;
      expect(savedEntity.referenceImages).toHaveLength(1);
      expect(savedEntity.referenceImages![0]).toMatchObject({ slot: 'portrait', assetHash: 'abc', isStandard: true });
    });

    it('returns fail when assetHash is missing', async () => {
      const config = createConfig();
      const tool = createRefImageTool(config);

      const result = await tool.execute({ id: 'e1', action: 'set', slot: 'portrait' });

      expect(result.success).toBe(false);
      expect(result.error).toContain('assetHash is required');
    });

    it('returns fail when slot is missing', async () => {
      const config = createConfig();
      const tool = createRefImageTool(config);

      const result = await tool.execute({ id: 'e1', action: 'set', assetHash: 'abc' });

      expect(result.success).toBe(false);
      expect(result.error).toContain('slot is required');
    });

    it('returns fail for missing entity', async () => {
      const config = createConfig();
      const tool = createRefImageTool(config);

      const result = await tool.execute({ action: 'set', id: 'missing', slot: 'portrait', assetHash: 'abc' });

      expect(result.success).toBe(false);
    });

    it('replaces existing slot when already present', async () => {
      const config = createConfig({
        getEntity: vi.fn(async () => ({
          id: 'e1',
          name: 'Entity 1',
          referenceImages: [{ slot: 'portrait', assetHash: 'old', isStandard: true }],
        })),
      });
      const tool = createRefImageTool(config);

      await tool.execute({ action: 'set', id: 'e1', slot: 'portrait', assetHash: 'new' });

      const savedEntity = (config.saveEntity as ReturnType<typeof vi.fn>).mock.calls[0][0] as TestEntity;
      expect(savedEntity.referenceImages).toHaveLength(1);
      expect(savedEntity.referenceImages![0].assetHash).toBe('new');
    });
  });

  describe('action: delete', () => {
    it('removes ref image for slot', async () => {
      const config = createConfig({
        getEntity: vi.fn(async () => ({
          id: 'e1',
          name: 'Entity 1',
          referenceImages: [
            { slot: 'portrait', assetHash: 'abc', isStandard: true },
            { slot: 'side', assetHash: 'def', isStandard: false },
          ],
        })),
      });
      const tool = createRefImageTool(config);

      const result = await tool.execute({ action: 'delete', id: 'e1', slot: 'portrait' });

      expect(result.success).toBe(true);
      expect(result.data).toMatchObject({ id: 'e1', slot: 'portrait' });
      const savedEntity = (config.saveEntity as ReturnType<typeof vi.fn>).mock.calls[0][0] as TestEntity;
      expect(savedEntity.referenceImages).toHaveLength(1);
      expect(savedEntity.referenceImages![0].slot).toBe('side');
    });

    it('returns fail for missing entity', async () => {
      const config = createConfig();
      const tool = createRefImageTool(config);

      const result = await tool.execute({ action: 'delete', id: 'missing', slot: 'portrait' });

      expect(result.success).toBe(false);
    });

    it('returns fail when slot is missing', async () => {
      const config = createConfig();
      const tool = createRefImageTool(config);

      const result = await tool.execute({ action: 'delete', id: 'e1' });

      expect(result.success).toBe(false);
      expect(result.error).toContain('slot is required');
    });
  });

  describe('action: setFromNode', () => {
    function buildCanvas(nodeOverrides?: Partial<{ type: string; data: Record<string, unknown> }>) {
      return {
        id: 'canvas-1',
        name: 'Test Canvas',
        nodes: [
          {
            id: 'node-1',
            type: nodeOverrides?.type ?? 'image',
            position: { x: 0, y: 0 },
            data: nodeOverrides?.data ?? {
              assetHash: 'node-hash',
              variants: ['v0', 'v1'],
              selectedVariantIndex: 1,
            },
            title: 'Node',
            status: 'idle',
            bypassed: false,
            locked: false,
            createdAt: 0,
            updatedAt: 0,
          },
        ],
        edges: [],
        viewport: { x: 0, y: 0, zoom: 1 },
        notes: [],
        createdAt: 0,
        updatedAt: 0,
      };
    }

    it('sets ref image from canvas node asset', async () => {
      const canvas = buildCanvas();
      const config = createConfig({
        getCanvas: vi.fn(async () => canvas as never),
      });
      const tool = createRefImageTool(config);

      const result = await tool.execute({
        action: 'setFromNode',
        id: 'e1',
        canvasId: 'canvas-1',
        nodeId: 'node-1',
        slot: 'portrait',
      });

      expect(result.success).toBe(true);
      expect(result.data).toMatchObject({ id: 'e1', slot: 'portrait', assetHash: 'v1' });
      expect(config.saveEntity).toHaveBeenCalledOnce();
    });

    it('falls back to assetHash when no variants on node', async () => {
      const canvas = buildCanvas({ data: { assetHash: 'fallback-hash' } });
      const config = createConfig({
        getCanvas: vi.fn(async () => canvas as never),
      });
      const tool = createRefImageTool(config);

      const result = await tool.execute({
        action: 'setFromNode',
        id: 'e1',
        canvasId: 'canvas-1',
        nodeId: 'node-1',
        slot: 'portrait',
      });

      expect(result.success).toBe(true);
      const data = result.data as { assetHash: string };
      expect(data.assetHash).toBe('fallback-hash');
    });

    it('returns fail when getCanvas is not configured', async () => {
      const config = createConfig({ getCanvas: undefined });
      const tool = createRefImageTool(config);

      const result = await tool.execute({
        action: 'setFromNode',
        id: 'e1',
        canvasId: 'canvas-1',
        nodeId: 'node-1',
        slot: 'portrait',
      });

      expect(result).toEqual({ success: false, error: 'getCanvas not available' });
    });

    it('returns fail when node is not found', async () => {
      const canvas = buildCanvas();
      const config = createConfig({
        getCanvas: vi.fn(async () => canvas as never),
      });
      const tool = createRefImageTool(config);

      const result = await tool.execute({
        action: 'setFromNode',
        id: 'e1',
        canvasId: 'canvas-1',
        nodeId: 'node-999',
        slot: 'portrait',
      });

      expect(result).toEqual({ success: false, error: 'Node not found: node-999' });
    });

    it('returns fail when node type is unsupported', async () => {
      const canvas = buildCanvas({ type: 'text', data: { content: 'hello' } });
      const config = createConfig({
        getCanvas: vi.fn(async () => canvas as never),
      });
      const tool = createRefImageTool(config);

      const result = await tool.execute({
        action: 'setFromNode',
        id: 'e1',
        canvasId: 'canvas-1',
        nodeId: 'node-1',
        slot: 'portrait',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Node type does not support reference images');
    });

    it('returns fail when node has no generated asset', async () => {
      const canvas = buildCanvas({ data: {} });
      const config = createConfig({
        getCanvas: vi.fn(async () => canvas as never),
      });
      const tool = createRefImageTool(config);

      const result = await tool.execute({
        action: 'setFromNode',
        id: 'e1',
        canvasId: 'canvas-1',
        nodeId: 'node-1',
        slot: 'portrait',
      });

      expect(result).toEqual({ success: false, error: 'No generated asset on node' });
    });
  });

  describe('unknown action', () => {
    it('returns fail for unknown action', async () => {
      const config = createConfig();
      const tool = createRefImageTool(config);

      const result = await tool.execute({ action: 'fly', id: 'e1' });

      expect(result).toEqual({ success: false, error: 'Unknown action: fly' });
    });
  });
});
