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

  it('refuses a stored key for a foreign host (exfiltration attempt)', () => {
    expect(isStoredKeyAllowedForBaseUrl('openai-dalle', 'https://attacker.example/v1')).toBe(false);
    expect(isStoredKeyAllowedForBaseUrl('claude', 'https://evil.test')).toBe(false);
  });

  it('refuses a host that merely contains the canonical host as a substring', () => {
    expect(isStoredKeyAllowedForBaseUrl('openai-dalle', 'https://api.openai.com.attacker.test')).toBe(
      false,
    );
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
