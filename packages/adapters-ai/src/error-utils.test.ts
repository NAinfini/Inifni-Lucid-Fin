import { describe, expect, it } from 'vitest';
import { parseAdapterError, adapterErrorToLucidError } from './error-utils.js';
import { ErrorCategory, ErrorCode } from '@lucid-fin/contracts';

describe('parseAdapterError', () => {
  describe('HTTP status classification', () => {
    it('classifies 401 as Auth error', () => {
      const result = parseAdapterError({
        provider: 'test-provider',
        status: 401,
        error: { message: 'Unauthorized' },
      });
      expect(result.category).toBe(ErrorCategory.Auth);
      expect(result.retryable).toBe(false);
    });

    it('classifies 403 as Auth error', () => {
      const result = parseAdapterError({
        provider: 'test-provider',
        status: 403,
        error: { message: 'Forbidden' },
      });
      expect(result.category).toBe(ErrorCategory.Auth);
      expect(result.retryable).toBe(false);
    });

    it('classifies 429 as RateLimit error', () => {
      const result = parseAdapterError({
        provider: 'test-provider',
        status: 429,
        error: { message: 'Too many requests' },
      });
      expect(result.category).toBe(ErrorCategory.RateLimit);
      expect(result.retryable).toBe(true);
    });

    it('classifies 408 as Timeout error', () => {
      const result = parseAdapterError({
        provider: 'test-provider',
        status: 408,
        error: { message: 'Request timeout' },
      });
      expect(result.category).toBe(ErrorCategory.Timeout);
      expect(result.retryable).toBe(true);
    });

    it('classifies 504 as Timeout error', () => {
      const result = parseAdapterError({
        provider: 'test-provider',
        status: 504,
        error: { message: 'Gateway timeout' },
      });
      expect(result.category).toBe(ErrorCategory.Timeout);
      expect(result.retryable).toBe(true);
    });

    it('classifies 400 with moderation keywords as ContentModeration', () => {
      const result = parseAdapterError({
        provider: 'test-provider',
        status: 400,
        error: { message: 'Content blocked by moderation policy' },
      });
      expect(result.category).toBe(ErrorCategory.ContentModeration);
      expect(result.retryable).toBe(false);
    });

    it('classifies 400 without moderation keywords as InvalidInput', () => {
      const result = parseAdapterError({
        provider: 'test-provider',
        status: 400,
        error: { message: 'Invalid parameter: width must be positive' },
      });
      expect(result.category).toBe(ErrorCategory.InvalidInput);
      expect(result.retryable).toBe(false);
    });

    it('classifies 500 as ServiceError', () => {
      const result = parseAdapterError({
        provider: 'test-provider',
        status: 500,
        error: { message: 'Internal server error' },
      });
      expect(result.category).toBe(ErrorCategory.ServiceError);
      expect(result.retryable).toBe(true);
    });

    it('classifies 503 as ServiceError', () => {
      const result = parseAdapterError({
        provider: 'test-provider',
        status: 503,
        error: { message: 'Service unavailable' },
      });
      expect(result.category).toBe(ErrorCategory.ServiceError);
      expect(result.retryable).toBe(true);
    });
  });

  describe('provider code classification', () => {
    it('recognizes auth-related provider codes', () => {
      const result = parseAdapterError({
        provider: 'test-provider',
        error: { code: 'invalid_api_key', message: 'Invalid API key' },
      });
      expect(result.category).toBe(ErrorCategory.Auth);
      expect(result.providerCode).toBe('invalid_api_key');
    });

    it('recognizes rate limit provider codes', () => {
      const result = parseAdapterError({
        provider: 'test-provider',
        error: { code: 'rate_limit_exceeded', message: 'Rate limit exceeded' },
      });
      expect(result.category).toBe(ErrorCategory.RateLimit);
      expect(result.providerCode).toBe('rate_limit_exceeded');
    });

    it('recognizes quota provider codes', () => {
      const result = parseAdapterError({
        provider: 'test-provider',
        error: { code: 'quota_exceeded', message: 'Quota exceeded' },
      });
      expect(result.category).toBe(ErrorCategory.RateLimit);
      expect(result.providerCode).toBe('quota_exceeded');
    });

    it('recognizes moderation provider codes', () => {
      const result = parseAdapterError({
        provider: 'test-provider',
        error: { code: 'content_policy_violation', message: 'Content policy violation' },
      });
      expect(result.category).toBe(ErrorCategory.ContentModeration);
      expect(result.providerCode).toBe('content_policy_violation');
    });

    it('recognizes safety provider codes', () => {
      const result = parseAdapterError({
        provider: 'test-provider',
        error: { code: 'safety_check_failed', message: 'Safety check failed' },
      });
      expect(result.category).toBe(ErrorCategory.ContentModeration);
      expect(result.providerCode).toBe('safety_check_failed');
    });

    it('recognizes timeout provider codes', () => {
      const result = parseAdapterError({
        provider: 'test-provider',
        error: { code: 'request_timeout', message: 'Request timeout' },
      });
      expect(result.category).toBe(ErrorCategory.Timeout);
      expect(result.providerCode).toBe('request_timeout');
    });

    it('recognizes invalid input provider codes', () => {
      const result = parseAdapterError({
        provider: 'test-provider',
        error: { code: 'invalid_request', message: 'Invalid request' },
      });
      expect(result.category).toBe(ErrorCategory.InvalidInput);
      expect(result.providerCode).toBe('invalid_request');
    });
  });

  describe('message extraction', () => {
    it('extracts message from string error', () => {
      const result = parseAdapterError({
        provider: 'test-provider',
        error: 'Simple error message',
      });
      expect(result.message).toBe('Simple error message');
    });

    it('extracts message from error object', () => {
      const result = parseAdapterError({
        provider: 'test-provider',
        error: { message: 'Error message from object' },
      });
      expect(result.message).toBe('Error message from object');
    });

    it('extracts message from nested error object', () => {
      const result = parseAdapterError({
        provider: 'test-provider',
        error: {
          error: {
            message: 'Nested error message',
          },
        },
      });
      expect(result.message).toBe('Nested error message');
    });

    it('extracts detail field as message', () => {
      const result = parseAdapterError({
        provider: 'test-provider',
        error: { detail: 'Error detail' },
      });
      expect(result.message).toBe('Error detail');
    });

    it('extracts title field as message', () => {
      const result = parseAdapterError({
        provider: 'test-provider',
        error: { title: 'Error title' },
      });
      expect(result.message).toBe('Error title');
    });

    it('uses fallback message when no message found', () => {
      const result = parseAdapterError({
        provider: 'test-provider',
        error: {},
      });
      expect(result.message).toBe('test-provider request failed');
    });

    it('prefers direct message over nested message', () => {
      const result = parseAdapterError({
        provider: 'test-provider',
        error: {
          message: 'Direct message',
          error: {
            message: 'Nested message',
          },
        },
      });
      expect(result.message).toBe('Direct message');
    });
  });

  describe('provider code extraction', () => {
    it('extracts code from error object', () => {
      const result = parseAdapterError({
        provider: 'test-provider',
        error: { code: 'error_code', message: 'Error' },
      });
      expect(result.providerCode).toBe('error_code');
    });

    it('extracts type as provider code', () => {
      const result = parseAdapterError({
        provider: 'test-provider',
        error: { type: 'error_type', message: 'Error' },
      });
      expect(result.providerCode).toBe('error_type');
    });

    it('extracts code from nested error', () => {
      const result = parseAdapterError({
        provider: 'test-provider',
        error: {
          error: {
            code: 'nested_code',
          },
          message: 'Error',
        },
      });
      expect(result.providerCode).toBe('nested_code');
    });

    it('prefers direct code over nested code', () => {
      const result = parseAdapterError({
        provider: 'test-provider',
        error: {
          code: 'direct_code',
          error: {
            code: 'nested_code',
          },
          message: 'Error',
        },
      });
      expect(result.providerCode).toBe('direct_code');
    });
  });

  describe('retryAfter extraction', () => {
    it('extracts retry_after from error object', () => {
      const result = parseAdapterError({
        provider: 'test-provider',
        status: 429,
        error: { retry_after: 60, message: 'Rate limited' },
      });
      expect(result.retryAfter).toBe(60);
    });

    it('extracts retryAfter (camelCase) from error object', () => {
      const result = parseAdapterError({
        provider: 'test-provider',
        status: 429,
        error: { retryAfter: 120, message: 'Rate limited' },
      });
      expect(result.retryAfter).toBe(120);
    });

    it('extracts retryAfter from nested error', () => {
      const result = parseAdapterError({
        provider: 'test-provider',
        status: 429,
        error: {
          error: {
            retry_after: 90,
          },
          message: 'Rate limited',
        },
      });
      expect(result.retryAfter).toBe(90);
    });

    it('parses retryAfter from string', () => {
      const result = parseAdapterError({
        provider: 'test-provider',
        status: 429,
        error: { retry_after: '45', message: 'Rate limited' },
      });
      expect(result.retryAfter).toBe(45);
    });

    it('ignores negative retryAfter', () => {
      const result = parseAdapterError({
        provider: 'test-provider',
        status: 429,
        error: { retry_after: -10, message: 'Rate limited' },
      });
      expect(result.retryAfter).toBeUndefined();
    });

    it('returns undefined when retryAfter not present', () => {
      const result = parseAdapterError({
        provider: 'test-provider',
        status: 429,
        error: { message: 'Rate limited' },
      });
      expect(result.retryAfter).toBeUndefined();
    });
  });

  describe('retryable logic', () => {
    it('marks Auth errors as not retryable', () => {
      const result = parseAdapterError({
        provider: 'test-provider',
        status: 401,
        error: { message: 'Unauthorized' },
      });
      expect(result.retryable).toBe(false);
    });

    it('marks InvalidInput errors as not retryable', () => {
      const result = parseAdapterError({
        provider: 'test-provider',
        status: 400,
        error: { message: 'Invalid input' },
      });
      expect(result.retryable).toBe(false);
    });

    it('marks ContentModeration errors as not retryable', () => {
      const result = parseAdapterError({
        provider: 'test-provider',
        status: 400,
        error: { message: 'Content blocked by moderation' },
      });
      expect(result.retryable).toBe(false);
    });

    it('marks RateLimit errors as retryable', () => {
      const result = parseAdapterError({
        provider: 'test-provider',
        status: 429,
        error: { message: 'Rate limited' },
      });
      expect(result.retryable).toBe(true);
    });

    it('marks Timeout errors as retryable', () => {
      const result = parseAdapterError({
        provider: 'test-provider',
        status: 504,
        error: { message: 'Timeout' },
      });
      expect(result.retryable).toBe(true);
    });

    it('marks 5xx ServiceError as retryable', () => {
      const result = parseAdapterError({
        provider: 'test-provider',
        status: 503,
        error: { message: 'Service unavailable' },
      });
      expect(result.retryable).toBe(true);
    });

    it('marks ServiceError without status as retryable', () => {
      const result = parseAdapterError({
        provider: 'test-provider',
        error: { message: 'Unknown error' },
        fallbackCategory: ErrorCategory.ServiceError,
      });
      expect(result.retryable).toBe(true);
    });
  });

  describe('fallback category', () => {
    it('uses fallback category when classification fails', () => {
      const result = parseAdapterError({
        provider: 'test-provider',
        error: { message: 'Unknown error' },
        fallbackCategory: ErrorCategory.Timeout,
      });
      expect(result.category).toBe(ErrorCategory.Timeout);
    });

    it('defaults to ServiceError when no fallback provided', () => {
      const result = parseAdapterError({
        provider: 'test-provider',
        error: { message: 'Unknown error' },
      });
      expect(result.category).toBe(ErrorCategory.ServiceError);
    });
  });

  describe('originalError preservation', () => {
    it('preserves original error object', () => {
      const originalError = { code: 'test_error', message: 'Test error' };
      const result = parseAdapterError({
        provider: 'test-provider',
        error: originalError,
      });
      expect(result.originalError).toBe(originalError);
    });
  });
});

