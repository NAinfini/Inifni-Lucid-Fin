import { describe, expect, it, vi } from 'vitest';
import { createEventBus } from '@lucid-fin/shared-utils';
import type { AppEvents } from './app-event-bus.js';
import { appEventBus } from './app-event-bus.js';

describe('appEventBus', () => {
  it('exposes the typed EventBus surface', () => {
    expect(typeof appEventBus.emit).toBe('function');
    expect(typeof appEventBus.on).toBe('function');
    expect(typeof appEventBus.onAll).toBe('function');
    expect(typeof appEventBus.listenerCount).toBe('function');
  });

  it('delivers job.submitted payloads to subscribers', () => {
    const bus = createEventBus<AppEvents>();
    const handler = vi.fn();
    const unsub = bus.on('job.submitted', handler);
    bus.emit('job.submitted', { jobId: 'j1', subjectKind: 'canvas-node', subjectId: 'n1' });
    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith({
      jobId: 'j1',
      subjectKind: 'canvas-node',
      subjectId: 'n1',
    });
    unsub();
    bus.emit('job.submitted', { jobId: 'j2', subjectKind: 'canvas-node', subjectId: 'n2' });
    expect(handler).toHaveBeenCalledOnce();
  });

  it('fans events to wildcard listeners', () => {
    const bus = createEventBus<AppEvents>();
    const wildcard = vi.fn();
    bus.onAll(wildcard);
    bus.emit('job.completed', { jobId: 'j1', outcome: 'success' });
    bus.emit('entity.updated', { entityKind: 'character', entityId: 'c1' });
    expect(wildcard).toHaveBeenCalledTimes(2);
    expect(wildcard).toHaveBeenNthCalledWith(1, 'job.completed', {
      jobId: 'j1',
      outcome: 'success',
    });
    expect(wildcard).toHaveBeenNthCalledWith(2, 'entity.updated', {
      entityKind: 'character',
      entityId: 'c1',
    });
  });
});
