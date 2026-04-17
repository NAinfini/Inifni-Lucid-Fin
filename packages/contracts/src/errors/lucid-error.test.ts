import { describe, it, expect } from 'vitest';
import { ErrorCode, LucidError } from './index.js';

describe('LucidError factories', () => {
  it('notFound attaches resource + id to details', () => {
    const err = LucidError.notFound('character', 'char_123');
    expect(err.code).toBe(ErrorCode.ResourceNotFound);
    expect(err.message).toBe('character not found: char_123');
    expect(err.details).toMatchObject({ resource: 'character', id: 'char_123' });
  });

  it('validation preserves caller-supplied details', () => {
    const err = LucidError.validation('bad shape', { field: 'email' });
    expect(err.code).toBe(ErrorCode.ValidationFailed);
    expect(err.details).toEqual({ field: 'email' });
  });

  it('conflict carries custom message', () => {
    const err = LucidError.conflict('version mismatch');
    expect(err.code).toBe(ErrorCode.Conflict);
    expect(err.message).toBe('version mismatch');
  });

  it('providerUnconfigured mentions the provider id', () => {
    const err = LucidError.providerUnconfigured('openai');
    expect(err.code).toBe(ErrorCode.ProviderUnconfigured);
    expect(err.message).toContain('openai');
    expect(err.details).toMatchObject({ providerId: 'openai' });
  });

  it('providerQuota marks retryable in details', () => {
    const err = LucidError.providerQuota('anthropic', 'monthly limit');
    expect(err.code).toBe(ErrorCode.ProviderQuota);
    expect(err.details).toMatchObject({ providerId: 'anthropic', retryable: true });
  });

  it('cancelled uses default message', () => {
    const err = LucidError.cancelled();
    expect(err.code).toBe(ErrorCode.Cancelled);
    expect(err.message).toBe('Operation cancelled');
  });

  it('degradedRead references the resource', () => {
    const err = LucidError.degradedRead('presets', { rowCount: 3 });
    expect(err.code).toBe(ErrorCode.DegradedRead);
    expect(err.details).toMatchObject({ resource: 'presets', rowCount: 3 });
  });

  it('fromUnknown passes through existing LucidError unchanged', () => {
    const original = LucidError.notFound('asset', 'a1');
    const wrapped = LucidError.fromUnknown(original);
    expect(wrapped).toBe(original);
  });

  it('fromUnknown wraps plain errors with fallback code', () => {
    const wrapped = LucidError.fromUnknown(new Error('boom'), ErrorCode.Timeout);
    expect(wrapped.code).toBe(ErrorCode.Timeout);
    expect(wrapped.message).toBe('boom');
  });
});
