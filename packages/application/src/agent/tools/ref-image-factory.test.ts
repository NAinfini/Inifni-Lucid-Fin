import { describe, expect, it, vi } from 'vitest';
import { createRefImageTools, type RefImageFactoryConfig, type RefImageEntity } from './ref-image-factory.js';

interface TestEntity extends RefImageEntity {
  name: string;
}

// Synthetic test view kind so the factory tests don't depend on any specific
// domain (character/equipment/location). Mirrors the real factory contract:
// a discriminated union with a `kind` field and an optional `angle`.
type TestView = { kind: 'primary' } | { kind: 'extra-angle'; angle: string };

function parseTestView(raw: unknown): TestView {
  if (raw === undefined || raw === null) return { kind: 'primary' };
  if (typeof raw !== 'object') throw new Error('view must be an object');
  const obj = raw as Record<string, unknown>;
  if (obj.kind === 'primary') return { kind: 'primary' };
  if (obj.kind === 'extra-angle') {
    if (typeof obj.angle !== 'string' || obj.angle.length === 0) {
      throw new Error('view.angle is required when kind=extra-angle');
    }
    return { kind: 'extra-angle', angle: obj.angle };
  }
  throw new Error(`view.kind must be "primary" or "extra-angle" (got ${String(obj.kind)})`);
}

function testViewToSlot(view: TestView): string {
  return view.kind === 'primary' ? 'primary' : `extra-angle:${view.angle}`;
}

