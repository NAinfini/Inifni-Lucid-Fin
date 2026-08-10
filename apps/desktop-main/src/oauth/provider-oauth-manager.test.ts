import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { OAuthCapability, OAuthProviderStatus } from '@lucid-fin/contracts';
import { ProviderOAuthManager } from './provider-oauth-manager.js';

describe('ProviderOAuthManager', () => {
  it('isolates ChatGPT LLM, image, and fallback-vision accounts into separate homes', async () => {
    const homes = new Map<string, string>();
    const runtimes = new Map<string, object>();
    const factory = vi.fn((capability: Exclude<OAuthCapability, 'video'>, home: string) => {
      homes.set(capability, home);
      const target = { provider: 'chatgpt', capability } as const;
      const runtime = {
        start: vi.fn(async () => undefined),
        stop: vi.fn(async () => undefined),
        getStatus: vi.fn((): OAuthProviderStatus => ({ target, state: 'signedOut' })),
        login: vi.fn(),
        cancelLogin: vi.fn(),
        logout: vi.fn(),
        onStatusChanged: vi.fn(() => () => undefined),
      };
      runtimes.set(capability, runtime);
      return runtime as never;
    });
    const manager = new ProviderOAuthManager({
      userDataPath: path.join('C:', 'LucidFinTest'),
      keychain: {
        getKey: vi.fn(async () => null),
        setKey: vi.fn(async () => undefined),
        deleteKey: vi.fn(async () => false),
      } as never,
      google: { config: {} },
      codexRuntimeFactory: factory,
    });

    expect(new Set(homes.values()).size).toBe(3);
    expect(homes.get('llm')).toContain('capability-llm');
    expect(homes.get('image')).toContain('capability-image');
    expect(manager.getCodexRuntime('llm')).toBe(runtimes.get('llm'));
    expect(manager.getCodexRuntime('image')).toBe(runtimes.get('image'));
    await expect(
      manager.getStatus({ provider: 'chatgpt', capability: 'llm' }),
    ).resolves.toMatchObject({ target: { capability: 'llm' }, state: 'signedOut' });
    await manager.stop();
  });

  it('rejects unsupported ChatGPT video OAuth instead of falling back', async () => {
    const manager = new ProviderOAuthManager({
      userDataPath: path.join('C:', 'LucidFinTest'),
      keychain: {
        getKey: vi.fn(async () => null),
        setKey: vi.fn(async () => undefined),
        deleteKey: vi.fn(async () => false),
      } as never,
      google: { config: {} },
      codexRuntimeFactory: (() => ({ onStatusChanged: () => () => undefined })) as never,
    });

    await expect(manager.getStatus({ provider: 'chatgpt', capability: 'video' })).rejects.toThrow(
      'not supported',
    );
  });
});
