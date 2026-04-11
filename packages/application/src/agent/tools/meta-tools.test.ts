import { describe, expect, it, vi } from 'vitest';
import { AgentToolRegistry } from '../tool-registry.js';
import { createMetaTools } from './meta-tools.js';

describe('createMetaTools', () => {
  it('searches the tool registry by tags and query', async () => {
    const registry = new AgentToolRegistry();
    registry.register({
      name: 'canvas.searchNodes',
      description: 'Search nodes on the current canvas',
      tags: ['canvas', 'read', 'search'],
      parameters: { type: 'object', properties: {}, required: [] },
      execute: vi.fn(),
    });
    registry.register({
      name: 'canvas.deleteNode',
      description: 'Delete a node from the current canvas',
      tags: ['canvas', 'mutate'],
      parameters: { type: 'object', properties: {}, required: [] },
      execute: vi.fn(),
    });

    const tools = createMetaTools(registry, {
      promptGuides: [],
      context: 'canvas',
    });
    const searchTool = tools.find((tool) => tool.name === 'tool.search');
    if (!searchTool) {
      throw new Error('Missing tool.search');
    }

    const result = await searchTool.execute({
      tags: ['search'],
      query: 'node',
    });

    expect(result).toEqual({
      success: true,
      data: {
        total: 1,
        offset: 0,
        limit: 50,
        tools: [
          {
            name: 'canvas.searchNodes',
            description: 'Search nodes on the current canvas',
            parameters: { type: 'object', properties: {}, required: [] },
            tags: ['canvas', 'read', 'search'],
          },
        ],
      },
    });
  });

  it('lists and fetches prompt guides lazily', async () => {
    const registry = new AgentToolRegistry();
    const tools = createMetaTools(registry, {
      promptGuides: [
        { id: 'guide-1', name: 'Guide One', content: 'alpha' },
        { id: 'guide-2', name: 'Guide Two', content: 'beta' },
      ],
      context: 'canvas',
    });

    const listTool = tools.find((tool) => tool.name === 'guide.list');
    const getTool = tools.find((tool) => tool.name === 'guide.get');
    if (!listTool || !getTool) {
      throw new Error('Missing guide tools');
    }

    await expect(listTool.execute({})).resolves.toEqual({
      success: true,
      data: {
        total: 2,
        offset: 0,
        limit: 50,
        guides: [
          { id: 'guide-1', name: 'Guide One' },
          { id: 'guide-2', name: 'Guide Two' },
        ],
      },
    });
    await expect(getTool.execute({ id: 'guide-2' })).resolves.toEqual({
      success: true,
      data: {
        id: 'guide-2',
        name: 'Guide Two',
        content: 'beta',
      },
    });
  });
});
