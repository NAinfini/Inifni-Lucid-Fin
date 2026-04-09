import { beforeEach, describe, expect, it, vi } from 'vitest';

const { buildRuntimeLLMAdapter } = vi.hoisted(() => ({
  buildRuntimeLLMAdapter: vi.fn(),
}));

vi.mock('@lucid-fin/adapters-ai', () => ({
  buildRuntimeLLMAdapter,
}));

import {
  createConfiguredLLMAdapter,
  getLLMProviderLogFields,
  hasLLMProviderConnectionFields,
  requiresLLMProviderApiKey,
  resolveLLMProviderRuntimeConfig,
} from './llm-provider-runtime.js';

describe('llm-provider-runtime helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('normalizes partial runtime config and exposes stable log fields', () => {
    const resolved = resolveLLMProviderRuntimeConfig({
      id: 'custom-provider',
      name: 'Custom Provider',
      baseUrl: 'https://example.com/v1',
      model: 'gpt-test',
      protocol: 'openai-compatible',
      authStyle: 'bearer',
    });

    expect(resolved).toMatchObject({
      id: 'custom-provider',
      name: 'Custom Provider',
      baseUrl: 'https://example.com/v1',
      model: 'gpt-test',
      protocol: 'openai-compatible',
      authStyle: 'bearer',
    });
    expect(getLLMProviderLogFields(resolved)).toEqual({
      providerId: 'custom-provider',
      providerName: 'Custom Provider',
      baseUrl: 'https://example.com/v1',
      model: 'gpt-test',
      protocol: 'openai-compatible',
      authStyle: 'bearer',
    });
    expect(getLLMProviderLogFields(null)).toEqual({});
  });

  it('reports connection-field and api-key requirements', () => {
    expect(
      hasLLMProviderConnectionFields({
        id: 'x',
        name: 'X',
        baseUrl: 'https://example.com',
        model: 'model-a',
        protocol: 'openai-compatible',
        authStyle: 'bearer',
      }),
    ).toBe(true);
    expect(
      hasLLMProviderConnectionFields({
        id: 'x',
        name: 'X',
        baseUrl: '',
        model: 'model-a',
        protocol: 'openai-compatible',
        authStyle: 'bearer',
      }),
    ).toBe(false);
    expect(
      requiresLLMProviderApiKey({
        id: 'none',
        name: 'None',
        baseUrl: 'https://example.com',
        model: 'model-a',
        protocol: 'openai-compatible',
        authStyle: 'none',
      }),
    ).toBe(false);
    expect(
      requiresLLMProviderApiKey({
        id: 'bearer',
        name: 'Bearer',
        baseUrl: 'https://example.com',
        model: 'model-a',
        protocol: 'openai-compatible',
        authStyle: 'bearer',
      }),
    ).toBe(true);
  });

  it('reuses a registered adapter when present and configures it with the runtime settings', () => {
    const configure = vi.fn();
    const adapter = { id: 'openai', configure } as never;
    const registry = { list: () => [adapter] };
    const config = {
      id: 'openai',
      name: 'OpenAI',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4.1',
      protocol: 'openai-compatible',
      authStyle: 'bearer',
    } as const;

    const result = createConfiguredLLMAdapter(registry, config, 'sk-live');

    expect(result).toBe(adapter);
    expect(buildRuntimeLLMAdapter).not.toHaveBeenCalled();
    expect(configure).toHaveBeenCalledWith('sk-live', {
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4.1',
    });
  });

  it('builds a runtime adapter when no registry adapter exists and configures empty keys safely', () => {
    const configure = vi.fn();
    const runtimeAdapter = { id: 'custom', configure };
    buildRuntimeLLMAdapter.mockReturnValue(runtimeAdapter);
    const registry = { list: () => [] };
    const config = {
      id: 'custom',
      name: 'Custom',
      baseUrl: 'https://example.com/v1',
      model: 'gpt-test',
      protocol: 'openai-compatible',
      authStyle: 'bearer',
    } as const;

    const result = createConfiguredLLMAdapter(registry, config, null);

    expect(buildRuntimeLLMAdapter).toHaveBeenCalledWith(config);
    expect(result).toBe(runtimeAdapter);
    expect(configure).toHaveBeenCalledWith('', {
      baseUrl: 'https://example.com/v1',
      model: 'gpt-test',
    });
  });
});
