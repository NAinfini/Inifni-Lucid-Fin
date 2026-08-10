import { describe, expect, it, vi } from 'vitest';
import { AgentToolRegistry } from '../tool-registry.js';
import { createMetaTools } from './meta-tools.js';

function makeRegistry() {
  const registry = new AgentToolRegistry();
  registry.register({
    name: 'canvas.getInfo',
    description: 'Get the full state of the current canvas',
    tags: ['canvas', 'read'],
    tier: 1,
    parameters: {
      type: 'object',
      properties: { canvasId: { type: 'string', description: 'Canvas id' } },
      required: ['canvasId'],
    },
    execute: vi.fn(),
  });
  registry.register({
    name: 'canvas.deleteNode',
    description: 'Delete a node from the current canvas',
    tags: ['canvas', 'mutate'],
    tier: 1,
    parameters: {
      type: 'object',
      properties: { nodeId: { type: 'string', description: 'Node id' } },
      required: ['nodeId'],
    },
    execute: vi.fn(),
  });
  registry.register({
    name: 'character.list',
    description: 'List all characters in the project',
    tags: ['entity', 'read'],
    tier: 1,
    parameters: { type: 'object', properties: {}, required: [] },
    execute: vi.fn(),
  });
  return registry;
}

describe('createMetaTools', () => {
  it('returns exactly 3 tools: tool.get, tool.compact, guide.get', () => {
    const tools = createMetaTools(makeRegistry(), {});
    expect(tools.map((t) => t.name)).toEqual(['tool.get', 'tool.compact', 'guide.get']);
  });

  describe('tool.get', () => {
    describe('list mode (no names)', () => {
      it('returns tools grouped by domain prefix when names is omitted', async () => {
        const registry = makeRegistry();
        const tools = createMetaTools(registry, { context: 'canvas' });
        const toolGet = tools.find((t) => t.name === 'tool.get')!;

        const result = await toolGet.execute({});
        expect(result.success).toBe(true);
        expect(result.data).toEqual({
          canvas: [
            { name: 'canvas.getInfo', desc: 'Get the full state of the current canvas' },
            { name: 'canvas.deleteNode', desc: 'Delete a node from the current canvas' },
          ],
          character: [{ name: 'character.list', desc: 'List all characters in the project' }],
        });
      });

      it('treats empty names array as list-all mode', async () => {
        const registry = makeRegistry();
        const tools = createMetaTools(registry, { context: 'canvas' });
        const toolGet = tools.find((t) => t.name === 'tool.get')!;

        const result = await toolGet.execute({ names: [] });
        expect(result.success).toBe(true);
        expect(Object.keys(result.data as Record<string, unknown>)).toEqual([
          'canvas',
          'character',
        ]);
      });

      it('ignores unknown arguments when names is omitted (no query filtering)', async () => {
        const registry = makeRegistry();
        const tools = createMetaTools(registry, { context: 'canvas' });
        const toolGet = tools.find((t) => t.name === 'tool.get')!;

        const result = await toolGet.execute({ query: 'delete' });
        expect(result.success).toBe(true);
        expect(Object.keys(result.data as Record<string, unknown>)).toEqual([
          'canvas',
          'character',
        ]);
      });

      it('truncates long descriptions to 80 chars', async () => {
        const registry = new AgentToolRegistry();
        registry.register({
          name: 'test.long',
          description: 'A'.repeat(100),
          tier: 1,
          parameters: { type: 'object', properties: {}, required: [] },
          execute: vi.fn(),
        });
        const tools = createMetaTools(registry, {});
        const toolGet = tools.find((t) => t.name === 'tool.get')!;

        const result = await toolGet.execute({});
        expect(result.success).toBe(true);
        const desc = (result.data as Record<string, Array<{ desc: string }>>).test[0].desc;
        expect(desc).toHaveLength(83); // 80 + '...'
        expect(desc.endsWith('...')).toBe(true);
      });
    });

    describe('get mode (names provided)', () => {
      it('returns full schema for a single tool name through the canonical array shape', async () => {
        const registry = makeRegistry();
        const tools = createMetaTools(registry, { context: 'canvas' });
        const toolGet = tools.find((t) => t.name === 'tool.get')!;

        const result = await toolGet.execute({ names: ['canvas.getInfo'] });
        expect(result.success).toBe(true);
        expect(result.data).toEqual({
          tools: [
            {
              name: 'canvas.getInfo',
              description: 'Get the full state of the current canvas',
              parameters: {
                type: 'object',
                properties: { canvasId: { type: 'string', description: 'Canvas id' } },
                required: ['canvasId'],
              },
            },
          ],
        });
      });

      it('returns array of schemas for batch (array)', async () => {
        const registry = makeRegistry();
        const tools = createMetaTools(registry, { context: 'canvas' });
        const toolGet = tools.find((t) => t.name === 'tool.get')!;

        const result = await toolGet.execute({ names: ['canvas.getInfo', 'character.list'] });
        expect(result.success).toBe(true);
        const data = result.data as { tools: Array<{ name: string }> };
        expect(Array.isArray(data.tools)).toBe(true);
        expect(data.tools.length).toBe(2);
        expect(data.tools[0].name).toBe('canvas.getInfo');
        expect(data.tools[1].name).toBe('character.list');
      });

      it('returns error for an unknown tool name', async () => {
        const registry = makeRegistry();
        const tools = createMetaTools(registry, {});
        const toolGet = tools.find((t) => t.name === 'tool.get')!;

        const result = await toolGet.execute({ names: ['nonexistent.tool'] });
        expect(result.success).toBe(false);
        expect(result.error).toContain('None of the requested tools were found');
      });

      it('rejects the legacy string shape that the JSON schema cannot accept', async () => {
        const registry = makeRegistry();
        const toolGet = createMetaTools(registry, {}).find((tool) => tool.name === 'tool.get')!;

        await expect(toolGet.execute({ names: 'canvas.getInfo' })).resolves.toMatchObject({
          success: false,
          error: 'names must be an array of strings',
        });
      });

      it('returns found tools and lists missing ones in batch', async () => {
        const registry = makeRegistry();
        const tools = createMetaTools(registry, {});
        const toolGet = tools.find((t) => t.name === 'tool.get')!;

        const result = await toolGet.execute({ names: ['canvas.getInfo', 'bad.tool'] });
        expect(result.success).toBe(true);
        const data = result.data as { tools: Array<{ name: string }>; notFound: string[] };
        expect(data.tools.length).toBe(1);
        expect(data.tools[0].name).toBe('canvas.getInfo');
        expect(data.notFound).toEqual(['bad.tool']);
      });
    });
  });

  describe('guide.get', () => {
    describe('list mode (no ids)', () => {
      it('lists guides without content when ids is omitted', async () => {
        const registry = new AgentToolRegistry();
        const tools = createMetaTools(registry, {
          promptGuides: [
            { id: 'guide-1', name: 'Guide One', content: 'alpha' },
            { id: 'guide-2', name: 'Guide Two', content: 'beta' },
          ],
        });
        const guideGet = tools.find((t) => t.name === 'guide.get')!;

        const result = await guideGet.execute({});
        expect(result.success).toBe(true);
        expect(result.data).toEqual({
          total: 2,
          offset: 0,
          limit: 100,
          guides: [
            { id: 'guide-1', name: 'Guide One' },
            { id: 'guide-2', name: 'Guide Two' },
          ],
        });
      });

      it('respects offset and limit when ids is omitted', async () => {
        const registry = new AgentToolRegistry();
        const tools = createMetaTools(registry, {
          promptGuides: [
            { id: 'guide-1', name: 'Guide One', content: 'alpha' },
            { id: 'guide-2', name: 'Guide Two', content: 'beta' },
            { id: 'guide-3', name: 'Guide Three', content: 'gamma' },
          ],
        });
        const guideGet = tools.find((t) => t.name === 'guide.get')!;

        const result = await guideGet.execute({ offset: 1, limit: 1 });
        expect(result.success).toBe(true);
        expect((result.data as { guides: unknown[] }).guides).toEqual([
          { id: 'guide-2', name: 'Guide Two' },
        ]);
      });

      it('caps the listing limit at 100 items', async () => {
        const registry = new AgentToolRegistry();
        const tools = createMetaTools(registry, {
          promptGuides: Array.from({ length: 105 }, (_, index) => ({
            id: `guide-${index}`,
            name: `Guide ${index}`,
            content: 'content',
          })),
        });
        const guideGet = tools.find((t) => t.name === 'guide.get')!;

        const result = await guideGet.execute({ limit: 1_000 });
        expect(result.success).toBe(true);
        expect(result.data).toMatchObject({ total: 105, offset: 0, limit: 100 });
        expect((result.data as { guides: unknown[] }).guides).toHaveLength(100);
      });
    });

    describe('get mode (ids provided)', () => {
      it('fetches a single guide through the same array response shape as batches', async () => {
        const registry = new AgentToolRegistry();
        const tools = createMetaTools(registry, {
          promptGuides: [
            { id: 'guide-1', name: 'Guide One', content: 'alpha' },
            { id: 'guide-2', name: 'Guide Two', content: 'beta' },
          ],
        });
        const guideGet = tools.find((t) => t.name === 'guide.get')!;

        const result = await guideGet.execute({ ids: ['guide-2'] });
        expect(result.success).toBe(true);
        expect(result.data).toEqual({
          guides: [
            {
              id: 'guide-2',
              name: 'Guide Two',
              content: 'beta',
              totalChars: 4,
              contentOffset: 0,
              contentLength: 4,
              truncated: false,
            },
          ],
        });
      });

      it('fetches multiple guides by ids (array)', async () => {
        const registry = new AgentToolRegistry();
        const tools = createMetaTools(registry, {
          promptGuides: [
            { id: 'guide-1', name: 'Guide One', content: 'alpha' },
            { id: 'guide-2', name: 'Guide Two', content: 'beta' },
          ],
        });
        const guideGet = tools.find((t) => t.name === 'guide.get')!;

        const result = await guideGet.execute({ ids: ['guide-1', 'guide-2'] });
        expect(result.success).toBe(true);
        const data = result.data as { guides: Array<{ id: string }> };
        expect(data.guides).toEqual([
          {
            id: 'guide-1',
            name: 'Guide One',
            content: 'alpha',
            totalChars: 5,
            contentOffset: 0,
            contentLength: 5,
            truncated: false,
          },
          {
            id: 'guide-2',
            name: 'Guide Two',
            content: 'beta',
            totalChars: 4,
            contentOffset: 0,
            contentLength: 4,
            truncated: false,
          },
        ]);
      });

      it('rejects legacy string ids and batches larger than two guides', async () => {
        const registry = new AgentToolRegistry();
        const guideGet = createMetaTools(registry, {
          promptGuides: [{ id: 'guide-1', name: 'Guide One', content: 'alpha' }],
        }).find((tool) => tool.name === 'guide.get')!;

        await expect(guideGet.execute({ ids: 'guide-1' })).resolves.toMatchObject({
          success: false,
          error: 'ids must be an array of strings',
        });
        await expect(
          guideGet.execute({ ids: ['guide-1', 'guide-2', 'guide-3'] }),
        ).resolves.toMatchObject({
          success: false,
          error: 'ids accepts at most 2 guide ids',
        });
      });

      it('returns error for missing guide ids', async () => {
        const registry = new AgentToolRegistry();
        const tools = createMetaTools(registry, { promptGuides: [] });
        const guideGet = tools.find((t) => t.name === 'guide.get')!;

        const result = await guideGet.execute({ ids: ['nonexistent'] });
        expect(result.success).toBe(false);
        expect(result.error).toContain('None of the requested guides were found: [nonexistent]');
      });

      it('returns bounded chunks that can reconstruct the full guide without loss', async () => {
        const registry = new AgentToolRegistry();
        const content = 'x'.repeat(8_005);
        const guideGet = createMetaTools(registry, {
          promptGuides: [{ id: 'guide-1', name: 'Guide One', content }],
        }).find((tool) => tool.name === 'guide.get')!;

        const firstResult = await guideGet.execute({
          ids: ['guide-1'],
          contentOffset: 0,
          contentLimit: 9_000,
        });
        const first = (
          firstResult.data as {
            guides: Array<{
              content: string;
              totalChars: number;
              contentOffset: number;
              contentLength: number;
              truncated: boolean;
              nextOffset?: number;
            }>;
          }
        ).guides[0];
        expect(first).toMatchObject({
          totalChars: 8_005,
          contentOffset: 0,
          contentLength: 8_000,
          truncated: true,
          nextOffset: 8_000,
        });

        const secondResult = await guideGet.execute({
          ids: ['guide-1'],
          contentOffset: first.nextOffset,
          contentLimit: 9_000,
        });
        const second = (
          secondResult.data as {
            guides: Array<{
              content: string;
              totalChars: number;
              contentOffset: number;
              contentLength: number;
              truncated: boolean;
              nextOffset?: number;
            }>;
          }
        ).guides[0];
        expect(second).toMatchObject({
          totalChars: 8_005,
          contentOffset: 8_000,
          contentLength: 5,
          truncated: false,
        });
        expect(second).not.toHaveProperty('nextOffset');
        expect(first.content + second.content).toBe(content);
      });

      it('returns found guides and lists missing ones in batch', async () => {
        const registry = new AgentToolRegistry();
        const tools = createMetaTools(registry, {
          promptGuides: [{ id: 'guide-1', name: 'Guide One', content: 'alpha' }],
        });
        const guideGet = tools.find((t) => t.name === 'guide.get')!;

        const result = await guideGet.execute({ ids: ['guide-1', 'missing'] });
        expect(result.success).toBe(true);
        const data = result.data as { guides: Array<{ id: string }>; notFound: string[] };
        expect(data.guides.length).toBe(1);
        expect(data.guides[0].id).toBe('guide-1');
        expect(data.notFound).toEqual(['missing']);
      });
    });
  });
});
