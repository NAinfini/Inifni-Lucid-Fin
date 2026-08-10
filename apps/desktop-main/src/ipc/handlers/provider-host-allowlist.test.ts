import { describe, expect, it } from 'vitest';
import { isStoredKeyAllowedForBaseUrl } from './provider-host-allowlist.js';

describe('isStoredKeyAllowedForBaseUrl', () => {
  it('allows the normal path with no custom baseUrl', () => {
    expect(isStoredKeyAllowedForBaseUrl('openai-dalle', undefined)).toBe(true);
  });

  it('allows a baseUrl on the provider canonical host', () => {
    expect(isStoredKeyAllowedForBaseUrl('openai-dalle', 'https://api.openai.com/v1')).toBe(true);
    expect(isStoredKeyAllowedForBaseUrl('claude', 'https://api.anthropic.com')).toBe(true);
  });

  it('uses the group-aware media catalog for current provider hosts', () => {
    expect(isStoredKeyAllowedForBaseUrl('openai-dalle', 'https://api.openai.com/v1', 'image')).toBe(
      true,
    );
    expect(isStoredKeyAllowedForBaseUrl('minimax', 'https://api.minimax.io/v1', 'video')).toBe(
      true,
    );
    expect(isStoredKeyAllowedForBaseUrl('xai-imagine', 'https://api.x.ai/v1', 'image')).toBe(true);
    expect(
      isStoredKeyAllowedForBaseUrl(
        'volcengine-video',
        'https://ark.eu-west.bytepluses.com/api/v3',
        'video',
      ),
    ).toBe(true);
    expect(isStoredKeyAllowedForBaseUrl('fal', 'https://queue.fal.run/model', 'video')).toBe(true);
    expect(
      isStoredKeyAllowedForBaseUrl(
        'alibaba-wan-video',
        'https://ws-123.cn-beijing.maas.aliyuncs.com/api/v1',
        'video',
      ),
    ).toBe(true);
  });

  it('rejects stale or cross-provider media hosts', () => {
    expect(isStoredKeyAllowedForBaseUrl('minimax', 'https://api.minimax.chat/v1', 'video')).toBe(
      false,
    );
    expect(isStoredKeyAllowedForBaseUrl('google-image', 'https://api.openai.com/v1', 'image')).toBe(
      false,
    );
  });

  it('refuses a stored key for a foreign host (exfiltration attempt)', () => {
    expect(isStoredKeyAllowedForBaseUrl('openai-dalle', 'https://attacker.example/v1')).toBe(false);
    expect(isStoredKeyAllowedForBaseUrl('claude', 'https://evil.test')).toBe(false);
  });

  it('refuses a host that merely contains the canonical host as a substring', () => {
    expect(
      isStoredKeyAllowedForBaseUrl('openai-dalle', 'https://api.openai.com.attacker.test'),
    ).toBe(false);
    expect(
      isStoredKeyAllowedForBaseUrl(
        'alibaba-wan-video',
        'https://ws-123.cn-beijing.maas.aliyuncs.com.attacker.test',
        'video',
      ),
    ).toBe(false);
  });

  it('allows loopback hosts for self-hosted adapters', () => {
    expect(isStoredKeyAllowedForBaseUrl('comfyui', 'http://127.0.0.1:8188')).toBe(true);
    expect(isStoredKeyAllowedForBaseUrl('ollama', 'http://localhost:11434')).toBe(true);
  });

  it('refuses unknown/custom providers against a remote host', () => {
    expect(isStoredKeyAllowedForBaseUrl('my-custom-proxy', 'https://proxy.example/v1')).toBe(false);
  });

  it('allows unknown/custom providers against loopback', () => {
    expect(isStoredKeyAllowedForBaseUrl('my-custom-local', 'http://127.0.0.1:9000')).toBe(true);
  });

  it('refuses an unparseable baseUrl', () => {
    expect(isStoredKeyAllowedForBaseUrl('openai-dalle', 'not a url')).toBe(false);
  });
});