describe('adapterErrorToLucidError', () => {
  it('converts Auth category to AuthFailed code', () => {
    const adapterError = {
      category: ErrorCategory.Auth,
      message: 'Authentication failed',
      retryable: false,
    };
    const lucidError = adapterErrorToLucidError(adapterError);
    expect(lucidError.code).toBe(ErrorCode.AuthFailed);
    expect(lucidError.message).toBe('Authentication failed');
  });

  it('converts RateLimit category to RateLimited code', () => {
    const adapterError = {
      category: ErrorCategory.RateLimit,
      message: 'Rate limit exceeded',
      retryable: true,
      retryAfter: 60,
    };
    const lucidError = adapterErrorToLucidError(adapterError);
    expect(lucidError.code).toBe(ErrorCode.RateLimited);
    expect(lucidError.message).toBe('Rate limit exceeded');
  });

  it('converts ContentModeration category to ContentModeration code', () => {
    const adapterError = {
      category: ErrorCategory.ContentModeration,
      message: 'Content blocked',
      retryable: false,
    };
    const lucidError = adapterErrorToLucidError(adapterError);
    expect(lucidError.code).toBe(ErrorCode.ContentModeration);
    expect(lucidError.message).toBe('Content blocked');
  });

  it('converts InvalidInput category to InvalidRequest code', () => {
    const adapterError = {
      category: ErrorCategory.InvalidInput,
      message: 'Invalid input',
      retryable: false,
    };
    const lucidError = adapterErrorToLucidError(adapterError);
    expect(lucidError.code).toBe(ErrorCode.InvalidRequest);
    expect(lucidError.message).toBe('Invalid input');
  });

  it('converts Timeout category to Timeout code', () => {
    const adapterError = {
      category: ErrorCategory.Timeout,
      message: 'Request timeout',
      retryable: true,
    };
    const lucidError = adapterErrorToLucidError(adapterError);
    expect(lucidError.code).toBe(ErrorCode.Timeout);
    expect(lucidError.message).toBe('Request timeout');
  });

  it('converts ServiceError category to ServiceUnavailable code', () => {
    const adapterError = {
      category: ErrorCategory.ServiceError,
      message: 'Service error',
      retryable: true,
    };
    const lucidError = adapterErrorToLucidError(adapterError);
    expect(lucidError.code).toBe(ErrorCode.ServiceUnavailable);
    expect(lucidError.message).toBe('Service error');
  });

  it('preserves retryable metadata', () => {
    const adapterError = {
      category: ErrorCategory.RateLimit,
      message: 'Rate limited',
      retryable: true,
      retryAfter: 120,
    };
    const lucidError = adapterErrorToLucidError(adapterError);
    expect(lucidError.details?.retryable).toBe(true);
    expect(lucidError.details?.retryAfter).toBe(120);
  });

  it('preserves providerCode metadata', () => {
    const adapterError = {
      category: ErrorCategory.Auth,
      message: 'Invalid API key',
      retryable: false,
      providerCode: 'invalid_api_key',
    };
    const lucidError = adapterErrorToLucidError(adapterError);
    expect(lucidError.details?.providerCode).toBe('invalid_api_key');
  });

  it('preserves originalError metadata', () => {
    const originalError = { code: 'test_error' };
    const adapterError = {
      category: ErrorCategory.ServiceError,
      message: 'Service error',
      retryable: true,
      originalError,
    };
    const lucidError = adapterErrorToLucidError(adapterError);
    expect(lucidError.details?.originalError).toBe(originalError);
  });
});
