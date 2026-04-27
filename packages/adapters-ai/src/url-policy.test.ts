import { describe, expect, it } from 'vitest';
import { validateProviderUrl } from './url-policy.js';

describe('validateProviderUrl', () => {
  it('allows https public provider URLs and returns the URL origin', () => {
    expect(validateProviderUrl('https://api.example.com/v1/chat?token=secret')).toEqual({
      origin: 'https://api.example.com',
    });
  });

  it('rejects non-HTTPS provider URLs by default', () => {
    expect(() => validateProviderUrl('http://api.example.com/v1')).toThrow(
      'Provider URL must use HTTPS',
    );
  });

  it('rejects file and ftp URLs', () => {
    expect(() => validateProviderUrl('file:///etc/passwd')).toThrow(
      'Unsupported provider URL protocol',
    );
    expect(() => validateProviderUrl('ftp://example.com/model')).toThrow(
      'Unsupported provider URL protocol',
    );
  });

  it('rejects private and link-local IP ranges', () => {
    for (const url of [
      'https://10.0.0.1/v1',
      'https://172.16.0.5/v1',
      'https://172.31.255.255/v1',
      'https://192.168.1.5/v1',
      'https://169.254.10.10/v1',
      'https://0.0.0.0/v1',
      'http://127.0.0.1:11434/v1',
      'http://[::1]:11434/v1',
      'https://[fc00::1]/v1',
      'https://[fd12:3456:789a::1]/v1',
      'https://[fe80::1]/v1',
      'https://[febf::1]/v1',
      'https://[::ffff:192.168.1.5]/v1',
    ]) {
      expect(() => validateProviderUrl(url)).toThrow();
    }
  });

  it('allows public IPv6 provider URLs', () => {
    expect(validateProviderUrl('https://[2606:4700:4700::1111]/v1')).toEqual({
      origin: 'https://[2606:4700:4700::1111]',
    });
  });

  it('allows localhost only when explicitly requested', () => {
    expect(validateProviderUrl('http://127.0.0.1:11434/v1', { allowLocalhost: true })).toEqual({
      origin: 'http://127.0.0.1:11434',
    });
    expect(validateProviderUrl('http://localhost:7860/sdapi', { allowLocalhost: true })).toEqual({
      origin: 'http://localhost:7860',
    });
  });
});
