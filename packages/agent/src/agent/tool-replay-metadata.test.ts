import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { ToolRegistry } from './tool-registry.js';
import { createProviderTools, type ProviderToolDeps } from './tools/provider-tools.js';

const TOOL_FACTORY_FILES = [
  'asset-tools.ts',
  'canvas-core-tools.ts',
  'canvas-generation-tools.ts',
  'canvas-meta-tools.ts',
  'canvas-preset-tools.ts',
  'character-tools.ts',
  'color-style-tools.ts',
  'entity-tools.ts',
  'equipment-tools.ts',
  'location-tools.ts',
  'meta-tools.ts',
  'preset-tools.ts',
  'prompt-tools.ts',
  'provider-tools.ts',
  'run-checklist-tools.ts',
  'script-tools.ts',
  'snapshot-tools.ts',
  'task-list-tools.ts',
  'text-analyze-tools.ts',
] as const;

function createProviderDeps(): ProviderToolDeps {
  return {
    listProviders: vi.fn(async () => []),
    getActiveProvider: vi.fn(async () => null),
    setActiveProvider: vi.fn(async () => undefined),
    setProviderBaseUrl: vi.fn(async () => undefined),
    setProviderModel: vi.fn(async () => undefined),
    setProviderName: vi.fn(async () => undefined),
    addCustomProvider: vi.fn(async () => undefined),
    removeCustomProvider: vi.fn(async () => undefined),
    setProviderApiKey: vi.fn(async () => undefined),
  };
}

describe('canonical tool replay metadata', () => {
  it('classifies all 78 definitions in all 19 concrete tool factories explicitly', () => {
    let definitions = 0;
    let classifications = 0;
    let resources = 0;
    let metered = 0;
    let replayable = 0;
    let projectors = 0;

    for (const file of TOOL_FACTORY_FILES) {
      const source = readFileSync(new URL(`./tools/${file}`, import.meta.url), 'utf8');
      const fileDefinitions = source.match(/ToolDefinition\s*=\s*\{/g)?.length ?? 0;
      const fileClassifications =
        source.match(/contextReplay:\s*'(?:status_only|authority_reread|public_facts)'/g)
          ?.length ?? 0;
      const fileResources =
        source.match(
          /resource:\s*(?:NO_TOOL_RESOURCE|meteredToolResource\(|UNBOUNDED_METERED_TOOL_RESOURCE)/g,
        )?.length ?? 0;
      const fileMetered =
        source.match(/resource:\s*(?:meteredToolResource\(|UNBOUNDED_METERED_TOOL_RESOURCE)/g)
          ?.length ?? 0;
      replayable +=
        source.match(/contextReplay:\s*'(?:authority_reread|public_facts)'/g)?.length ?? 0;
      projectors += source.match(/projectPublicResult:/g)?.length ?? 0;
      expect(fileClassifications, file).toBe(fileDefinitions);
      expect(fileResources, file).toBe(fileDefinitions);
      definitions += fileDefinitions;
      classifications += fileClassifications;
      resources += fileResources;
      metered += fileMetered;
    }

    expect(definitions).toBe(78);
    expect(classifications).toBe(78);
    expect(resources).toBe(78);
    expect(metered).toBe(6);
    expect(projectors).toBe(replayable);
  });

  it('never projects credential arguments or results as replay facts', () => {
    const registry = new ToolRegistry();
    for (const tool of createProviderTools(createProviderDeps())) registry.register(tool);
    const credential = registry.get('provider.setKey');
    expect(credential?.contextReplay).toBe('status_only');

    const projection = registry.projectPublicResult(
      'provider.setKey',
      { providerId: 'provider-1', apiKey: 'SECRET_ARGUMENT' },
      { success: true, data: { apiKey: 'SECRET_RESULT' } },
    );
    expect(projection.context).toBeUndefined();
    expect(JSON.stringify(projection)).not.toContain('SECRET');
  });
});
