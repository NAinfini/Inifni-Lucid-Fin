import { describe, it, expect, vi } from 'vitest';
import { AgentToolRegistry, type AgentTool } from './tool-registry.js';

describe('AgentToolRegistry', () => {
  it('registers and retrieves tools', () => {
    const registry = new AgentToolRegistry();
    const tool: AgentTool = {
      name: 'test.tool',
      description: 'A test tool',
      tier: 1,
      parameters: {
        type: 'object',
        properties: { input: { type: 'string', description: 'test' } },
        required: ['input'],
      },
      execute: vi.fn(async () => ({ success: true, data: 'done' })),
    };
    registry.register(tool);
    expect(registry.get('test.tool')).toBe(tool);
    expect(registry.list()).toHaveLength(1);
  });

  it('returns tools filtered by context', () => {
    const registry = new AgentToolRegistry();
    registry.register({
      name: 'script.convert',
      description: 'Convert novel to script',
      context: ['script-editor'],
      tier: 1,
      parameters: { type: 'object', properties: {}, required: [] },
      execute: vi.fn(),
    });
    registry.register({
      name: 'character.extract',
      description: 'Extract characters',
      context: ['script-editor', 'character-studio'],
      tier: 1,
      parameters: { type: 'object', properties: {}, required: [] },
      execute: vi.fn(),
    });
    registry.register({
      name: 'segment.update',
      description: 'Update segment',
      context: ['orchestrator'],
      tier: 1,
      parameters: { type: 'object', properties: {}, required: [] },
      execute: vi.fn(),
    });

    const scriptTools = registry.forContext('script-editor');
    expect(scriptTools).toHaveLength(2);

    const orchTools = registry.forContext('orchestrator');
    expect(orchTools).toHaveLength(1);

    const allTools = registry.list();
    expect(allTools).toHaveLength(3);
  });

  it('executes tool by name', async () => {
    const registry = new AgentToolRegistry();
    const mockExecute = vi.fn(async (args: Record<string, unknown>) => ({
      success: true,
      data: `processed ${args.input}`,
    }));
    registry.register({
      name: 'test.tool',
      description: 'test',
      tier: 1,
      parameters: { type: 'object', properties: {}, required: [] },
      execute: mockExecute,
    });

    const result = await registry.execute('test.tool', { input: 'hello' });
    expect(result.success).toBe(true);
    expect(result.data).toBe('processed hello');
    expect(mockExecute).toHaveBeenCalledWith({ input: 'hello' });
  });

  it('throws on unknown tool', async () => {
    const registry = new AgentToolRegistry();
    await expect(registry.execute('nonexistent', {})).rejects.toThrow('Unknown tool: nonexistent');
  });

  it('toLLMTools converts to LLM format', () => {
    const registry = new AgentToolRegistry();
    registry.register({
      name: 'test.tool',
      description: 'A test tool',
      tier: 1,
      parameters: {
        type: 'object',
        properties: { input: { type: 'string', description: 'test input' } },
        required: ['input'],
      },
      execute: vi.fn(),
    });

    const llmTools = registry.toLLMTools();
    expect(llmTools).toHaveLength(1);
    expect(llmTools[0].name).toBe('test.tool');
    expect(llmTools[0].description).toBe('A test tool');
    expect(llmTools[0].parameters.properties.input).toBeDefined();
  });

  it('toLLMTools filters by context', () => {
    const registry = new AgentToolRegistry();
    registry.register({
      name: 'a',
      description: 'a',
      context: ['page-a'],
      tier: 1,
      parameters: { type: 'object', properties: {}, required: [] },
      execute: vi.fn(),
    });
    registry.register({
      name: 'b',
      description: 'b',
      context: ['page-b'],
      tier: 1,
      parameters: { type: 'object', properties: {}, required: [] },
      execute: vi.fn(),
    });

    expect(registry.toLLMTools('page-a')).toHaveLength(1);
    expect(registry.toLLMTools('page-a')[0].name).toBe('a');
    expect(registry.toLLMTools()).toHaveLength(2);
  });

  it('searches tools by tag and query within a context', () => {
    const registry = new AgentToolRegistry();
    registry.register({
      name: 'canvas.listNodes',
      description: 'Search nodes on the canvas',
      tags: ['canvas', 'read', 'search'],
      context: ['canvas'],
      tier: 1,
      parameters: { type: 'object', properties: {}, required: [] },
      execute: vi.fn(),
    });
    registry.register({
      name: 'character.list',
      description: 'Search characters',
      tags: ['character', 'read', 'search'],
      tier: 1,
      parameters: { type: 'object', properties: {}, required: [] },
      execute: vi.fn(),
    });
    registry.register({
      name: 'canvas.deleteNode',
      description: 'Delete a node',
      tags: ['canvas', 'mutate'],
      context: ['canvas'],
      tier: 1,
      parameters: { type: 'object', properties: {}, required: [] },
      execute: vi.fn(),
    });

    expect(
      registry.search({
        context: 'canvas',
        tags: ['search'],
        query: 'node',
      }).map((tool) => tool.name),
    ).toEqual(['canvas.listNodes']);
  });
});
