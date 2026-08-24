import { describe, it, expect, vi } from 'vitest';
import {
  InvalidToolOutputError,
  NO_TOOL_RESOURCE,
  ToolRegistry as CanonicalToolRegistry,
  toolResultSchema,
  type ToolDefinition,
} from './tool-registry.js';
import { canonicalJsonSchema } from './tools/tool-runtime-schemas.js';

class ToolRegistry extends CanonicalToolRegistry {
  override register(tool: ToolDefinition): void {
    const candidate = tool as ToolDefinition & {
      parameters?: ToolDefinition['inputSchema'];
    };
    candidate.inputSchema ??= candidate.parameters ?? { type: 'object', properties: {} };
    candidate.outputSchema ??= toolResultSchema(canonicalJsonSchema, { dataOptional: true });
    super.register(candidate);
  }
}

describe('ToolRegistry', () => {
  it('requires canonical input and output schemas', () => {
    const legacy = {
      name: 'test.legacy',
      description: 'Legacy tool',
      process: 'test',
      category: 'query',
      contextReplay: 'status_only',
      resource: NO_TOOL_RESOURCE,
      tier: 1,
      parameters: { type: 'object', properties: {} },
      execute: vi.fn(async () => ({ success: true })),
    } as unknown as ToolDefinition;

    expect(() => new CanonicalToolRegistry().register(legacy)).toThrow(/input schema/i);
  });

  it('validates, clones, and deeply freezes canonical tool results', async () => {
    const raw = {
      success: true as const,
      data: { items: [{ status: 'ready', score: 1 }] },
    };
    const registry = new ToolRegistry();
    registry.register({
      name: 'test.canonical',
      description: 'Canonical tool',
      process: 'test',
      category: 'query',
      contextReplay: 'status_only',
      resource: NO_TOOL_RESOURCE,
      tier: 1,
      inputSchema: { type: 'object', properties: {} },
      outputSchema: {
        anyOf: [
          {
            type: 'object',
            properties: {
              success: { const: true },
              data: {
                type: 'object',
                properties: {
                  items: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        status: { type: 'string', enum: ['ready'] },
                        score: { type: 'number' },
                      },
                      required: ['status', 'score'],
                    },
                  },
                },
                required: ['items'],
              },
            },
            required: ['success', 'data'],
          },
          {
            type: 'object',
            properties: {
              success: { const: false },
              error: { type: 'string' },
            },
            required: ['success', 'error'],
          },
        ],
      },
      execute: vi.fn(async () => raw),
    } as unknown as ToolDefinition);

    const result = await registry.execute('test.canonical', {});
    expect(result).toEqual(raw);
    expect(result).not.toBe(raw);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.data)).toBe(true);
    expect(Object.isFrozen((result.data as { items: unknown[] }).items)).toBe(true);
    expect(Object.isFrozen((result.data as { items: object[] }).items[0])).toBe(true);

    const recanonicalized = registry.canonicalizeResult('test.canonical', result);
    expect(recanonicalized).toEqual(result);
    expect(recanonicalized).not.toBe(result);
    expect(Object.isFrozen(recanonicalized)).toBe(true);
    expect(Object.isFrozen(recanonicalized.data)).toBe(true);
  });

  it('validates direct registry inputs before calling the tool', async () => {
    const execute = vi.fn(async () => ({ success: true as const }));
    const registry = new ToolRegistry();
    registry.register({
      name: 'test.direct-input',
      description: 'Direct input tool',
      process: 'test',
      category: 'query',
      contextReplay: 'status_only',
      resource: NO_TOOL_RESOURCE,
      tier: 1,
      inputSchema: {
        type: 'object',
        properties: {
          options: {
            type: 'object',
            properties: { mode: { type: 'string', enum: ['safe'] } },
            required: ['mode'],
          },
        },
        required: ['options'],
      },
      outputSchema: {
        anyOf: [
          {
            type: 'object',
            properties: { success: { const: true } },
            required: ['success'],
          },
          {
            type: 'object',
            properties: { success: { const: false }, error: { type: 'string' } },
            required: ['success', 'error'],
          },
        ],
      },
      execute,
    } as unknown as ToolDefinition);

    await expect(
      registry.execute('test.direct-input', { options: { mode: 'unsafe' } }),
    ).rejects.toThrow(/invalid canonical arguments/i);
    expect(execute).not.toHaveBeenCalled();
  });

  it('rejects cyclic input and output values without recursing indefinitely', async () => {
    const cyclicInput: Record<string, unknown> = {};
    cyclicInput.child = cyclicInput;
    const cyclicOutput: Record<string, unknown> = {};
    cyclicOutput.child = cyclicOutput;
    const registry = new ToolRegistry();
    registry.register({
      name: 'test.cycle',
      description: 'Cycle tool',
      process: 'test',
      category: 'query',
      contextReplay: 'status_only',
      resource: NO_TOOL_RESOURCE,
      tier: 1,
      inputSchema: {
        type: 'object',
        properties: {
          child: {
            type: 'object',
            properties: { child: { type: 'object', properties: {} } },
          },
        },
      },
      outputSchema: {
        anyOf: [
          {
            type: 'object',
            properties: {
              success: { const: true },
              data: {
                type: 'object',
                properties: {
                  child: {
                    type: 'object',
                    properties: { child: { type: 'object', properties: {} } },
                  },
                },
              },
            },
            required: ['success', 'data'],
          },
          {
            type: 'object',
            properties: { success: { const: false }, error: { type: 'string' } },
            required: ['success', 'error'],
          },
        ],
      },
      execute: vi.fn(async () => ({ success: true, data: cyclicOutput })),
    } as unknown as ToolDefinition);

    await expect(registry.execute('test.cycle', { child: cyclicInput })).rejects.toThrow(/cyclic/i);
    await expect(registry.execute('test.cycle', { child: {} })).rejects.toThrow(/cyclic/i);
  });

  it('allows canonical JSON only in named dynamic input fields and preserves the provider schema', async () => {
    const execute = vi.fn(async () => ({ success: true as const }));
    const registry = new CanonicalToolRegistry();
    registry.register({
      name: 'test.dynamic-input',
      description: 'Dynamic input tool',
      process: 'test',
      category: 'query',
      contextReplay: 'status_only',
      resource: NO_TOOL_RESOURCE,
      tier: 1,
      inputSchema: {
        type: 'object',
        properties: {
          metadata: { type: 'object', properties: {}, additionalProperties: true },
        },
        required: ['metadata'],
      },
      outputSchema: toolResultSchema(undefined, { dataOptional: true }),
      execute,
    });

    const metadata = { nested: { values: [1, true, null, { label: 'ok' }] } };
    await expect(registry.execute('test.dynamic-input', { metadata })).resolves.toEqual({
      success: true,
    });
    expect(execute).toHaveBeenCalledOnce();
    expect(
      registry.toLLMTools()[0]?.parameters.properties.metadata,
    ).toMatchObject({ type: 'object', additionalProperties: true });

    for (const invalid of [
      undefined,
      Number.NaN,
      BigInt(1),
      Symbol('x'),
      () => undefined,
      new Date(),
    ]) {
      await expect(
        registry.execute('test.dynamic-input', { metadata: { invalid } }),
      ).rejects.toThrow(/invalid canonical arguments/i);
    }
    const accessorArray = [1];
    Object.defineProperty(accessorArray, '0', { enumerable: true, get: () => 1 });
    await expect(
      registry.execute('test.dynamic-input', { metadata: { accessorArray } }),
    ).rejects.toThrow(/invalid canonical arguments/i);
  });

  it('rejects contract-wide canonical JSON and cyclic schemas at registration', () => {
    const base = {
      name: 'test.open-contract',
      description: 'Open contract',
      process: 'test',
      category: 'query' as const,
      contextReplay: 'status_only' as const,
      resource: NO_TOOL_RESOURCE,
      tier: 1 as const,
      outputSchema: toolResultSchema(undefined, { dataOptional: true }),
      execute: vi.fn(async () => ({ success: true as const })),
    };
    expect(() =>
      new CanonicalToolRegistry().register({
        ...base,
        inputSchema: { type: 'object', properties: {}, additionalProperties: true },
      }),
    ).toThrow(/complete input contract/i);
    expect(() =>
      new CanonicalToolRegistry().register({
        ...base,
        inputSchema: { type: 'object', properties: {} },
        outputSchema: canonicalJsonSchema,
      }),
    ).toThrow(/complete output contract/i);
    expect(() =>
      new CanonicalToolRegistry().register({
        ...base,
        inputSchema: { type: 'object', properties: {} },
        outputSchema: {
          anyOf: [
            {
              type: 'object',
              properties: { success: { const: true } },
              required: ['success'],
              additionalProperties: true,
            },
            {
              type: 'object',
              properties: { success: { const: false }, error: { type: 'string' } },
              required: ['success', 'error'],
            },
          ],
        },
      }),
    ).toThrow(/complete output contract/i);

    const cyclic = { type: 'object', properties: {} } as {
      type: 'object';
      properties: Record<string, unknown>;
    };
    cyclic.properties.self = cyclic;
    expect(() =>
      new CanonicalToolRegistry().register({
        ...base,
        inputSchema: cyclic as ToolDefinition['inputSchema'],
      }),
    ).toThrow(/schema cycle/i);
  });

  it.each([
    ['unknown root field', { success: true, data: { status: 'ready' }, extra: true }],
    ['unknown nested field', { success: true, data: { status: 'ready', extra: true } }],
    ['invalid nested enum', { success: true, data: { status: 'invalid' } }],
    ['non-finite number', { success: true, data: { status: 'ready', score: Infinity } }],
    ['invalid array member', { success: true, data: { status: 'ready', tags: ['ok', 1] } }],
  ])('rejects an invalid successful result: %s', async (_label, result) => {
    const registry = new ToolRegistry();
    registry.register({
      name: 'test.invalid-output',
      description: 'Invalid output tool',
      process: 'test',
      category: 'query',
      contextReplay: 'status_only',
      resource: NO_TOOL_RESOURCE,
      tier: 1,
      inputSchema: { type: 'object', properties: {} },
      outputSchema: {
        anyOf: [
          {
            type: 'object',
            properties: {
              success: { const: true },
              data: {
                type: 'object',
                properties: {
                  status: { type: 'string', enum: ['ready'] },
                  score: { type: 'number' },
                  tags: { type: 'array', items: { type: 'string' } },
                },
                required: ['status'],
              },
            },
            required: ['success', 'data'],
          },
          {
            type: 'object',
            properties: {
              success: { const: false },
              error: { type: 'string' },
            },
            required: ['success', 'error'],
          },
        ],
      },
      execute: vi.fn(async () => result as never),
    } as unknown as ToolDefinition);

    await expect(registry.execute('test.invalid-output', {})).rejects.toBeInstanceOf(
      InvalidToolOutputError,
    );
  });

  it('registers and retrieves tools', () => {
    const registry = new ToolRegistry();
    const tool: ToolDefinition = {
      name: 'test.tool',
      description: 'A test tool',
      process: 'test',
      category: 'query',
      contextReplay: 'status_only',
      resource: NO_TOOL_RESOURCE,
      uiEffects: [{ kind: 'toast', message: 'done' }],
      tier: 1,
      inputSchema: {
        type: 'object',
        properties: { input: { type: 'string', description: 'test' } },
        required: ['input'],
      },
      outputSchema: toolResultSchema(canonicalJsonSchema, { dataOptional: true }),
      execute: vi.fn(async () => ({ success: true, data: 'done' })),
    };
    registry.register(tool);
    expect(registry.get('test.tool')).toBe(tool);
    expect(registry.list()).toHaveLength(1);
    expect(registry.forProcess('test')).toEqual([tool]);
    expect(registry.forCategory('query')).toEqual([tool]);
    expect(registry.uiEffectsFor('test.tool')).toEqual([{ kind: 'toast', message: 'done' }]);
  });

  it('returns tools filtered by context', () => {
    const registry = new ToolRegistry();
    registry.register({
      name: 'script.convert',
      description: 'Convert novel to script',
      process: 'test',
      category: 'query',
      contextReplay: 'status_only',
      resource: NO_TOOL_RESOURCE,
      contexts: ['script-editor'],
      tier: 1,
      parameters: {
        type: 'object',
        properties: { input: { type: 'string' } },
        required: ['input'],
      },
      execute: vi.fn(),
    });
    registry.register({
      name: 'character.extract',
      description: 'Extract characters',
      process: 'test',
      category: 'query',
      contextReplay: 'status_only',
      resource: NO_TOOL_RESOURCE,
      contexts: ['script-editor', 'character-studio'],
      tier: 1,
      parameters: {
        type: 'object',
        properties: { input: { type: 'string' } },
        required: ['input'],
      },
      execute: vi.fn(),
    });
    registry.register({
      name: 'segment.update',
      description: 'Update segment',
      process: 'test',
      category: 'query',
      contextReplay: 'status_only',
      resource: NO_TOOL_RESOURCE,
      contexts: ['orchestrator'],
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
    const registry = new ToolRegistry();
    const mockExecute = vi.fn(async (args: Record<string, unknown>) => ({
      success: true,
      data: `processed ${args.input}`,
    }));
    registry.register({
      name: 'test.tool',
      description: 'test',
      process: 'test',
      category: 'query',
      contextReplay: 'status_only',
      resource: NO_TOOL_RESOURCE,
      tier: 1,
      parameters: {
        type: 'object',
        properties: { input: { type: 'string' } },
        required: ['input'],
      },
      execute: mockExecute,
    });

    const result = await registry.execute('test.tool', { input: 'hello' });
    expect(result.success).toBe(true);
    expect(result.data).toBe('processed hello');
    expect(mockExecute).toHaveBeenCalledWith({ input: 'hello' });
  });

  it('throws on unknown tool', async () => {
    const registry = new ToolRegistry();
    await expect(registry.execute('nonexistent', {})).rejects.toThrow('Unknown tool: nonexistent');
  });

  it('toLLMTools converts to LLM format', () => {
    const registry = new ToolRegistry();
    registry.register({
      name: 'test.tool',
      description: 'A test tool',
      process: 'test',
      category: 'query',
      contextReplay: 'status_only',
      resource: NO_TOOL_RESOURCE,
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
    const registry = new ToolRegistry();
    registry.register({
      name: 'a',
      description: 'a',
      process: 'test',
      category: 'query',
      contextReplay: 'status_only',
      resource: NO_TOOL_RESOURCE,
      contexts: ['page-a'],
      tier: 1,
      parameters: { type: 'object', properties: {}, required: [] },
      execute: vi.fn(),
    });
    registry.register({
      name: 'b',
      description: 'b',
      process: 'test',
      category: 'query',
      contextReplay: 'status_only',
      resource: NO_TOOL_RESOURCE,
      contexts: ['page-b'],
      tier: 1,
      parameters: { type: 'object', properties: {}, required: [] },
      execute: vi.fn(),
    });

    expect(registry.toLLMTools('page-a')).toHaveLength(1);
    expect(registry.toLLMTools('page-a')[0].name).toBe('a');
    expect(registry.toLLMTools()).toHaveLength(2);
  });

  it('searches tools by tag and query within a context', () => {
    const registry = new ToolRegistry();
    registry.register({
      name: 'canvas.listNodes',
      description: 'Search nodes on the canvas',
      process: 'test',
      category: 'query',
      contextReplay: 'status_only',
      resource: NO_TOOL_RESOURCE,
      tags: ['canvas', 'read', 'search'],
      contexts: ['canvas'],
      tier: 1,
      parameters: { type: 'object', properties: {}, required: [] },
      execute: vi.fn(),
    });
    registry.register({
      name: 'character.list',
      description: 'Search characters',
      process: 'test',
      category: 'query',
      contextReplay: 'status_only',
      resource: NO_TOOL_RESOURCE,
      tags: ['character', 'read', 'search'],
      tier: 1,
      parameters: { type: 'object', properties: {}, required: [] },
      execute: vi.fn(),
    });
    registry.register({
      name: 'canvas.deleteNode',
      description: 'Delete a node',
      process: 'test',
      category: 'query',
      contextReplay: 'status_only',
      resource: NO_TOOL_RESOURCE,
      tags: ['canvas', 'mutate'],
      contexts: ['canvas'],
      tier: 1,
      parameters: { type: 'object', properties: {}, required: [] },
      execute: vi.fn(),
    });

    expect(
      registry
        .search({
          context: 'canvas',
          tags: ['search'],
          query: 'node',
        })
        .map((tool) => tool.name),
    ).toEqual(['canvas.listNodes']);
  });

  it('projects only canonical public call fields and fails closed for unknown tools', () => {
    const registry = new ToolRegistry();
    registry.register({
      name: 'canvas.inspect',
      description: 'Inspect a canvas\nPrivate implementation notes',
      process: 'test',
      category: 'query',
      contextReplay: 'status_only',
      resource: NO_TOOL_RESOURCE,
      tier: 1,
      parameters: {
        type: 'object',
        properties: {
          canvasId: { type: 'string', description: 'Canvas id' },
          mode: { type: 'string', description: 'View mode', enum: ['brief', 'full'] },
          prompt: { type: 'string', description: 'Private prompt' },
        },
      },
      execute: vi.fn(),
    });

    expect(
      registry.projectPublicCall('canvas.inspect', {
        canvasId: 'canvas-1',
        mode: 'brief',
        prompt: 'SECRET_SENTINEL',
      }),
    ).toEqual({
      summary: 'Inspect a canvas',
      details: { canvasId: 'canvas-1', mode: 'brief' },
    });
    expect(registry.projectPublicCall('unknown.tool', { secret: 'SECRET_SENTINEL' })).toEqual({});
  });

  it('does not expose raw results without an explicit public projector', () => {
    const registry = new ToolRegistry();
    registry.register({
      name: 'asset.inspect',
      description: 'Inspect an asset',
      process: 'test',
      category: 'query',
      contextReplay: 'status_only',
      resource: NO_TOOL_RESOURCE,
      tier: 1,
      parameters: { type: 'object', properties: {} },
      execute: vi.fn(),
    });
    registry.register({
      name: 'asset.create',
      description: 'Create an asset',
      process: 'test',
      category: 'mutation',
      contextReplay: 'status_only',
      resource: NO_TOOL_RESOURCE,
      tier: 2,
      parameters: { type: 'object', properties: {} },
      projectPublicResult: () => ({
        artifacts: [{ kind: 'asset', id: 'asset-1', mediaType: 'video' }],
      }),
      execute: vi.fn(),
    });

    expect(
      JSON.stringify(
        registry.projectPublicResult('asset.inspect', {}, {
          success: true,
          data: { secret: 'SECRET_SENTINEL' },
        }),
      ),
    ).not.toContain('SECRET_SENTINEL');
    expect(
      registry.projectPublicResult('asset.create', {}, { success: true, data: 'private' }),
    ).toMatchObject({ artifacts: [{ kind: 'asset', id: 'asset-1' }] });
  });

  it('requires canonical replay metadata and an explicit projector for replayable tools', () => {
    const base = {
      name: 'test.replay',
      description: 'Replay test',
      process: 'test',
      category: 'query',
      resource: NO_TOOL_RESOURCE,
      tier: 1,
      parameters: { type: 'object', properties: {} },
      execute: vi.fn(),
    };

    expect(() => new ToolRegistry().register(base as unknown as ToolDefinition)).toThrow(
      /context replay/i,
    );
    expect(() =>
      new ToolRegistry().register({
        ...base,
        contextReplay: 'authority_reread',
      } as unknown as ToolDefinition),
    ).toThrow(/projector/i);
    expect(() =>
      new ToolRegistry().register({
        ...base,
        contextReplay: 'raw_result',
      } as unknown as ToolDefinition),
    ).toThrow(/context replay/i);
  });

  it('rejects a definition without an explicit resource declaration', () => {
    const missingResource = {
      name: 'test.resource',
      description: 'Resource guard',
      process: 'test',
      category: 'query',
      contextReplay: 'status_only',
      tier: 1,
      parameters: { type: 'object' as const, properties: {} },
      execute: vi.fn(),
    } as unknown as ToolDefinition;

    expect(() => new ToolRegistry().register(missingResource)).toThrow(/resource declaration/i);
  });

  it('enforces replay-mode projection constraints and fails closed without raw fallback', () => {
    const registry = new ToolRegistry();
    registry.register({
      name: 'credential.set',
      description: 'Set a credential',
      process: 'test',
      category: 'mutation',
      contextReplay: 'status_only',
      resource: NO_TOOL_RESOURCE,
      tier: 4,
      parameters: { type: 'object', properties: {} },
      projectPublicResult: () => ({
        summary: 'must be discarded',
        context: {
          completeness: 'complete',
          facts: [{ kind: 'value', key: 'secret', value: 'SECRET_SENTINEL' }],
        },
      }),
      execute: vi.fn(),
    });
    registry.register({
      name: 'canvas.inspect',
      description: 'Inspect a canvas',
      process: 'test',
      category: 'query',
      contextReplay: 'authority_reread',
      resource: NO_TOOL_RESOURCE,
      tier: 1,
      parameters: { type: 'object', properties: {} },
      projectPublicResult: () => ({
        summary: 'must be discarded',
        context: { completeness: 'complete', facts: [] },
      }),
      execute: vi.fn(),
    });
    registry.register({
      name: 'analysis.inspect',
      description: 'Inspect analysis',
      process: 'test',
      category: 'query',
      contextReplay: 'public_facts',
      resource: NO_TOOL_RESOURCE,
      tier: 1,
      parameters: { type: 'object', properties: {} },
      projectPublicResult: () => {
        throw new Error('SECRET_SENTINEL');
      },
      execute: vi.fn(),
    });

    expect(
      registry.projectPublicResult('credential.set', {}, { success: true, data: 'raw' }),
    ).toEqual({ summary: 'Set a credential' });
    expect(
      registry.projectPublicResult('canvas.inspect', {}, {
        success: true,
        data: 'SECRET_SENTINEL',
      }),
    ).toEqual({
      summary: 'Inspect a canvas',
      context: { completeness: 'unavailable', facts: [] },
    });
    expect(
      registry.projectPublicResult('analysis.inspect', {}, {
        success: true,
        data: 'SECRET_SENTINEL',
      }),
    ).toEqual({
      summary: 'Inspect analysis',
      context: { completeness: 'unavailable', facts: [] },
    });
  });

  it('passes ToolExecutor-merged arguments to the public result projector', () => {
    const registry = new ToolRegistry();
    const projector = vi.fn((_: unknown, mergedArgs: Record<string, unknown>) => ({
      context: {
        completeness: 'complete' as const,
        facts: [
          {
            kind: 'authority_ref' as const,
            authority: 'canvas' as const,
            relation: 'read' as const,
            id: mergedArgs.canvasId as string,
          },
        ],
      },
    }));
    registry.register({
      name: 'canvas.inspectMerged',
      description: 'Inspect merged canvas context',
      process: 'test',
      category: 'query',
      contextReplay: 'authority_reread',
      resource: NO_TOOL_RESOURCE,
      tier: 1,
      parameters: { type: 'object', properties: {} },
      projectPublicResult: projector,
      execute: vi.fn(),
    });
    const mergedArgs = { canvasId: 'host-canvas-id' };
    const result = { success: true, data: { private: 'SECRET_SENTINEL' } };

    expect(registry.projectPublicResult('canvas.inspectMerged', mergedArgs, result)).toEqual({
      summary: 'Inspect merged canvas context',
      context: {
        completeness: 'complete',
        facts: [
          {
            kind: 'authority_ref',
            authority: 'canvas',
            relation: 'read',
            id: 'host-canvas-id',
          },
        ],
      },
    });
    expect(projector).toHaveBeenCalledWith(result, mergedArgs);
  });
});
