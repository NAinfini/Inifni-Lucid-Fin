import type { IpcMain } from 'electron';
import type { Keychain } from '@lucid-fin/storage';
import type { AdapterRegistry, LLMRegistry } from '@lucid-fin/adapters-ai';
import { resolveMediaProviderIds } from '../../bootstrap/init-app.js';

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
    const mediaAdapter = resolveMediaAdapter(registry, args.provider);
    if (mediaAdapter) mediaAdapter.configure(args.apiKey);
    const llmAdapter = llmRegistry.list().find((a) => a.id === args.provider);
    if (llmAdapter) llmAdapter.configure(args.apiKey);
  });

  ipcMain.handle('keychain:delete', async (_e, args: { provider: string }) => {
    await Promise.all(
      resolveMediaProviderIds(args.provider).map((providerId) => keychain.deleteKey(providerId)),
    );
    const mediaAdapter = resolveMediaAdapter(registry, args.provider);
    if (mediaAdapter) mediaAdapter.configure('');
    const llmAdapter = llmRegistry.list().find((a) => a.id === args.provider);
    if (llmAdapter) llmAdapter.configure('');
  });

  ipcMain.handle('keychain:test', async (_e, args: { provider: string; baseUrl?: string; model?: string }) => {
    const mediaAdapter = resolveMediaAdapter(registry, args.provider);
    if (mediaAdapter) {
      const apiKey = await getStoredKey(keychain, args.provider);
      if (apiKey) {
        mediaAdapter.configure(apiKey);
      }
      const valid = await mediaAdapter.validate();
      return { ok: valid };
    }
    const llmAdapter = llmRegistry.list().find((a) => a.id === args.provider);
    if (llmAdapter) {
      const valid = await llmAdapter.validate();
      return { ok: valid };
    }
    // Custom provider: try OpenAI-compatible chat/completions endpoint
    if (args.baseUrl) {
      try {
        const apiKey = await keychain.getKey(args.provider);
        if (!apiKey) return { ok: false, error: 'No API key configured' };
        const url = `${args.baseUrl.replace(/\/+$/, '')}/chat/completions`;
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model: args.model || 'gpt-3.5-turbo',
            messages: [{ role: 'user', content: 'hi' }],
            max_tokens: 1,
          }),
          signal: AbortSignal.timeout(10_000),
        });
        return { ok: res.status !== 401 && res.status !== 403 };
      } catch {
        return { ok: false, error: 'Connection failed' };
      }
    }
    return { ok: false, error: 'Unknown provider' };
  });
}

async function getStoredKey(keychain: Keychain, provider: string): Promise<string | null> {
  for (const providerId of resolveMediaProviderIds(provider)) {
    const key = await keychain.getKey(providerId);
    if (key) {
      return key;
    }
  }
  return null;
}

async function hasConfiguredKey(keychain: Keychain, provider: string): Promise<boolean> {
  return (await getStoredKey(keychain, provider)) !== null;
}

function resolveMediaAdapter(registry: AdapterRegistry, provider: string) {
  for (const providerId of resolveMediaProviderIds(provider)) {
    const adapter = registry.get(providerId);
    if (adapter) {
      return adapter;
    }
  }
  return undefined;
}
