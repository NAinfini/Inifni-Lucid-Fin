import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const logMock = vi.hoisted(() => vi.fn());

vi.mock('./logger.js', () => ({
  log: logMock,
}));

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  vi.setSystemTime(10_000);
  logMock.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('startup metrics', () => {
  it('logs milestone durations and both startup budget warnings', async () => {
    const metrics = await import('./startup-metrics.js');
    vi.setSystemTime(14_001);
    metrics.mark('window-created');
    vi.setSystemTime(14_500);
    metrics.mark('dom-ready');
    vi.setSystemTime(15_000);
    metrics.mark('fully-loaded');
    vi.setSystemTime(16_000);

    metrics.logStartupMetrics();

    expect(logMock).toHaveBeenNthCalledWith(1, 'info', 'Startup metrics', {
      totalMs: 6_000,
      windowCreatedMs: 4_001,
      domReadyMs: 4_500,
      fullyLoadedMs: 5_000,
    });
    expect(logMock).toHaveBeenNthCalledWith(
      2,
      'warn',
      'Window creation exceeded 3s target',
      expect.any(Object),
    );
    expect(logMock).toHaveBeenNthCalledWith(
      3,
      'warn',
      'Full startup exceeded 5s target',
      expect.any(Object),
    );
  });

  it('logs only total time when no milestones or budgets were exceeded', async () => {
    const metrics = await import('./startup-metrics.js');
    vi.setSystemTime(10_500);

    metrics.logStartupMetrics();

    expect(logMock).toHaveBeenCalledOnce();
    expect(logMock).toHaveBeenCalledWith('info', 'Startup metrics', { totalMs: 500 });
  });
});
