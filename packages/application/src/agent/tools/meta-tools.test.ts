import { describe, expect, it, vi } from 'vitest';
import { AgentToolRegistry } from '../tool-registry.js';
import { createMetaTools } from './meta-tools.js';

function makeRegistry() {
  const registry = new AgentToolRegistry();
  registry.register({
    name: 'canvas.getState',
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
            { name: 'canvas.getState', desc: 'Get the full state of the current canvas' },
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
      it('returns full schema for a single tool name (string)', async () => {
        const registry = makeRegistry();
        const tools = createMetaTools(registry, { context: 'canvas' });
        const toolGet = tools.find((t) => t.name === 'tool.get')!;

        const result = await toolGet.execute({ names: 'canvas.getState' });
        expect(result.success).toBe(true);
        expect(result.data).toEqual({
          name: 'canvas.getState',
          description: 'Get the full state of the current canvas',
          parameters: {
            type: 'object',
            properties: { canvasId: { type: 'string', description: 'Canvas id' } },
            required: ['canvasId'],
          },
        });
      });

      it('returns array of schemas for batch (array)', async () => {
        const registry = makeRegistry();
        const tools = createMetaTools(registry, { context: 'canvas' });
        const toolGet = tools.find((t) => t.name === 'tool.get')!;

        const result = await toolGet.execute({ names: ['canvas.getState', 'character.list'] });
        expect(result.success).toBe(true);
        expect(Array.isArray(result.data)).toBe(true);
        expect((result.data as unknown[]).length).toBe(2);
        expect((result.data as Array<{ name: string }>)[0].name).toBe('canvas.getState');
        expect((result.data as Array<{ name: string }>)[1].name).toBe('character.list');
      });

      it('returns error for unknown tool name (single)', async () => {
        const registry = makeRegistry();
        const tools = createMetaTools(registry, {});
        const toolGet = tools.find((t) => t.name === 'tool.get')!;

        const result = await toolGet.execute({ names: 'nonexistent.tool' });
        expect(result.success).toBe(false);
        expect(result.error).toBe("Tool 'nonexistent.tool' not found");
      });

      it('returns error for first missing tool in batch', async () => {
        const registry = makeRegistry();
        const tools = createMetaTools(registry, {});
        const toolGet = tools.find((t) => t.name === 'tool.get')!;

        const result = await toolGet.execute({ names: ['canvas.getState', 'bad.tool'] });
        expect(result.success).toBe(false);
        expect(result.error).toBe("Tool 'bad.tool' not found");
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
          limit: 50,
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
    });

    describe('get mode (ids provided)', () => {
      it('fetches a single guide by id (string)', async () => {
        const registry = new AgentToolRegistry();
        const tools = createMetaTools(registry, {
          promptGuides: [
            { id: 'guide-1', name: 'Guide One', content: 'alpha' },
            { id: 'guide-2', name: 'Guide Two', content: 'beta' },
          ],
        });
        const guideGet = tools.find((t) => t.name === 'guide.get')!;

        const result = await guideGet.execute({ ids: 'guide-2' });
        expect(result.success).toBe(true);
        expect(result.data).toEqual({
          id: 'guide-2',
          name: 'Guide Two',
          content: 'beta',
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
        expect(result.data).toEqual([
          { id: 'guide-1', name: 'Guide One', content: 'alpha' },
          { id: 'guide-2', name: 'Guide Two', content: 'beta' },
        ]);
      });

      it('returns error for missing guide id', async () => {
        const registry = new AgentToolRegistry();
        const tools = createMetaTools(registry, { promptGuides: [] });
        const guideGet = tools.find((t) => t.name === 'guide.get')!;

        const result = await guideGet.execute({ ids: 'nonexistent' });
        expect(result.success).toBe(false);
        expect(result.error).toBe('Guide not found: nonexistent');
      });

      it('returns error for first missing guide in batch', async () => {
        const registry = new AgentToolRegistry();
        const tools = createMetaTools(registry, {
          promptGuides: [{ id: 'guide-1', name: 'Guide One', content: 'alpha' }],
        });
        const guideGet = tools.find((t) => t.name === 'guide.get')!;

        const result = await guideGet.execute({ ids: ['guide-1', 'missing'] });
        expect(result.success).toBe(false);
        expect(result.error).toBe('Guide not found: missing');
      });
    });
  });
});
