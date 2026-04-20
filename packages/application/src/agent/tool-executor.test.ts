import { describe, expect, it } from 'vitest';
import { needsConfirmation } from './tool-executor.js';
import { AgentToolRegistry, type AgentTool } from './tool-registry.js';

/**
 * Pins down the permission-confirmation matrix. Twelve cases:
 * four tiers × three modes. These are the only contract the UI / IPC /
 * user-facing confirm prompts rely on — drifting this table without
 * updating the in-repo docstring is a silent UX regression.
 */
describe('needsConfirmation matrix', () => {
  const cases: Array<{ tier: 1 | 2 | 3 | 4; mode: string; expect: boolean }> = [
    // auto — only tier 4 asks (expensive/irreversible)
    { tier: 1, mode: 'auto',   expect: false },
    { tier: 2, mode: 'auto',   expect: false },
    { tier: 3, mode: 'auto',   expect: false },
    { tier: 4, mode: 'auto',   expect: true  },
    // normal — tiers 3 and 4 ask
    { tier: 1, mode: 'normal', expect: false },
    { tier: 2, mode: 'normal', expect: false },
    { tier: 3, mode: 'normal', expect: true  },
    { tier: 4, mode: 'normal', expect: true  },
    // strict — every tier asks
    { tier: 1, mode: 'strict', expect: true  },
    { tier: 2, mode: 'strict', expect: true  },
    { tier: 3, mode: 'strict', expect: true  },
    { tier: 4, mode: 'strict', expect: true  },
  ];

  for (const c of cases) {
    it(`tier ${c.tier} × ${c.mode} → ${c.expect ? 'ASK' : 'skip'}`, () => {
      expect(needsConfirmation(c.tier, c.mode)).toBe(c.expect);
    });
  }
});

describe('AgentToolRegistry.register tier guard', () => {
  function makeTool(overrides: Partial<AgentTool> = {}): AgentTool {
    return {
      name: 'test.dummy',
      description: 'test',
      tier: 1,
      parameters: { type: 'object', properties: {}, required: [] },
      execute: async () => ({ success: true }),
      ...overrides,
    };
  }

  it('accepts a tool with a valid tier', () => {
    const registry = new AgentToolRegistry();
    expect(() => registry.register(makeTool({ tier: 3 }))).not.toThrow();
    expect(registry.get('test.dummy')).toBeDefined();
  });

  it('throws when tier is missing (undefined via as-cast escape)', () => {
    const registry = new AgentToolRegistry();
    const broken = { ...makeTool(), tier: undefined } as unknown as AgentTool;
    expect(() => registry.register(broken)).toThrow(/tier/);
  });

  it('throws when tier is out of range', () => {
    const registry = new AgentToolRegistry();
    const broken = { ...makeTool(), tier: 5 } as unknown as AgentTool;
    expect(() => registry.register(broken)).toThrow(/tier/);
  });

  it('throws when tier is a non-integer sneaked in', () => {
    const registry = new AgentToolRegistry();
    const broken = { ...makeTool(), tier: 'high' } as unknown as AgentTool;
    expect(() => registry.register(broken)).toThrow(/tier/);
  });
});
