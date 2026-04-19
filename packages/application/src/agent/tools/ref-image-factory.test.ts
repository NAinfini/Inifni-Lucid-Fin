import { describe, expect, it, vi } from 'vitest';
import { createRefImageTools, type RefImageFactoryConfig, type RefImageEntity } from './ref-image-factory.js';

interface TestEntity extends RefImageEntity {
  name: string;
}

function createConfig(overrides?: Partial<RefImageFactoryConfig<TestEntity>>): RefImageFactoryConfig<TestEntity> {
  return {
    toolNamePrefix: 'test',
    entityLabel: 'test entity',
    tags: ['test'],
    getEntity: vi.fn(async (id) => id === 'e1' ? { id: 'e1', name: 'Entity 1', referenceImages: [] } : null),
    saveEntity: vi.fn(async () => {}),
    generateImage: vi.fn(async () => ({ assetHash: 'hash-123' })),
    buildPrompt: vi.fn(() => 'test prompt'),
    isStandardSlot: vi.fn((slot) => slot === 'portrait'),
    normalizeSlot: vi.fn((slot) => slot.trim().toLowerCase()),
    ...overrides,
  };
}

describe('createRefImageTools', () => {
  describe('tool metadata', () => {
    it('generates correct tool names', () => {
      const tools = createRefImageTools(createConfig({ getCanvas: vi.fn(async () => ({} as never)) }));
      const names = tools.map((t) => t.name);
      expect(names).toContain('test.generateRefImage');
      expect(names).toContain('test.setRefImage');
      expect(names).toContain('test.deleteRefImage');
      expect(names).toContain('test.setRefImageFromNode');
    });

    it('has correct tags on all tools', () => {
      const tools = createRefImageTools(createConfig());
      for (const tool of tools) {
        expect(tool.tags).toEqual(['test']);
      }
    });

    it('all tools have tier 3', () => {
      const tools = createRefImageTools(createConfig());
      for (const tool of tools) {
        expect(tool.tier).toBe(3);
      }
    });

    it('excludes generateRefImage when generateImage is not provided', () => {
      const tools = createRefImageTools(createConfig({ generateImage: undefined }));
      const names = tools.map((t) => t.name);
      expect(names).not.toContain('test.generateRefImage');
      expect(names).toContain('test.setRefImage');
      expect(names).toContain('test.deleteRefImage');
    });

    it('excludes setRefImageFromNode when getCanvas is not provided', () => {
      const tools = createRefImageTools(createConfig({ getCanvas: undefined }));
      const names = tools.map((t) => t.name);
      expect(names).not.toContain('test.setRefImageFromNode');
    });
  });

  describe('generateRefImage', () => {
    it('generates image and saves entity with new ref image', async () => {
      const config = createConfig();
      const tool = createRefImageTools(config).find((t) => t.name === 'test.generateRefImage')!;

      const result = await tool.execute({ id: 'e1', slot: 'portrait' });

      expect(result.success).toBe(true);
      expect(result.data).toMatchObject({ assetHash: 'hash-123', slot: 'portrait' });
      expect(config.generateImage).toHaveBeenCalledWith('test prompt', expect.objectContaining({ width: 2048, height: 1360 }));
      expect(config.saveEntity).toHaveBeenCalledOnce();
      const savedEntity = (config.saveEntity as ReturnType<typeof vi.fn>).mock.calls[0][0] as TestEntity;
      expect(savedEntity.referenceImages).toHaveLength(1);
      expect(savedEntity.referenceImages![0]).toMatchObject({ slot: 'portrait', assetHash: 'hash-123', isStandard: true });
    });

    it('defaults slot to "main" when slot not provided', async () => {
      // Every real ref-image tool treats "main" as standard — the factory
      // default itself assumes it. The test config must mirror that or the
      // fail-loud unknown-slot guard will correctly reject the default.
      const config = createConfig({
        isStandardSlot: vi.fn((slot) => slot === 'main' || slot === 'portrait'),
      });
      const tool = createRefImageTools(config).find((t) => t.name === 'test.generateRefImage')!;

      const result = await tool.execute({ id: 'e1' });

      expect(result.success).toBe(true);
      const data = result.data as { slot: string };
      expect(data.slot).toBe('main');
    });

    it('normalizes the slot before prompt selection, storage, and result reporting', async () => {
      const config = createConfig({
        isStandardSlot: vi.fn((slot) => slot === 'main'),
        normalizeSlot: vi.fn((slot) => (slot === ' Front ' ? 'main' : slot.trim().toLowerCase())),
      });
      const tool = createRefImageTools(config).find((t) => t.name === 'test.generateRefImage')!;

      const result = await tool.execute({ id: 'e1', slot: ' Front ' });

      expect(result.success).toBe(true);
      expect(config.buildPrompt).toHaveBeenCalledWith(expect.objectContaining({ id: 'e1' }), 'main');
      expect(result.data).toMatchObject({ slot: 'main' });
      const savedEntity = (config.saveEntity as ReturnType<typeof vi.fn>).mock.calls[0][0] as TestEntity;
      expect(savedEntity.referenceImages?.[0]).toMatchObject({ slot: 'main', isStandard: true });
    });

    it('ignores custom prompt for standard slots unless override mode is requested', async () => {
      const config = createConfig();
      const tool = createRefImageTools(config).find((t) => t.name === 'test.generateRefImage')!;

      await tool.execute({ id: 'e1', slot: 'portrait', prompt: 'custom prompt from AI' });

      expect(config.buildPrompt).toHaveBeenCalledWith(expect.objectContaining({ id: 'e1' }), 'portrait');
      expect(config.generateImage).toHaveBeenCalledWith(
        'test prompt',
        expect.anything(),
      );
    });

    it('uses custom prompt for standard slots only when override mode is explicit', async () => {
      const config = createConfig();
      const tool = createRefImageTools(config).find((t) => t.name === 'test.generateRefImage')!;

      await tool.execute({
        id: 'e1',
        slot: 'portrait',
        prompt: 'custom prompt from AI',
        promptMode: 'override',
      });

      expect(config.buildPrompt).not.toHaveBeenCalled();
      expect(config.generateImage).toHaveBeenCalledWith(
        'custom prompt from AI',
        expect.anything(),
      );
    });

    it('still allows custom prompts for non-standard slots when promptMode=override', async () => {
      // A user-approved custom layout goes through `promptMode: 'override'`.
      // The tool treats that slot as standard-enough to generate, forwarding
      // the custom prompt verbatim without layout guardrails.
      const config = createConfig({
        isStandardSlot: vi.fn((slot) => slot === 'portrait' || slot === 'custom-angle'),
      });
      const tool = createRefImageTools(config).find((t) => t.name === 'test.generateRefImage')!;

      await tool.execute({
        id: 'e1',
        slot: 'custom-angle',
        prompt: 'custom prompt from AI',
        promptMode: 'override',
      });

      expect(config.buildPrompt).not.toHaveBeenCalled();
      expect(config.generateImage).toHaveBeenCalledWith(
        'custom prompt from AI',
        expect.anything(),
      );
    });

    it('fails loud when the AI passes an unrecognized slot', async () => {
      // Regression: earlier behavior silently fell back to a generic
      // "Single-view character reference" prompt for unknown slots. That
      // produces an image that looks fine but violates the slot contract
      // (e.g. a portrait where a turnaround sheet was required). Surface
      // the error so the model retries with a valid slot.
      const config = createConfig({
        isStandardSlot: vi.fn((slot) => slot === 'portrait'),
        slotEnum: ['portrait', 'side'],
      });
      const tool = createRefImageTools(config).find((t) => t.name === 'test.generateRefImage')!;

      const result = await tool.execute({ id: 'e1', slot: 'portrait-main' });

      expect(result).toMatchObject({ success: false });
      expect((result as { error: string }).error).toContain('Unknown slot "portrait-main"');
      expect((result as { error: string }).error).toContain('portrait, side');
      expect(config.generateImage).not.toHaveBeenCalled();
      expect(config.buildPrompt).not.toHaveBeenCalled();
    });

    it('falls back to buildPrompt when AI prompt is omitted', async () => {
      const config = createConfig();
      const tool = createRefImageTools(config).find((t) => t.name === 'test.generateRefImage')!;

      await tool.execute({ id: 'e1', slot: 'portrait' });

      expect(config.buildPrompt).toHaveBeenCalledWith(expect.objectContaining({ id: 'e1' }), 'portrait');
      expect(config.generateImage).toHaveBeenCalledWith('test prompt', expect.anything());
    });

    it('returns fail for missing entity', async () => {
      const config = createConfig();
      const tool = createRefImageTools(config).find((t) => t.name === 'test.generateRefImage')!;

      const result = await tool.execute({ id: 'missing' });

      expect(result).toEqual({ success: false, error: 'Test entity not found: missing' });
    });

    it('pushes previous assetHash to variants on re-generate', async () => {
      const config = createConfig({
        getEntity: vi.fn(async () => ({
          id: 'e1',
          name: 'Entity 1',
          referenceImages: [{ slot: 'portrait', assetHash: 'old-hash', isStandard: true }],
        })),
      });
      const tool = createRefImageTools(config).find((t) => t.name === 'test.generateRefImage')!;

      const result = await tool.execute({ id: 'e1', slot: 'portrait' });

      expect(result.success).toBe(true);
      const savedEntity = (config.saveEntity as ReturnType<typeof vi.fn>).mock.calls[0][0] as TestEntity;
      const portrait = savedEntity.referenceImages?.find((r) => r.slot === 'portrait');
      expect(portrait?.assetHash).toBe('hash-123');
      expect(portrait?.variants).toContain('old-hash');
    });
  });

  describe('setRefImage', () => {
    it('sets ref image from existing asset', async () => {
      const config = createConfig();
      const tool = createRefImageTools(config).find((t) => t.name === 'test.setRefImage')!;

      const result = await tool.execute({ id: 'e1', slot: 'portrait', assetHash: 'abc' });

      expect(result.success).toBe(true);
      expect(result.data).toMatchObject({ assetHash: 'abc', slot: 'portrait' });
      expect(config.saveEntity).toHaveBeenCalledOnce();
      const savedEntity = (config.saveEntity as ReturnType<typeof vi.fn>).mock.calls[0][0] as TestEntity;
      expect(savedEntity.referenceImages).toHaveLength(1);
      expect(savedEntity.referenceImages![0]).toMatchObject({ slot: 'portrait', assetHash: 'abc', isStandard: true });
    });

    it('returns fail when assetHash is missing', async () => {
      const config = createConfig();
      const tool = createRefImageTools(config).find((t) => t.name === 'test.setRefImage')!;

      const result = await tool.execute({ id: 'e1', slot: 'portrait' });

      expect(result.success).toBe(false);
      expect(result.error).toContain('assetHash is required');
    });

    it('returns fail when slot is missing', async () => {
      const config = createConfig();
      const tool = createRefImageTools(config).find((t) => t.name === 'test.setRefImage')!;

      const result = await tool.execute({ id: 'e1', assetHash: 'abc' });

      expect(result.success).toBe(false);
      expect(result.error).toContain('slot is required');
    });

    it('returns fail for missing entity', async () => {
      const config = createConfig();
      const tool = createRefImageTools(config).find((t) => t.name === 'test.setRefImage')!;

      const result = await tool.execute({ id: 'missing', slot: 'portrait', assetHash: 'abc' });

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
      const tool = createRefImageTools(config).find((t) => t.name === 'test.setRefImage')!;

      await tool.execute({ id: 'e1', slot: 'portrait', assetHash: 'new' });

      const savedEntity = (config.saveEntity as ReturnType<typeof vi.fn>).mock.calls[0][0] as TestEntity;
      expect(savedEntity.referenceImages).toHaveLength(1);
      expect(savedEntity.referenceImages![0].assetHash).toBe('new');
    });
  });

  describe('deleteRefImage', () => {
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
      const tool = createRefImageTools(config).find((t) => t.name === 'test.deleteRefImage')!;

      const result = await tool.execute({ id: 'e1', slot: 'portrait' });

      expect(result.success).toBe(true);
      expect(result.data).toMatchObject({ id: 'e1', slot: 'portrait' });
      const savedEntity = (config.saveEntity as ReturnType<typeof vi.fn>).mock.calls[0][0] as TestEntity;
      expect(savedEntity.referenceImages).toHaveLength(1);
      expect(savedEntity.referenceImages![0].slot).toBe('side');
    });

    it('returns fail for missing entity', async () => {
      const config = createConfig();
      const tool = createRefImageTools(config).find((t) => t.name === 'test.deleteRefImage')!;

      const result = await tool.execute({ id: 'missing', slot: 'portrait' });

      expect(result.success).toBe(false);
    });

    it('returns fail when slot is missing', async () => {
      const config = createConfig();
      const tool = createRefImageTools(config).find((t) => t.name === 'test.deleteRefImage')!;

      const result = await tool.execute({ id: 'e1' });

      expect(result.success).toBe(false);
      expect(result.error).toContain('slot is required');
    });
  });

  describe('setRefImageFromNode', () => {
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
      const tool = createRefImageTools(config).find((t) => t.name === 'test.setRefImageFromNode')!;

      const result = await tool.execute({
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
      const tool = createRefImageTools(config).find((t) => t.name === 'test.setRefImageFromNode')!;

      const result = await tool.execute({
        id: 'e1',
        canvasId: 'canvas-1',
        nodeId: 'node-1',
        slot: 'portrait',
      });

      expect(result.success).toBe(true);
      const data = result.data as { assetHash: string };
      expect(data.assetHash).toBe('fallback-hash');
    });

    it('returns fail when node is not found', async () => {
      const canvas = buildCanvas();
      const config = createConfig({
        getCanvas: vi.fn(async () => canvas as never),
      });
      const tool = createRefImageTools(config).find((t) => t.name === 'test.setRefImageFromNode')!;

      const result = await tool.execute({
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
      const tool = createRefImageTools(config).find((t) => t.name === 'test.setRefImageFromNode')!;

      const result = await tool.execute({
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
      const tool = createRefImageTools(config).find((t) => t.name === 'test.setRefImageFromNode')!;

      const result = await tool.execute({
        id: 'e1',
        canvasId: 'canvas-1',
        nodeId: 'node-1',
        slot: 'portrait',
      });

      expect(result).toEqual({ success: false, error: 'No generated asset on node' });
    });
  });
});