function createConfig(
  overrides?: Partial<RefImageFactoryConfig<TestEntity, TestView>>,
): RefImageFactoryConfig<TestEntity, TestView> {
  return {
    toolNamePrefix: 'test',
    entityLabel: 'test entity',
    tags: ['test'],
    getEntity: vi.fn(async (id) => id === 'e1' ? { id: 'e1', name: 'Entity 1', referenceImages: [] } : null),
    saveEntity: vi.fn(async () => {}),
    generateImage: vi.fn(async () => ({ assetHash: 'hash-123' })),
    parseView: parseTestView,
    buildPrompt: vi.fn((_entity, view, style) => {
      const prefix = style ? `Style: ${style}. ` : '';
      return `${prefix}test prompt for ${testViewToSlot(view)}`;
    }),
    viewToSlot: testViewToSlot,
    kindEnum: ['primary', 'extra-angle'],
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

      const result = await tool.execute({ id: 'e1', view: { kind: 'primary' } });

      expect(result.success).toBe(true);
      expect(result.data).toMatchObject({ assetHash: 'hash-123', slot: 'primary' });
      expect(config.generateImage).toHaveBeenCalledWith(
        expect.stringContaining('test prompt for primary'),
        expect.objectContaining({ width: 2048, height: 1360 }),
      );
      expect(config.saveEntity).toHaveBeenCalledOnce();
      const savedEntity = (config.saveEntity as ReturnType<typeof vi.fn>).mock.calls[0][0] as TestEntity;
      expect(savedEntity.referenceImages).toHaveLength(1);
      expect(savedEntity.referenceImages![0]).toMatchObject({ slot: 'primary', assetHash: 'hash-123', isStandard: true });
    });

    it('defaults view to the primary kind when view is not provided', async () => {
      const config = createConfig();
      const tool = createRefImageTools(config).find((t) => t.name === 'test.generateRefImage')!;

      const result = await tool.execute({ id: 'e1' });

      expect(result.success).toBe(true);
      const data = result.data as { slot: string };
      expect(data.slot).toBe('primary');
    });

    it('uses custom prompt verbatim (with style plate prefix) when provided', async () => {
      const config = createConfig({
        getCanvas: vi.fn(async () => ({
          settings: { stylePlate: 'neo-noir watercolor' },
        } as never)),
      });
      const tool = createRefImageTools(config).find((t) => t.name === 'test.generateRefImage')!;

      await tool.execute({
        id: 'e1',
        view: { kind: 'primary' },
        canvasId: 'canvas-1',
        prompt: 'user custom prompt',
      });

      expect(config.buildPrompt).not.toHaveBeenCalled();
      expect(config.generateImage).toHaveBeenCalledWith(
        'Style: neo-noir watercolor. user custom prompt',
        expect.anything(),
      );
    });

    it('falls back to buildPrompt when prompt is omitted', async () => {
      const config = createConfig();
      const tool = createRefImageTools(config).find((t) => t.name === 'test.generateRefImage')!;

      await tool.execute({ id: 'e1', view: { kind: 'primary' } });

      expect(config.buildPrompt).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'e1' }),
        { kind: 'primary' },
        undefined,
      );
      expect(config.generateImage).toHaveBeenCalledWith(
        expect.stringContaining('test prompt for primary'),
        expect.anything(),
      );
    });

    it('fails loud when the agent passes an unrecognized view kind', async () => {
      const config = createConfig();
      const tool = createRefImageTools(config).find((t) => t.name === 'test.generateRefImage')!;

      const result = await tool.execute({ id: 'e1', view: { kind: 'portrait-main' } });

      expect(result).toMatchObject({ success: false });
      expect((result as { error: string }).error).toContain('view.kind');
      expect(config.generateImage).not.toHaveBeenCalled();
    });

    it('rejects extra-angle view without an angle label', async () => {
      const config = createConfig();
      const tool = createRefImageTools(config).find((t) => t.name === 'test.generateRefImage')!;

      const result = await tool.execute({ id: 'e1', view: { kind: 'extra-angle' } });

      expect(result.success).toBe(false);
      expect((result as { error: string }).error).toContain('view.angle');
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
          referenceImages: [{ slot: 'primary', assetHash: 'old-hash', isStandard: true }],
        })),
      });
      const tool = createRefImageTools(config).find((t) => t.name === 'test.generateRefImage')!;

      const result = await tool.execute({ id: 'e1', view: { kind: 'primary' } });

      expect(result.success).toBe(true);
      const savedEntity = (config.saveEntity as ReturnType<typeof vi.fn>).mock.calls[0][0] as TestEntity;
      const primary = savedEntity.referenceImages?.find((r) => r.slot === 'primary');
      expect(primary?.assetHash).toBe('hash-123');
      expect(primary?.variants).toContain('old-hash');
    });

    it('threads canvas-scoped stylePlate into the prompt builder', async () => {
      const config = createConfig({
        getCanvas: vi.fn(async () => ({
          settings: { stylePlate: 'style-xyz' },
        } as never)),
      });
      const tool = createRefImageTools(config).find((t) => t.name === 'test.generateRefImage')!;

      await tool.execute({ id: 'e1', view: { kind: 'primary' }, canvasId: 'canvas-1' });

      expect(config.buildPrompt).toHaveBeenCalledWith(
        expect.anything(),
        { kind: 'primary' },
        'style-xyz',
      );
    });

    it('uses canvas imageProviderId when no explicit providerId is supplied', async () => {
      const config = createConfig({
        getCanvas: vi.fn(async () => ({
          settings: { imageProviderId: 'flux-2-pro' },
        } as never)),
      });
      const tool = createRefImageTools(config).find((t) => t.name === 'test.generateRefImage')!;

      await tool.execute({ id: 'e1', view: { kind: 'primary' }, canvasId: 'canvas-1' });

      expect(config.generateImage).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ providerId: 'flux-2-pro' }),
      );
    });

    it('uses canvas refResolution when args.width/height are omitted', async () => {
      const config = createConfig({
        getCanvas: vi.fn(async () => ({
          settings: { refResolution: { width: 1536, height: 1024 } },
        } as never)),
      });
      const tool = createRefImageTools(config).find((t) => t.name === 'test.generateRefImage')!;

      await tool.execute({ id: 'e1', view: { kind: 'primary' }, canvasId: 'canvas-1' });

      expect(config.generateImage).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ width: 1536, height: 1024 }),
      );
    });

    it('appends canvas negativePrompt as "Avoid: …" trailing segment', async () => {
      const config = createConfig({
        getCanvas: vi.fn(async () => ({
          settings: { negativePrompt: 'text, watermark' },
        } as never)),
      });
      const tool = createRefImageTools(config).find((t) => t.name === 'test.generateRefImage')!;

      await tool.execute({ id: 'e1', view: { kind: 'primary' }, canvasId: 'canvas-1' });

      expect(config.generateImage).toHaveBeenCalledWith(
        expect.stringContaining('Avoid: text, watermark'),
        expect.anything(),
      );
    });
  });

  describe('setRefImage', () => {
    it('sets ref image from existing asset', async () => {
      const config = createConfig();
      const tool = createRefImageTools(config).find((t) => t.name === 'test.setRefImage')!;

      const result = await tool.execute({ id: 'e1', view: { kind: 'primary' }, assetHash: 'abc' });

      expect(result.success).toBe(true);
      expect(result.data).toMatchObject({ assetHash: 'abc', slot: 'primary' });
      expect(config.saveEntity).toHaveBeenCalledOnce();
      const savedEntity = (config.saveEntity as ReturnType<typeof vi.fn>).mock.calls[0][0] as TestEntity;
      expect(savedEntity.referenceImages).toHaveLength(1);
      expect(savedEntity.referenceImages![0]).toMatchObject({ slot: 'primary', assetHash: 'abc', isStandard: true });
    });

    it('returns fail when assetHash is missing', async () => {
      const config = createConfig();
      const tool = createRefImageTools(config).find((t) => t.name === 'test.setRefImage')!;

      const result = await tool.execute({ id: 'e1', view: { kind: 'primary' } });

      expect(result.success).toBe(false);
      expect(result.error).toContain('assetHash is required');
    });

    it('returns fail for missing entity', async () => {
      const config = createConfig();
      const tool = createRefImageTools(config).find((t) => t.name === 'test.setRefImage')!;

      const result = await tool.execute({ id: 'missing', view: { kind: 'primary' }, assetHash: 'abc' });

      expect(result.success).toBe(false);
    });

    it('replaces existing slot when already present', async () => {
      const config = createConfig({
        getEntity: vi.fn(async () => ({
          id: 'e1',
          name: 'Entity 1',
          referenceImages: [{ slot: 'primary', assetHash: 'old', isStandard: true }],
        })),
      });
      const tool = createRefImageTools(config).find((t) => t.name === 'test.setRefImage')!;

      await tool.execute({ id: 'e1', view: { kind: 'primary' }, assetHash: 'new' });

      const savedEntity = (config.saveEntity as ReturnType<typeof vi.fn>).mock.calls[0][0] as TestEntity;
      expect(savedEntity.referenceImages).toHaveLength(1);
      expect(savedEntity.referenceImages![0].assetHash).toBe('new');
    });
  });

  describe('deleteRefImage', () => {
    it('removes ref image for the specified view', async () => {
      const config = createConfig({
        getEntity: vi.fn(async () => ({
          id: 'e1',
          name: 'Entity 1',
          referenceImages: [
            { slot: 'primary', assetHash: 'abc', isStandard: true },
            { slot: 'extra-angle:side', assetHash: 'def', isStandard: true },
          ],
        })),
      });
      const tool = createRefImageTools(config).find((t) => t.name === 'test.deleteRefImage')!;

      const result = await tool.execute({ id: 'e1', view: { kind: 'primary' } });

      expect(result.success).toBe(true);
      expect(result.data).toMatchObject({ id: 'e1', slot: 'primary' });
      const savedEntity = (config.saveEntity as ReturnType<typeof vi.fn>).mock.calls[0][0] as TestEntity;
      expect(savedEntity.referenceImages).toHaveLength(1);
      expect(savedEntity.referenceImages![0].slot).toBe('extra-angle:side');
    });

    it('returns fail for missing entity', async () => {
      const config = createConfig();
      const tool = createRefImageTools(config).find((t) => t.name === 'test.deleteRefImage')!;

      const result = await tool.execute({ id: 'missing', view: { kind: 'primary' } });

      expect(result.success).toBe(false);
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
        view: { kind: 'primary' },
      });

      expect(result.success).toBe(true);
      expect(result.data).toMatchObject({ id: 'e1', slot: 'primary', assetHash: 'v1' });
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
        view: { kind: 'primary' },
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
        view: { kind: 'primary' },
      });

      expect(result.success).toBe(false);
      expect((result as { error: string }).error).toContain('Node not found');
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
        view: { kind: 'primary' },
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
        view: { kind: 'primary' },
      });

      expect(result).toEqual({ success: false, error: 'No generated asset on node' });
    });
  });
});
