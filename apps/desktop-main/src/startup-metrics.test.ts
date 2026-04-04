import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the logger to avoid electron dependency
vi.mock('./logger.js', () => ({
  log: vi.fn(),
}));

import { mark, measure, getStartupMetrics, logStartupMetrics } from './startup-metrics.js';
import { log } from './logger.js';

describe('startup-metrics', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('mark records a timestamp', () => {
    mark('test-mark');
    const metrics = getStartupMetrics();
    expect(metrics['test-mark']).toBeGreaterThan(0);
  });

  it('measure returns elapsed time between marks', () => {
    mark('start');
    // Simulate some passage of time
    mark('end');
    const elapsed = measure('start', 'end');
    expect(elapsed).toBeGreaterThanOrEqual(0);
  });

  it('measure falls back to appStart for unknown from-mark', () => {
    mark('known');
    const elapsed = measure('unknown-mark', 'known');
    expect(elapsed).toBeGreaterThanOrEqual(0);
  });

  it('getStartupMetrics includes appStart and elapsed', () => {
    const metrics = getStartupMetrics();
    expect(metrics.appStart).toBeGreaterThan(0);
    expect(metrics.elapsed).toBeGreaterThanOrEqual(0);
  });

  it('logStartupMetrics calls log with info level', () => {
    logStartupMetrics();
    expect(log).toHaveBeenCalledWith('info', 'Startup metrics', expect.any(Object));
  });
});
