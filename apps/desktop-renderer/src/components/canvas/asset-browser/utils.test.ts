import { describe, expect, it, vi } from 'vitest';

// Mock i18n before importing
vi.mock('../../../i18n.js', () => ({
  t: (key: string) => key,
}));

import {
  formatSize,
  formatDuration,
  formatDurationShort,
  getErrorMessage,
  getErrorDetail,
  formatFailureSummary,
} from './utils.js';

describe('formatSize', () => {
  it('formats bytes', () => expect(formatSize(500)).toBe('500B'));
  it('formats KB', () => expect(formatSize(2048)).toBe('2.0KB'));
  it('formats MB', () => expect(formatSize(1048576)).toBe('1.0MB'));
});

describe('formatDuration', () => {
  it('formats seconds', () => expect(formatDuration(5)).toBe('0:05'));
  it('formats minutes', () => expect(formatDuration(125)).toBe('2:05'));
});

describe('formatDurationShort', () => {
  it('formats seconds only', () => expect(formatDurationShort(5)).toBe('5s'));
  it('formats minutes', () => expect(formatDurationShort(125)).toBe('2:05'));
});

describe('getErrorMessage', () => {
  it('extracts Error message', () => {
    expect(getErrorMessage(new Error('boom'))).toBe('boom');
  });
  it('returns fallback for non-Error', () => {
    expect(getErrorMessage('oops')).toBe('toast.error.unknownError');
  });
});

describe('getErrorDetail', () => {
  it('returns stack from Error', () => {
    const err = new Error('boom');
    expect(getErrorDetail(err)).toContain('boom');
  });
  it('stringifies non-Error', () => {
    expect(getErrorDetail('oops')).toBe('oops');
  });
});

describe('formatFailureSummary', () => {
  it('returns summary when no extra', () => {
    expect(formatFailureSummary('failed', 0)).toBe('failed');
  });
  it('appends extra count', () => {
    expect(formatFailureSummary('failed', 3)).toContain('+3');
  });
});
