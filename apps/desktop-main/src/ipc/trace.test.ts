import { describe, expect, it } from 'vitest';
import { generateTraceId, getTraceId, withTraceId } from './trace.js';

describe('IPC trace', () => {
  it('generates unique trace IDs', () => {
    const a = generateTraceId();
    const b = generateTraceId();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^t\d+-[a-f0-9]{8}$/);
  });

  it('withTraceId sets and restores trace context', () => {
    expect(getTraceId()).toBeUndefined();

    withTraceId('test-123', () => {
      expect(getTraceId()).toBe('test-123');
    });

    expect(getTraceId()).toBeUndefined();
  });

  it('withTraceId nests correctly', () => {
    withTraceId('outer', () => {
      expect(getTraceId()).toBe('outer');
      withTraceId('inner', () => {
        expect(getTraceId()).toBe('inner');
      });
      expect(getTraceId()).toBe('outer');
    });
  });
});
