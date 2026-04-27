import type { IpcMain } from 'electron';
import type { LLMProviderRuntimeInput } from '@lucid-fin/contracts';
import type { Keychain } from '@lucid-fin/storage';
import type { AdapterRegistry, LLMRegistry } from '@lucid-fin/adapters-ai';
import log from '../../logger.js';
import {
  createConfiguredLLMAdapter,
  getLLMProviderLogFields,
  hasLLMProviderConnectionFields,
  requiresLLMProviderApiKey,
  resolveLLMProviderRuntimeConfig,
} from '../../llm-provider-runtime.js';

type KeychainTestArgs = {
  provider: string;
  group?: 'llm' | 'image' | 'video' | 'audio' | 'vision';
  providerConfig?: LLMProviderRuntimeInput;
  baseUrl?: string;
  model?: string;
};

export function registerKeychainHandlers(
  ipcMain: IpcMain,
  keychain: Keychain,
  registry: AdapterRegistry,
  llmRegistry: LLMRegistry,
): void {
  ipcMain.handle('keychain:isConfigured', async (_e, args: { provider: string }) => {
    return hasConfiguredKey(keychain, args.provider);
  });

  ipcMain.handle('keychain:get', async (_e, args: { provider: string }) => {
    return getStoredKey(keychain, args.provider);
  });

  ipcMain.handle('keychain:set', async (_e, args: { provider: string; apiKey: string }) => {
    await keychain.setKey(args.provider, args.apiKey);
    log.info('Provider API key stored', {
      category: 'provider',
      providerId: args.provider,
    });
    const mediaAdapter = resolveMediaAdapter(registry, args.provider);
    if (mediaAdapter) mediaAdapter.configure(args.apiKey);
    const llmAdapter = llmRegistry.list().find((a) => a.id === args.provider);
    if (llmAdapter) llmAdapter.configure(args.apiKey);
  });

  ipcMain.handle('keychain:delete', async (_e, args: { provider: string }) => {
    await keychain.deleteKey(args.provider);
    log.warn('Provider API key deleted', {
      category: 'provider',
      providerId: args.provider,
    });
    const mediaAdapter = resolveMediaAdapter(registry, args.provider);
    if (mediaAdapter) mediaAdapter.configure('');
    const llmAdapter = llmRegistry.list().find((a) => a.id === args.provider);
    if (llmAdapter) llmAdapter.configure('');
  });

  ipcMain.handle('keychain:test', async (_e, args: KeychainTestArgs) => {
    const runtimeConfig = resolveLLMProviderRuntimeConfig(
      args.providerConfig ?? {
        id: args.provider,
        baseUrl: args.baseUrl,
        model: args.model,
      },
    );

    log.info('Provider connection test started', {
      category: 'provider',
      providerId: args.provider,
      providerGroup: args.group,
      ...getLLMProviderLogFields(runtimeConfig),
    });

    const isLLMGroup = args.group === 'llm' || args.group === 'vision';
    const mediaAdapter = isLLMGroup ? undefined : resolveMediaAdapter(registry, args.provider);
    if (mediaAdapter) {
      const apiKey = await getStoredKey(keychain, args.provider);
      mediaAdapter.configure(apiKey ?? '', {
        baseUrl: runtimeConfig.baseUrl,
        model: runtimeConfig.model,
      });
      try {
        const valid = await mediaAdapter.validate();
        log[valid ? 'info' : 'warn']('Media provider connection test finished', {
          category: 'provider',
          providerId: args.provider,
          providerGroup: args.group,
          providerType: 'media',
          valid,
        });
        return valid
          ? { ok: true }
          : { ok: false, error: 'Provider validation returned false' };
      } catch (error) {
        log.error('Media provider connection test threw', {
          category: 'provider',
          providerId: args.provider,
          providerGroup: args.group,
          providerType: 'media',
          detail: error instanceof Error ? error.stack ?? error.message : String(error),
        });
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
    }

    if (args.group && !isLLMGroup) {
      log.warn('Provider connection test requested for unsupported direct media validation', {
        category: 'provider',
        providerId: args.provider,
        providerGroup: args.group,
        providerType: 'media',
        ...getLLMProviderLogFields(runtimeConfig),
      });
      return {
        ok: false,
        error: 'Direct connection test is not supported for this provider. Try a real generation request.',
      };
    }

    const llmAdapter = llmRegistry.list().find((adapter) => adapter.id === args.provider);
    if (llmAdapter) {
      const apiKey = await keychain.getKey(args.provider);
      llmAdapter.configure(apiKey ?? '', {
        baseUrl: runtimeConfig.baseUrl,
        model: runtimeConfig.model,
      });
      try {
        const valid = await llmAdapter.validate();
        log[valid ? 'info' : 'warn']('LLM provider connection test finished', {
          category: 'provider',
          providerId: args.provider,
          providerGroup: args.group,
          providerType: 'llm',
          ...getLLMProviderLogFields(runtimeConfig),
          valid,
        });
        return valid
          ? { ok: true }
          : { ok: false, error: 'Provider validation returned false' };
      } catch (error) {
        log.error('LLM provider connection test threw', {
          category: 'provider',
          providerId: args.provider,
          providerGroup: args.group,
          providerType: 'llm',
          ...getLLMProviderLogFields(runtimeConfig),
          detail: error instanceof Error ? error.stack ?? error.message : String(error),
        });
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
    }

    if (hasLLMProviderConnectionFields(runtimeConfig)) {
      try {
        const apiKey = await keychain.getKey(args.provider);
        if (!apiKey && requiresLLMProviderApiKey(runtimeConfig)) {
          log.warn('Custom provider connection test skipped because API key is missing', {
            category: 'provider',
            providerId: args.provider,
            providerGroup: args.group,
            providerType: 'custom-llm',
            ...getLLMProviderLogFields(runtimeConfig),
          });
          return { ok: false, error: 'No API key configured' };
        }
        const configuredAdapter = createConfiguredLLMAdapter(llmRegistry, runtimeConfig, apiKey);
        const ok = await configuredAdapter.validate();
        log[ok ? 'info' : 'warn']('Custom provider connection test finished', {
          category: 'provider',
          providerId: args.provider,
          providerGroup: args.group,
          providerType: 'custom-llm',
          ...getLLMProviderLogFields(runtimeConfig),
          ok,
        });
        return ok ? { ok: true } : { ok: false, error: 'Provider validation returned false' };
      } catch (error) {
        log.error('Custom provider connection test failed', {
          category: 'provider',
          providerId: args.provider,
          providerGroup: args.group,
          providerType: 'custom-llm',
          ...getLLMProviderLogFields(runtimeConfig),
          detail: error instanceof Error ? error.stack ?? error.message : String(error),
        });
        return { ok: false, error: error instanceof Error ? error.message : 'Connection failed' };
      }
    }
    log.warn('Provider connection test requested for unknown provider', {
      category: 'provider',
      providerId: args.provider,
      providerGroup: args.group,
      ...getLLMProviderLogFields(runtimeConfig),
    });
    return { ok: false, error: 'Unknown provider' };
  });
}

async function getStoredKey(keychain: Keychain, provider: string): Promise<string | null> {
  return (await keychain.getKey(provider)) ?? null;
}

async function hasConfiguredKey(keychain: Keychain, provider: string): Promise<boolean> {
  return (await getStoredKey(keychain, provider)) !== null;
}

function resolveMediaAdapter(registry: AdapterRegistry, provider: string) {
  return registry.get(provider);
}
