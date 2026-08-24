import { describe, expect, it } from 'vitest';
import type { ToolDefinition, ToolRegistry } from '@lucid-fin/application';
import { freezeRunCapabilityCatalog } from './commander-capability-catalog.js';

function registry(tools: ToolDefinition[]): ToolRegistry {
  return {
    list: () => tools,
    toLLMTools: () =>
      tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        parameters: tool.inputSchema,
      })),
  } as ToolRegistry;
}

const readTool = {
  name: 'canvas.get',
  description: 'Read a Canvas',
  process: 'canvas-structure',
  category: 'query' as const,
  contextReplay: 'public_facts' as const,
  resource: { kind: 'none' as const },
  tier: 1 as const,
  tags: ['read', 'canvas'],
  contexts: ['canvas'],
  inputSchema: {
    type: 'object' as const,
    properties: { canvasId: { type: 'string' as const, description: 'Canvas ID' } },
    required: ['canvasId'],
  },
  outputSchema: {
    type: 'object' as const,
    properties: { success: { const: true } },
    required: ['success'],
  },
  execute: async () => ({ success: true }),
};

const writeTool = {
  ...readTool,
  name: 'node.update',
  description: 'Update a node',
  process: 'canvas-node-editing',
  category: 'mutation' as const,
  tier: 2 as const,
};

describe('freezeRunCapabilityCatalog', () => {
  it('sorts public entries and produces the same digest regardless of registration order', () => {
    const left = freezeRunCapabilityCatalog(registry([writeTool, readTool]));
    const right = freezeRunCapabilityCatalog(registry([readTool, writeTool]));

    expect(left).toEqual(right);
    expect(left.tools.map((tool) => tool.name)).toEqual(['canvas.get', 'node.update']);
    expect(left.tools[0]).toMatchObject({ tags: ['canvas', 'read'], contexts: ['canvas'] });
    expect(left.catalogHash).toMatch(/^[a-f0-9]{64}$/);
    expect(left.tools[0].inputSchemaHash).toMatch(/^[a-f0-9]{64}$/);
    expect(left.tools[0].outputSchemaHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('changes the catalog digest when a tool input schema changes', () => {
    const original = freezeRunCapabilityCatalog(registry([readTool]));
    const changed = freezeRunCapabilityCatalog(
      registry([
        {
          ...readTool,
          inputSchema: {
            ...readTool.inputSchema,
            properties: {
              ...readTool.inputSchema.properties,
              includeNodes: { type: 'boolean', description: 'Include nodes' },
            },
          },
        },
      ]),
    );

    expect(changed.catalogHash).not.toBe(original.catalogHash);
  });

  it('freezes exactly the tool names exposed to the provider', () => {
    const tools = registry([writeTool, readTool]);
    const frozenNames = freezeRunCapabilityCatalog(tools).tools.map((tool) => tool.name);
    const providerNames = tools
      .toLLMTools()
      .map((tool) => tool.name)
      .sort();

    expect(frozenNames).toEqual(providerNames);
  });
});
