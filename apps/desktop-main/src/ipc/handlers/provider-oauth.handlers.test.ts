import type { IpcMain } from 'electron';
import type { OAuthProviderStatus, OAuthProviderTarget } from '@lucid-fin/contracts';
import { describe, expect, it, vi } from 'vitest';

const openExternal = vi.hoisted(() => vi.fn(async () => undefined));
const registerInvoke = vi.hoisted(() => vi.fn());
const registerPush = vi.hoisted(() => vi.fn(() => vi.fn()));

vi.mock('electron', () => ({
  default: { shell: { openExternal } },
  shell: { openExternal },
}));

vi.mock('../../features/ipc/registrar.js', () => ({
  registerInvoke,
  registerPush,
}));

import {
  registerProviderOAuthHandlers,
  validateProviderOAuthUrl,
} from './provider-oauth.handlers.js';

describe('validateProviderOAuthUrl', () => {
  it.each([
    ['https://auth.openai.com/oauth/authorize?client_id=test', 'chatgpt'],
    ['https://chatgpt.com/auth/callback', 'chatgpt'],
    ['https://accounts.google.com/o/oauth2/v2/auth', 'gemini'],
  ] as const)('accepts a trusted HTTPS URL for %s', (url, provider) => {
    expect(validateProviderOAuthUrl(url, { provider, capability: 'llm' })).toBe(url);
  });

  it.each([
    ['http://auth.openai.com/oauth/authorize', 'chatgpt'],
    ['https://openai.com.attacker.example/oauth', 'chatgpt'],
    ['https://accounts.google.com.attacker.example/oauth', 'gemini'],
    ['javascript:alert(1)', 'gemini'],
  ] as const)('rejects an untrusted URL for %s', (url, provider) => {
    expect(() => validateProviderOAuthUrl(url, { provider, capability: 'llm' })).toThrow();
  });

  it('returns the latest scoped status after the browser is opened', async () => {
    const target: OAuthProviderTarget = { provider: 'chatgpt', capability: 'image' };
    const signingIn: OAuthProviderStatus = { target, state: 'signingIn' };
    const ready: OAuthProviderStatus = {
      target,
      state: 'ready',
      planType: 'plus',
      usage: { state: 'unavailable', reason: 'No current limits' },
    };
    let currentStatus = signingIn;
    openExternal.mockImplementationOnce(async () => {
      currentStatus = ready;
    });
    const manager = {
      login: vi.fn(async () => ({
        authUrl: 'https://auth.openai.com/oauth/authorize?client_id=test',
        status: signingIn,
      })),
      getStatus: vi.fn(async () => currentStatus),
      cancelLogin: vi.fn(async () => signingIn),
      logout: vi.fn(async () => signingIn),
      onStatusChanged: vi.fn(() => () => undefined),
    };

    registerProviderOAuthHandlers({} as IpcMain, () => null, manager as never);
    const loginRegistration = registerInvoke.mock.calls.find(
      ([, channel]) => channel.channel === 'providerOAuth:login',
    );
    expect(loginRegistration).toBeDefined();
    const handler = loginRegistration?.[2] as (
      context: unknown,
      request: { target: OAuthProviderTarget },
    ) => Promise<OAuthProviderStatus>;

    await expect(handler({}, { target })).resolves.toEqual(ready);
    expect(openExternal).toHaveBeenCalledWith(
      'https://auth.openai.com/oauth/authorize?client_id=test',
    );
  });
});
