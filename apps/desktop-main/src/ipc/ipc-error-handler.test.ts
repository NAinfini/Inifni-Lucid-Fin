import { describe, expect, it } from 'vitest';
import { LucidError, ErrorCode } from '@lucid-fin/contracts';
import { toIpcErrorPayload } from './ipc-error-handler.js';

describe('toIpcErrorPayload', () => {
  it('wraps a LucidError into IpcErrorPayload', () => {
    const error = new LucidError(ErrorCode.AuthFailed, 'Auth failed', { providerId: 'openai' });
    const result = toIpcErrorPayload(error);
    expect(result.__ipcError).toBe(true);
    expect(result.code).toBe(ErrorCode.AuthFailed);
    expect(result.message).toBe('Auth failed');
    expect(result.details).toEqual({ providerId: 'openai' });
  });

  it('wraps a plain Error into IpcErrorPayload', () => {
    const error = new Error('something broke');
    const result = toIpcErrorPayload(error);
    expect(result.__ipcError).toBe(true);
    expect(result.code).toBe(ErrorCode.Unknown);
    expect(result.message).toBe('something broke');
  });

  it('redacts sensitive fields in details', () => {
    const error = new LucidError(ErrorCode.Unknown, 'provider error', {
      apiKey: 'sk-secret-key-that-should-not-leak',
      Authorization: 'Bearer top-secret-token-1234567890',
      providerId: 'openai',
    });
    const result = toIpcErrorPayload(error);
    expect(result.details?.apiKey).toBe('[REDACTED]');
    expect(result.details?.Authorization).toBe('[REDACTED]');
    expect(result.details?.providerId).toBe('openai');
  });

  it('redacts API key patterns in the error message', () => {
    const error = new LucidError(
      ErrorCode.AuthFailed,
      'Invalid key: sk-proj-abcdef1234567890abcdef1234',
    );
    const result = toIpcErrorPayload(error);
    expect(result.message).toContain('sk-***');
    expect(result.message).not.toContain('abcdef1234567890');
  });

  it('redacts nested sensitive data in details', () => {
    const error = new LucidError(ErrorCode.Unknown, 'config error', {
      config: {
        token: 'secret-token',
        baseUrl: 'https://api.example.com',
      },
    });
    const result = toIpcErrorPayload(error);
    const config = result.details?.config as Record<string, unknown>;
    expect(config.token).toBe('[REDACTED]');
    expect(config.baseUrl).toBe('https://api.example.com');
  });

  it('preserves retryable flag from raw details', () => {
    const error = new LucidError(ErrorCode.RateLimited, 'too many', {
      retryable: true,
      retryAfter: 5,
    });
    const result = toIpcErrorPayload(error);
    expect(result.retryable).toBe(true);
  });
});
