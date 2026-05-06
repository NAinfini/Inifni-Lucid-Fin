import { describe, expect, it } from 'vitest';
import { redactSensitive, redactString, isSensitiveKey } from './redact.js';

describe('redactSensitive', () => {
  it('returns null/undefined unchanged', () => {
    expect(redactSensitive(null)).toBeNull();
    expect(redactSensitive(undefined)).toBeUndefined();
  });

  it('returns numbers and booleans unchanged', () => {
    expect(redactSensitive(42)).toBe(42);
    expect(redactSensitive(true)).toBe(true);
  });

  it('redacts sensitive keys in flat objects', () => {
    const input = { apiKey: 'sk-abc123', name: 'test', password: 'secret' };
    const result = redactSensitive(input) as Record<string, unknown>;
    expect(result.apiKey).toBe('[REDACTED]');
    expect(result.name).toBe('test');
    expect(result.password).toBe('[REDACTED]');
  });

  it('redacts sensitive keys case-insensitively', () => {
    const input = { APIKEY: 'key1', Authorization: 'Bearer abc', Token: 'tok' };
    const result = redactSensitive(input) as Record<string, unknown>;
    expect(result.APIKEY).toBe('[REDACTED]');
    expect(result.Authorization).toBe('[REDACTED]');
    expect(result.Token).toBe('[REDACTED]');
  });

  it('redacts nested objects recursively', () => {
    const input = {
      provider: 'openai',
      config: {
        apiKey: 'sk-secret-key-12345678901234567890',
        baseUrl: 'https://api.openai.com',
        nested: {
          secret: 'deep-secret',
          name: 'nested-name',
        },
      },
    };
    const result = redactSensitive(input) as Record<string, unknown>;
    const config = result.config as Record<string, unknown>;
    expect(config.apiKey).toBe('[REDACTED]');
    expect(config.baseUrl).toBe('https://api.openai.com');
    const nested = config.nested as Record<string, unknown>;
    expect(nested.secret).toBe('[REDACTED]');
    expect(nested.name).toBe('nested-name');
  });

  it('redacts arrays of objects', () => {
    const input = [
      { name: 'a', token: 'tok1' },
      { name: 'b', token: 'tok2' },
    ];
    const result = redactSensitive(input) as Array<Record<string, unknown>>;
    expect(result[0].name).toBe('a');
    expect(result[0].token).toBe('[REDACTED]');
    expect(result[1].name).toBe('b');
    expect(result[1].token).toBe('[REDACTED]');
  });

  it('handles circular references gracefully', () => {
    const obj: Record<string, unknown> = { name: 'test' };
    obj.self = obj;
    const result = redactSensitive(obj) as Record<string, unknown>;
    expect(result.name).toBe('test');
    expect(result.self).toBe('[Circular]');
  });

  it('does not mutate the original object', () => {
    const input = { apiKey: 'sk-test', name: 'original' };
    redactSensitive(input);
    expect(input.apiKey).toBe('sk-test');
    expect(input.name).toBe('original');
  });

  it('redacts API key patterns in string values', () => {
    const input = {
      message: 'Error: invalid key sk-proj-1234567890abcdef1234567890',
      status: 401,
    };
    const result = redactSensitive(input) as Record<string, unknown>;
    expect(result.message).toBe('Error: invalid key sk-***');
    expect(result.status).toBe(401);
  });

  it('redacts Bearer tokens in string values', () => {
    const input = {
      error: 'Failed with header Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9',
    };
    const result = redactSensitive(input) as Record<string, unknown>;
    expect(result.error).toContain('Bearer [REDACTED]');
    expect(result.error).not.toContain('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9');
  });

  // False positive test: field names that include sensitive words but are
  // not themselves keys should NOT have their values redacted by key match.
  it('does not redact boolean or numeric fields with sensitive-sounding names', () => {
    const input = {
      authorization_count: 5,
      api_key_configured: true,
      has_token: false,
      token_expiry: 3600,
    };
    // These keys partially match but only exact matches should be redacted.
    // 'api_key_configured' does not match 'api_key' exactly.
    const result = redactSensitive(input) as Record<string, unknown>;
    expect(result.authorization_count).toBe(5);
    expect(result.api_key_configured).toBe(true);
    expect(result.has_token).toBe(false);
    expect(result.token_expiry).toBe(3600);
  });
});

describe('redactString', () => {
  it('returns plain strings unchanged', () => {
    expect(redactString('hello world')).toBe('hello world');
  });

  it('redacts sk- prefixed keys', () => {
    const input = 'key is sk-proj-abcdef1234567890abcdef1234 end';
    const result = redactString(input);
    expect(result).toBe('key is sk-*** end');
    expect(result).not.toContain('abcdef1234567890');
  });

  it('redacts key- prefixed keys', () => {
    const input = 'api key: key-abcdef1234567890abcdef1234';
    const result = redactString(input);
    expect(result).toBe('api key: key-***');
  });

  it('redacts Bearer tokens', () => {
    const input = 'Authorization: Bearer eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.payload.signature';
    const result = redactString(input);
    expect(result).toContain('Bearer [REDACTED]');
    expect(result).not.toContain('eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9');
  });

  it('redacts GitHub tokens', () => {
    expect(redactString('ghp_abcdefghijklmnopqrstuvwxyz1234')).toBe('ghp_***');
  });

  it('redacts AWS access keys', () => {
    expect(redactString('AKIAIOSFODNN7EXAMPLE')).toBe('AKIA***');
  });

  it('redacts Google API keys', () => {
    const googleKey = 'AIzaSyA1234567890abcdefghijklmnopqrst';
    expect(redactString(googleKey)).toBe('AIza***');
  });

  it('redacts multiple patterns in the same string', () => {
    const input = 'keys: sk-12345678901234567890ab and key-99999999999999999999cc';
    const result = redactString(input);
    expect(result).toBe('keys: sk-*** and key-***');
  });

  it('does not redact short strings that partially match', () => {
    // sk- followed by <20 chars should NOT match
    expect(redactString('sk-short')).toBe('sk-short');
    expect(redactString('key-tiny')).toBe('key-tiny');
  });
});

describe('isSensitiveKey', () => {
  it('matches known sensitive keys case-insensitively', () => {
    expect(isSensitiveKey('apiKey')).toBe(true);
    expect(isSensitiveKey('APIKEY')).toBe(true);
    expect(isSensitiveKey('authorization')).toBe(true);
    expect(isSensitiveKey('Authorization')).toBe(true);
    expect(isSensitiveKey('password')).toBe(true);
    expect(isSensitiveKey('secret')).toBe(true);
    expect(isSensitiveKey('token')).toBe(true);
    expect(isSensitiveKey('x-api-key')).toBe(true);
    expect(isSensitiveKey('credential')).toBe(true);
  });

  it('returns false for non-sensitive keys', () => {
    expect(isSensitiveKey('name')).toBe(false);
    expect(isSensitiveKey('providerId')).toBe(false);
    expect(isSensitiveKey('baseUrl')).toBe(false);
    expect(isSensitiveKey('model')).toBe(false);
  });
});
