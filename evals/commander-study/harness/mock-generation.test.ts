import { describe, expect, it } from 'vitest';
import { AgentToolRegistry } from '@lucid-fin/application';
import { installMockGeneration, MOCKED_TOOL_NAMES } from './mock-generation.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDummyTool(name: string) {
  return {
    name,
    description: `Original ${name}`,
    tier: 3 as const,
    parameters: { type: 'object' as const, properties: {} },
    execute: async () => ({ success: true, data: { original: true } }),
  };
}

function setupRegistry(): AgentToolRegistry {
  const registry = new AgentToolRegistry();
  for (const name of MOCKED_TOOL_NAMES) {
    registry.register(makeDummyTool(name));
  }
  return registry;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('installMockGeneration', () => {
  describe('MOCKED_TOOL_NAMES', () => {
    it('declares exactly 3 mocked tools', () => {
      expect(MOCKED_TOOL_NAMES).toHaveLength(3);
    });

    it('includes canvas.generation', () => {
      expect(MOCKED_TOOL_NAMES).toContain('canvas.generation');
    });

    it('includes entity.generateRefImage', () => {
      expect(MOCKED_TOOL_NAMES).toContain('entity.generateRefImage');
    });

    it('includes canvas.previewPrompt', () => {
      expect(MOCKED_TOOL_NAMES).toContain('canvas.previewPrompt');
    });
  });

  describe('registry override', () => {
    it('replaces all original tools in the registry', () => {
      const registry = setupRegistry();
      installMockGeneration(registry);
      for (const name of MOCKED_TOOL_NAMES) {
        const tool = registry.get(name);
        expect(tool).toBeDefined();
        expect(tool!.description).toContain('[MOCKED');
      }
    });

    it('does not add tools beyond the mocked names', () => {
      const registry = new AgentToolRegistry();
      registry.register(makeDummyTool('custom.tool'));
      installMockGeneration(registry);
      const names = registry.list().map((t) => t.name);
      expect(names).toContain('custom.tool');
      for (const name of MOCKED_TOOL_NAMES) {
        expect(names).toContain(name);
      }
    });
  });

  describe('mock stats tracking', () => {
    it('returns stats with empty call counts initially', () => {
      const registry = setupRegistry();
      const stats = installMockGeneration(registry);
      expect(stats.calls).toEqual({});
    });

    it('tracks call counts per tool name', async () => {
      const registry = setupRegistry();
      const stats = installMockGeneration(registry);

      const genTool = registry.get('canvas.generation')!;
      await genTool.execute({ nodeId: 'n-1' });
      await genTool.execute({ nodeId: 'n-2' });

      const entityTool = registry.get('entity.generateRefImage')!;
      await entityTool.execute({ type: 'character', id: 'char-1' });

      expect(stats.calls['canvas.generation']).toBe(2);
      expect(stats.calls['entity.generateRefImage']).toBe(1);
    });

    it('accumulates counts across multiple invocations', async () => {
      const registry = setupRegistry();
      const stats = installMockGeneration(registry);

      const tool = registry.get('entity.generateRefImage')!;
      for (let i = 0; i < 10; i++) {
        await tool.execute({ type: 'location', id: `loc-${i}` });
      }
      expect(stats.calls['entity.generateRefImage']).toBe(10);
    });
  });

  describe('canvas.generation mock', () => {
    it('returns success with jobId and status', async () => {
      const registry = setupRegistry();
      installMockGeneration(registry);

      const tool = registry.get('canvas.generation')!;
      const result = await tool.execute({ nodeId: 'test-node' });

      expect(result.success).toBe(true);
      expect(result.data).toHaveProperty('jobId');
      expect(result.data).toHaveProperty('nodeId', 'test-node');
      expect(result.data).toHaveProperty('status', 'queued');
      expect(result.data).toHaveProperty('message');
    });

    it('generates unique jobIds per call', async () => {
      const registry = setupRegistry();
      installMockGeneration(registry);

      const tool = registry.get('canvas.generation')!;
      const r1 = await tool.execute({ nodeId: 'n-1' });
      const r2 = await tool.execute({ nodeId: 'n-2' });

      expect((r1.data as Record<string, unknown>).jobId).not.toBe(
        (r2.data as Record<string, unknown>).jobId,
      );
    });

    it('defaults nodeId to "unknown" when not provided', async () => {
      const registry = setupRegistry();
      installMockGeneration(registry);

      const tool = registry.get('canvas.generation')!;
      const result = await tool.execute({});
      expect(result.data).toHaveProperty('nodeId', 'unknown');
    });
  });

  describe('entity.generateRefImage mock', () => {
    it('returns success with assetHash', async () => {
      const registry = setupRegistry();
      installMockGeneration(registry);

      const tool = registry.get('entity.generateRefImage')!;
      const result = await tool.execute({ type: 'character', id: 'char-1' });

      expect(result.success).toBe(true);
      expect(result.data).toHaveProperty('assetHash');
    });

    it('generates unique assetHash per call', async () => {
      const registry = setupRegistry();
      installMockGeneration(registry);

      const tool = registry.get('entity.generateRefImage')!;
      const r1 = await tool.execute({ type: 'character', id: 'x' });
      const r2 = await tool.execute({ type: 'character', id: 'x' });

      expect((r1.data as Record<string, unknown>).assetHash).not.toBe(
        (r2.data as Record<string, unknown>).assetHash,
      );
    });

    it('assetHash starts with sha256:mock', async () => {
      const registry = setupRegistry();
      installMockGeneration(registry);

      const tool = registry.get('entity.generateRefImage')!;
      const result = await tool.execute({ type: 'equipment', id: 'x' });
      const hash = (result.data as Record<string, unknown>).assetHash as string;
      expect(hash).toMatch(/^sha256:mock/);
    });
  });

  describe('canvas.previewPrompt mock', () => {
    it('returns success with preview data', async () => {
      const registry = setupRegistry();
      installMockGeneration(registry);

      const tool = registry.get('canvas.previewPrompt')!;
      const result = await tool.execute({ nodeId: 'node-42' });

      expect(result.success).toBe(true);
      expect(result.data).toHaveProperty('nodeId', 'node-42');
      expect(result.data).toHaveProperty('prompt');
      expect(result.data).toHaveProperty('providerId', 'mock');
      expect(result.data).toHaveProperty('mode', 'mock');
    });

    it('defaults nodeId to "unknown"', async () => {
      const registry = setupRegistry();
      installMockGeneration(registry);

      const tool = registry.get('canvas.previewPrompt')!;
      const result = await tool.execute({});
      expect(result.data).toHaveProperty('nodeId', 'unknown');
    });
  });
});
