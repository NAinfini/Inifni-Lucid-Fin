import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ProviderHealthTracker } from './provider-health.js';

describe('ProviderHealthTracker', () => {
  let tracker: ProviderHealthTracker;

  beforeEach(() => {
    tracker = new ProviderHealthTracker();
  });

  it('returns unknown status for a provider with no calls', () => {
    const status = tracker.getStatus('openai');
    expect(status).toEqual({
      providerId: 'openai',
      consecutiveFailures: 0,
      status: 'unknown',
      totalSuccesses: 0,
      totalFailures: 0,
    });
  });

  it('returns healthy after a success', () => {
    tracker.recordSuccess('openai');
    const status = tracker.getStatus('openai');
    expect(status.status).toBe('healthy');
    expect(status.consecutiveFailures).toBe(0);
    expect(status.totalSuccesses).toBe(1);
    expect(status.lastSuccess).toBeDefined();
  });

  it('returns degraded after 1 failure', () => {
    tracker.recordSuccess('openai');
    tracker.recordFailure('openai');
    const status = tracker.getStatus('openai');
    expect(status.status).toBe('degraded');
    expect(status.consecutiveFailures).toBe(1);
  });

  it('returns degraded after 2 consecutive failures', () => {
    tracker.recordSuccess('openai');
    tracker.recordFailure('openai');
    tracker.recordFailure('openai');
    const status = tracker.getStatus('openai');
    expect(status.status).toBe('degraded');
    expect(status.consecutiveFailures).toBe(2);
  });

  it('returns down after 3 consecutive failures', () => {
    tracker.recordFailure('openai');
    tracker.recordFailure('openai');
    tracker.recordFailure('openai');
    const status = tracker.getStatus('openai');
    expect(status.status).toBe('down');
    expect(status.consecutiveFailures).toBe(3);
  });

  it('recovers to healthy after a success following failures', () => {
    tracker.recordFailure('openai');
    tracker.recordFailure('openai');
    tracker.recordFailure('openai');
    expect(tracker.getStatus('openai').status).toBe('down');

    tracker.recordSuccess('openai');
    const status = tracker.getStatus('openai');
    expect(status.status).toBe('healthy');
    expect(status.consecutiveFailures).toBe(0);
    expect(status.totalSuccesses).toBe(1);
    expect(status.totalFailures).toBe(3);
  });

  it('logs warning at 5 consecutive failures', () => {
    const warn = vi.fn();
    tracker.setWarnLogger(warn);

    for (let i = 0; i < 5; i++) {
      tracker.recordFailure('runway');
    }
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('runway'),
      expect.objectContaining({
        category: 'provider-health',
        providerId: 'runway',
        consecutiveFailures: 5,
      }),
    );
  });

  it('does not warn again until recovery and re-failure', () => {
    const warn = vi.fn();
    tracker.setWarnLogger(warn);

    for (let i = 0; i < 7; i++) {
      tracker.recordFailure('runway');
    }
    expect(warn).toHaveBeenCalledTimes(1);

    // Recovery resets the warning flag
    tracker.recordSuccess('runway');
    for (let i = 0; i < 5; i++) {
      tracker.recordFailure('runway');
    }
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it('tracks multiple providers independently', () => {
    tracker.recordSuccess('openai');
    tracker.recordFailure('runway');
    tracker.recordFailure('runway');
    tracker.recordFailure('runway');

    expect(tracker.getStatus('openai').status).toBe('healthy');
    expect(tracker.getStatus('runway').status).toBe('down');
  });

  it('getAllStatuses returns all tracked providers', () => {
    tracker.recordSuccess('openai');
    tracker.recordFailure('runway');

    const all = tracker.getAllStatuses();
    expect(all).toHaveLength(2);
    const ids = all.map((s) => s.providerId).sort();
    expect(ids).toEqual(['openai', 'runway']);
  });

  it('resetProvider clears a single provider', () => {
    tracker.recordSuccess('openai');
    tracker.recordFailure('runway');

    tracker.resetProvider('openai');
    expect(tracker.getStatus('openai').status).toBe('unknown');
    expect(tracker.getStatus('runway').status).toBe('degraded');
    expect(tracker.getAllStatuses()).toHaveLength(1);
  });

  it('resetAll clears all providers', () => {
    tracker.recordSuccess('openai');
    tracker.recordFailure('runway');

    tracker.resetAll();
    expect(tracker.getAllStatuses()).toHaveLength(0);
    expect(tracker.getStatus('openai').status).toBe('unknown');
  });

  it('tracks totalSuccesses and totalFailures across recovery cycles', () => {
    tracker.recordSuccess('openai');
    tracker.recordSuccess('openai');
    tracker.recordFailure('openai');
    tracker.recordSuccess('openai');
    tracker.recordFailure('openai');
    tracker.recordFailure('openai');

    const status = tracker.getStatus('openai');
    expect(status.totalSuccesses).toBe(3);
    expect(status.totalFailures).toBe(3);
    expect(status.consecutiveFailures).toBe(2);
    expect(status.status).toBe('degraded');
  });

  it('first failure on a fresh provider results in degraded (not unknown)', () => {
    tracker.recordFailure('claude');
    const status = tracker.getStatus('claude');
    expect(status.status).toBe('degraded');
    expect(status.totalFailures).toBe(1);
    expect(status.totalSuccesses).toBe(0);
  });
});
