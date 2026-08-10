import { describe, expect, it } from 'vitest';
import { parseStrict } from '../../parse.js';
import { providerOAuthChangedChannel, providerOAuthStatusChannel } from './batch-14.js';

describe('provider OAuth IPC contracts', () => {
  it('accepts a capability-scoped, renderer-safe ready state with remaining usage', () => {
    expect(
      parseStrict(
        providerOAuthStatusChannel.schemas.response,
        {
          target: { provider: 'chatgpt', capability: 'llm' },
          state: 'ready',
          planType: 'plus',
          usage: {
            state: 'available',
            windows: [
              {
                id: 'primary',
                label: 'Primary window',
                usedPercent: 25,
                remainingPercent: 75,
              },
            ],
          },
          version: '0.145.0',
        },
        { name: 'providerOAuth:status.response' },
      ),
    ).toMatchObject({ state: 'ready', usage: { windows: [{ remainingPercent: 75 }] } });
  });

  it.each(['token', 'authUrl', 'codexHome', 'email'])('rejects leaked %s fields', (field) => {
    expect(() =>
      parseStrict(
        providerOAuthChangedChannel.schemas.payload,
        {
          target: { provider: 'gemini', capability: 'video' },
          state: 'signedOut',
          [field]: 'sensitive',
        },
        { name: 'providerOAuth:changed.payload' },
      ),
    ).toThrow();
  });

  it('rejects unsupported provider and capability names', () => {
    expect(() =>
      parseStrict(
        providerOAuthStatusChannel.schemas.request,
        { target: { provider: 'openai', capability: 'audio' } },
        { name: 'providerOAuth:status.request' },
      ),
    ).toThrow();
  });
});
