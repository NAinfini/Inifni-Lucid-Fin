import type { IpcMain } from 'electron';
import type { Keychain } from '@lucid-fin/storage';
import type { AdapterRegistry, LLMRegistry } from '@lucid-fin/adapters-ai';

export function registerKeychainHandlers(
  ipcMain: IpcMain,
  keychain: Keychain,
  registry: AdapterRegistry,
  llmRegistry: LLMRegistry,
): void {
  ipcMain.handle('keychain:isConfigured', async (_e, args: { provider: string }) => {
    return keychain.isConfigured(args.provider);
  });

  ipcMain.handle('keychain:get', async (_e, args: { provider: string }) => {
    return keychain.getKey(args.provider);
  });

  ipcMain.handle('keychain:set', async (_e, args: { provider: string; apiKey: string }) => {
    await keychain.setKey(args.provider, args.apiKey);
    // Apply key to media adapter
    const mediaAdapter = registry.get(args.provider);
    if (mediaAdapter) mediaAdapter.configure(args.apiKey);
    // Apply key to LLM adapter
    const llmAdapter = llmRegistry.list().find((a) => a.id === args.provider);
    if (llmAdapter) llmAdapter.configure(args.apiKey);
  });

  ipcMain.handle('keychain:delete', async (_e, args: { provider: string }) => {
    await keychain.deleteKey(args.provider);
    const mediaAdapter = registry.get(args.provider);
    if (mediaAdapter) mediaAdapter.configure('');
    const llmAdapter = llmRegistry.list().find((a) => a.id === args.provider);
    if (llmAdapter) llmAdapter.configure('');
  });

  ipcMain.handle('keychain:test', async (_e, args: { provider: string; baseUrl?: string; model?: string }) => {
    const mediaAdapter = registry.get(args.provider);
    if (mediaAdapter) {
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
