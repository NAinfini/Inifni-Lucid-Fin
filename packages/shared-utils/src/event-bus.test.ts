import { describe, it, expect, vi } from 'vitest';
import { createEventBus } from './event-bus.js';

interface AppEvents {
  'job.submitted': { jobId: string };
  'job.completed': { jobId: string; ok: boolean };
}

describe('EventBus', () => {
  it('delivers payloads to matching listeners and leaves others alone', () => {
    const bus = createEventBus<AppEvents>();
    const onSubmitted = vi.fn();
    const onCompleted = vi.fn();
    bus.on('job.submitted', onSubmitted);
    bus.on('job.completed', onCompleted);

    bus.emit('job.submitted', { jobId: 'a' });

    expect(onSubmitted).toHaveBeenCalledWith({ jobId: 'a' });
    expect(onCompleted).not.toHaveBeenCalled();
  });

  it('supports unsubscribe via returned disposer', () => {
    const bus = createEventBus<AppEvents>();
    const handler = vi.fn();
    const off = bus.on('job.submitted', handler);

    off();
    bus.emit('job.submitted', { jobId: 'x' });

    expect(handler).not.toHaveBeenCalled();
    expect(bus.listenerCount('job.submitted')).toBe(0);
  });

  it('allows a listener to unsubscribe another listener during emit', () => {
    const bus = createEventBus<AppEvents>();
    const delivered: string[] = [];
    const offB = bus.on('job.submitted', () => delivered.push('b'));
    bus.on('job.submitted', () => {
      delivered.push('a');
      offB();
    });

    bus.emit('job.submitted', { jobId: '1' });

    // Snapshot semantics: both handlers fire this round.
    expect(delivered).toEqual(['b', 'a']);
    delivered.length = 0;

    bus.emit('job.submitted', { jobId: '2' });
    expect(delivered).toEqual(['a']);
  });

  it('onAll sees every event', () => {
    const bus = createEventBus<AppEvents>();
    const seen: Array<[keyof AppEvents, unknown]> = [];
    bus.onAll((k, p) => seen.push([k, p]));

    bus.emit('job.submitted', { jobId: 'a' });
    bus.emit('job.completed', { jobId: 'a', ok: true });

    expect(seen).toEqual([
      ['job.submitted', { jobId: 'a' }],
      ['job.completed', { jobId: 'a', ok: true }],
    ]);
  });
});
