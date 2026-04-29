import { describe, expect, it, vi } from 'vitest';
import { createProviderTools, type ProviderToolDeps } from './provider-tools.js';

function createDeps(): ProviderToolDeps {
  return {
    listProviders: vi.fn(async () => [
      {
        id: 'provider-1',
        name: 'Provider One',
        baseUrl: 'https://api.example.com',
        model: 'model-1',
        isCustom: false,
        hasKey: true,
      },
      {
        id: 'provider-2',
        name: 'Provider Two',
        baseUrl: 'https://api.example2.com',
        model: 'model-2',
        isCustom: true,
        hasKey: false,
      },
    ]),
    getActiveProvider: vi.fn(async () => 'provider-1'),
    setActiveProvider: vi.fn(async () => undefined),
    setProviderBaseUrl: vi.fn(async () => undefined),
    setProviderModel: vi.fn(async () => undefined),
    setProviderName: vi.fn(async () => undefined),
    addCustomProvider: vi.fn(async () => undefined),
    removeCustomProvider: vi.fn(async () => undefined),
    setProviderApiKey: vi.fn(async () => undefined),
  };
}

function getTool(name: string, deps: ProviderToolDeps) {
  const tool = createProviderTools(deps).find((entry) => entry.name === name);
  if (!tool) throw new Error(`Missing tool: ${name}`);
  return tool;
}

describe('createProviderTools', () => {
  it('defines the provider tool suite', () => {
    const deps = createDeps();

    expect(createProviderTools(deps).map((tool) => tool.name)).toEqual([
      'provider.list',
      'provider.getActive',
      'provider.setActive',
      'provider.update',
      'provider.setKey',
      'provider.addCustom',
      'provider.removeCustom',
      'provider.getCapabilities',
    ]);
  });

  it('lists providers and delegates provider mutations', async () => {
    const deps = createDeps();

    await expect(
      getTool('provider.list', deps).execute({
        group: 'llm',
        offset: 1,
        limit: 1,
      }),
    ).resolves.toEqual({
      success: true,
      data: {
        total: 2,
        offset: 1,
        limit: 1,
        providers: [
          expect.objectContaining({
            id: 'provider-2',
            name: 'Provider Two',
          }),
        ],
      },
    });
    expect(deps.listProviders).toHaveBeenCalledWith('llm');

    await expect(getTool('provider.getActive', deps).execute({ group: 'llm' })).resolves.toEqual({
      success: true,
      data: { activeProvider: 'provider-1' },
    });
    await expect(
      getTool('provider.setActive', deps).execute({
        group: 'llm',
        providerId: 'provider-2',
      }),
    ).resolves.toEqual({
      success: true,
      data: { activated: 'provider-2' },
    });
    await expect(
      getTool('provider.update', deps).execute({
        group: 'llm',
        providerId: 'provider-2',
        set: { baseUrl: 'https://override.example.com' },
      }),
    ).resolves.toEqual({
      success: true,
      data: { providerId: 'provider-2', baseUrl: 'https://override.example.com' },
    });
    await expect(
      getTool('provider.update', deps).execute({
        group: 'llm',
        providerId: 'provider-2',
        set: { model: 'model-3' },
      }),
    ).resolves.toEqual({
      success: true,
      data: { providerId: 'provider-2', model: 'model-3' },
    });
    await expect(
      getTool('provider.update', deps).execute({
        group: 'llm',
        providerId: 'provider-2',
        set: { name: 'Renamed' },
      }),
    ).resolves.toEqual({
      success: true,
      data: { providerId: 'provider-2', name: 'Renamed' },
    });
    await expect(
      getTool('provider.update', deps).execute({
        group: 'llm',
        providerId: 'provider-2',
        set: { baseUrl: 'https://override.example.com', model: 'model-3', name: 'Renamed' },
      }),
    ).resolves.toEqual({
      success: true,
      data: {
        providerId: 'provider-2',
        baseUrl: 'https://override.example.com',
        model: 'model-3',
        name: 'Renamed',
      },
    });
    await expect(
      getTool('provider.removeCustom', deps).execute({
        group: 'llm',
        providerId: 'provider-2',
      }),
    ).resolves.toEqual({
      success: true,
      data: { removed: 'provider-2' },
    });
  });

  it('provider.update rejects when set is empty', async () => {
    const deps = createDeps();

    await expect(
      getTool('provider.update', deps).execute({
        group: 'llm',
        providerId: 'provider-1',
        set: {},
      }),
    ).resolves.toEqual({
      success: false,
      error: '"set" must contain at least one field to update',
    });
  });

  it('provider.setKey stores API key via dep', async () => {
    const deps = createDeps();

    await expect(
      getTool('provider.setKey', deps).execute({
        providerId: ' openai ',
        apiKey: ' sk-test ',
      }),
    ).resolves.toEqual({
      success: true,
      data: { providerId: 'openai', message: 'API key set for openai' },
    });
    expect(deps.setProviderApiKey).toHaveBeenCalledWith('openai', 'sk-test');
  });

  it('provider.setKey returns error when dep is unavailable', async () => {
    const deps = createDeps();
    deps.setProviderApiKey = undefined;

    await expect(
      getTool('provider.setKey', deps).execute({
        providerId: 'openai',
        apiKey: 'sk-test',
      }),
    ).resolves.toEqual({
      success: false,
      error: 'API key management not available',
    });
  });

  it('provider.setKey validates required fields', async () => {
    const deps = createDeps();

    await expect(
      getTool('provider.setKey', deps).execute({
        providerId: '',
        apiKey: 'sk-test',
      }),
    ).resolves.toEqual({
      success: false,
      error: 'providerId is required',
    });
    await expect(
      getTool('provider.setKey', deps).execute({
        providerId: 'openai',
        apiKey: '',
      }),
    ).resolves.toEqual({
      success: false,
      error: 'apiKey is required',
    });
  });

  it('creates custom provider and returns capability results', async () => {
    const deps = createDeps();
    vi.spyOn(Date, 'now').mockReturnValue(12345);

    await expect(
      getTool('provider.addCustom', deps).execute({
        group: 'llm',
        name: 'Custom LLM',
        baseUrl: 'https://custom.example.com',
        model: 'custom-model',
      }),
    ).resolves.toEqual({
      success: true,
      data: {
        id: 'custom-llm-12345',
        name: 'Custom LLM',
        baseUrl: 'https://custom.example.com',
        model: 'custom-model',
      },
    });
    expect(deps.addCustomProvider).toHaveBeenCalledWith(
      'llm',
      'custom-llm-12345',
      'Custom LLM',
      'https://custom.example.com',
      'custom-model',
    );

    await expect(
      getTool('provider.getCapabilities', deps).execute({ providerId: 'kling-v1' }),
    ).resolves.toEqual({
      success: true,
      data: expect.objectContaining({
        providerId: 'kling-v1',
        known: true,
      }),
    });
    await expect(
      getTool('provider.getCapabilities', deps).execute({ providerId: 'unknown-provider' }),
    ).resolves.toEqual({
      success: true,
      data: {
        providerId: 'unknown-provider',
        known: false,
        message: 'No built-in capability data for "unknown-provider". Use default settings.',
      },
    });
  });

  it('wraps dependency failures', async () => {
    const deps = createDeps();
    vi.mocked(deps.setActiveProvider).mockRejectedValueOnce(new Error('activate failed'));

    await expect(
      getTool('provider.setActive', deps).execute({
        group: 'llm',
        providerId: 'provider-2',
      }),
    ).resolves.toEqual({
      success: false,
      error: 'activate failed',
    });
  });
});
