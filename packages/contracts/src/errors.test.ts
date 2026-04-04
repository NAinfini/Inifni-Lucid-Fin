import { describe, it, expect } from 'vitest';
import { LucidError, ErrorCode, JobStatus } from '../src/index.js';

describe('LucidError', () => {
  it('creates error with code and message', () => {
    const err = new LucidError(ErrorCode.AuthFailed, 'bad key');
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('LucidError');
    expect(err.code).toBe('AUTH_FAILED');
    expect(err.message).toBe('bad key');
  });

  it('includes optional details', () => {
    const err = new LucidError(ErrorCode.RateLimited, 'slow down', { retryAfter: 30 });
    expect(err.details).toEqual({ retryAfter: 30 });
  });

  it('details default to undefined', () => {
    const err = new LucidError(ErrorCode.Timeout, 'timed out');
    expect(err.details).toBeUndefined();
  });

  it('is catchable as Error', () => {
    try {
      throw new LucidError(ErrorCode.NotFound, 'missing');
    } catch (e) {
      expect(e).toBeInstanceOf(Error);
      expect((e as LucidError).code).toBe('NOT_FOUND');
    }
  });
});

describe('ErrorCode enum', () => {
  it('has all expected codes', () => {
    expect(ErrorCode.AuthFailed).toBe('AUTH_FAILED');
    expect(ErrorCode.RateLimited).toBe('RATE_LIMITED');
    expect(ErrorCode.ContentModeration).toBe('CONTENT_MODERATION');
    expect(ErrorCode.ServiceUnavailable).toBe('SERVICE_UNAVAILABLE');
    expect(ErrorCode.Timeout).toBe('TIMEOUT');
    expect(ErrorCode.InvalidRequest).toBe('INVALID_REQUEST');
    expect(ErrorCode.NotFound).toBe('NOT_FOUND');
    expect(ErrorCode.Unknown).toBe('UNKNOWN');
  });
});

describe('JobStatus enum', () => {
  it('has all expected statuses', () => {
    expect(JobStatus.Queued).toBe('queued');
    expect(JobStatus.Running).toBe('running');
    expect(JobStatus.Completed).toBe('completed');
    expect(JobStatus.Failed).toBe('failed');
    expect(JobStatus.Cancelled).toBe('cancelled');
    expect(JobStatus.Paused).toBe('paused');
    expect(JobStatus.Dead).toBe('dead');
  });

  it('has exactly 7 statuses', () => {
    const values = Object.values(JobStatus);
    expect(values).toHaveLength(7);
  });
});
