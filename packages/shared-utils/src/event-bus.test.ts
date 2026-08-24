import { describe, it, expect, vi } from 'vitest';
import { createEventBus } from './event-bus.js';

interface AppEvents {
  'task.submitted': { taskId: string };
  'task.completed': { taskId: string; ok: boolean };
}

describe('EventBus', () => {
  it('delivers payloads to matching listeners and leaves others alone', () => {
    const bus = createEventBus<AppEvents>();
    const onSubmitted = vi.fn();
    const onCompleted = vi.fn();
    bus.on('task.submitted', onSubmitted);
    bus.on('task.completed', onCompleted);

    bus.emit('task.submitted', { taskId: 'a' });

    expect(onSubmitted).toHaveBeenCalledWith({ taskId: 'a' });
    expect(onCompleted).not.toHaveBeenCalled();
  });

  it('supports unsubscribe via returned disposer', () => {
    const bus = createEventBus<AppEvents>();
    const handler = vi.fn();
    const off = bus.on('task.submitted', handler);

    off();
    bus.emit('task.submitted', { taskId: 'x' });

    expect(handler).not.toHaveBeenCalled();
    expect(bus.listenerCount('task.submitted')).toBe(0);
  });

  it('allows a listener to unsubscribe another listener during emit', () => {
    const bus = createEventBus<AppEvents>();
    const delivered: string[] = [];
    const offB = bus.on('task.submitted', () => delivered.push('b'));
    bus.on('task.submitted', () => {
      delivered.push('a');
      offB();
    });

    bus.emit('task.submitted', { taskId: '1' });

    // Snapshot semantics: both handlers fire this round.
    expect(delivered).toEqual(['b', 'a']);
    delivered.length = 0;

    bus.emit('task.submitted', { taskId: '2' });
    expect(delivered).toEqual(['a']);
  });

  it('onAll sees every event', () => {
    const bus = createEventBus<AppEvents>();
    const seen: Array<[keyof AppEvents, unknown]> = [];
    bus.onAll((k, p) => seen.push([k, p]));

    bus.emit('task.submitted', { taskId: 'a' });
    bus.emit('task.completed', { taskId: 'a', ok: true });

    expect(seen).toEqual([
      ['task.submitted', { taskId: 'a' }],
      ['task.completed', { taskId: 'a', ok: true }],
    ]);
  });
});
