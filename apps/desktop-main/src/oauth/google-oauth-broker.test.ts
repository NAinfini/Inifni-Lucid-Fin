import { afterEach, describe, expect, it, vi } from 'vitest';
import { GoogleOAuthBroker } from './google-oauth-broker.js';

const brokers: GoogleOAuthBroker[] = [];

afterEach(async () => {
  await Promise.all(brokers.splice(0).map((broker) => broker.dispose()));
});

function memoryKeychain() {
  const values = new Map<string, string>();
  return {
    values,
    getKey: vi.fn(async (account: string) => values.get(account) ?? null),
    setKey: vi.fn(async (account: string, value: string) => {
      values.set(account, value);
    }),
    deleteKey: vi.fn(async (account: string) => values.delete(account)),
  };
}

describe('GoogleOAuthBroker', () => {
  it('fails closed when the application OAuth client is not configured', async () => {
    const keychain = memoryKeychain();
    const broker = new GoogleOAuthBroker({ keychain, config: {} });
    brokers.push(broker);

    await expect(broker.getStatus('llm')).resolves.toMatchObject({
      target: { provider: 'gemini', capability: 'llm' },
      state: 'unavailable',
    });
    await expect(broker.login('llm')).rejects.toThrow('not configured');
    expect(keychain.getKey).not.toHaveBeenCalled();
  });

  it('uses PKCE loopback login and keeps capability credentials independent', async () => {
    const keychain = memoryKeychain();
    const providerFetch = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes('/token')) {
        return new Response(
          JSON.stringify({
            access_token: 'access-secret',
            refresh_token: 'refresh-secret',
            expires_in: 3600,
            scope: 'https://www.googleapis.com/auth/generative-language.retriever',
            token_type: 'Bearer',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return new Response(null, { status: 200 });
    });
    const broker = new GoogleOAuthBroker({
      keychain,
      config: {
        clientId: 'desktop-client-id',
        clientSecret: 'desktop-client-secret',
        cloudProject: 'quota-project',
      },
      fetchImpl: providerFetch as typeof fetch,
    });
    brokers.push(broker);

    const { authUrl } = await broker.login('llm');
    const authorization = new URL(authUrl);
    expect(authorization.hostname).toBe('accounts.google.com');
    expect(authorization.searchParams.get('code_challenge_method')).toBe('S256');
    expect(authorization.searchParams.get('code_challenge')).toBeTruthy();
    const callbackUrl = new URL(authorization.searchParams.get('redirect_uri')!);
    callbackUrl.searchParams.set('state', authorization.searchParams.get('state')!);
    callbackUrl.searchParams.set('code', 'authorization-code');
    const callback = await fetch(callbackUrl);
    expect(callback.status).toBe(200);

    await expect(broker.getStatus('llm')).resolves.toMatchObject({
      target: { provider: 'gemini', capability: 'llm' },
      state: 'ready',
      usage: {
        state: 'unavailable',
        dashboardUrl: expect.stringContaining('generativelanguage.googleapis.com'),
      },
    });
    await expect(broker.getStatus('image')).resolves.toMatchObject({
      target: { provider: 'gemini', capability: 'image' },
      state: 'signedOut',
    });
    await expect(broker.getAuthorizationHeaders('llm')).resolves.toEqual({
      Authorization: 'Bearer access-secret',
      'x-goog-user-project': 'quota-project',
    });
    expect(keychain.values.has('oauth:gemini:llm')).toBe(true);
    expect(keychain.values.has('oauth:gemini:image')).toBe(false);
  });
});
