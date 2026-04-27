import { describe, expect, it, vi } from 'vitest';
import { TodoRunStore, TodoRunStoreError } from './todo-run-store.js';

function makeStore(overrides?: Parameters<typeof TodoRunStore>[0] extends infer _ ? never : never) {
  void overrides;
  let seq = 0;
  const onSnapshot = vi.fn();
  const onUpdate = vi.fn();
  const store = new TodoRunStore({
    generateId: (kind) => `${kind}-${++seq}`,
    onSnapshot,
    onUpdate,
  });
  return { store, onSnapshot, onUpdate };
}

describe('TodoRunStore.set', () => {
  it('creates a snapshot with the first item in_progress and fires onSnapshot', () => {
    const { store, onSnapshot } = makeStore();
    const snapshot = store.set({
      items: [{ label: 'Plan shots' }, { label: 'Generate refs' }, { label: 'Render video' }],
    });
    expect(snapshot.todoId).toBe('todo-1');
    expect(snapshot.items).toHaveLength(3);
    expect(snapshot.items[0]).toMatchObject({ label: 'Plan shots', status: 'in_progress' });
    expect(snapshot.items[1]).toMatchObject({ status: 'pending' });
    expect(snapshot.items[2]).toMatchObject({ status: 'pending' });
    expect(onSnapshot).toHaveBeenCalledTimes(1);
    expect(onSnapshot).toHaveBeenCalledWith(snapshot, 'set');
  });

  it('rejects below-minimum item counts', () => {
    const { store } = makeStore();
    expect(() => store.set({ items: [{ label: 'only one' }] })).toThrow(TodoRunStoreError);
  });

  it('rejects above-maximum item counts', () => {
    const { store } = makeStore();
    const items = Array.from({ length: 11 }, (_, i) => ({ label: `item ${i}` }));
    expect(() => store.set({ items })).toThrow(/between 2 and 10/);
  });

  it('trims whitespace and drops empty labels before validating count', () => {
    const { store } = makeStore();
    expect(() =>
      store.set({ items: [{ label: '   ' }, { label: 'ok' }, { label: '' }] }),
    ).toThrow(/between 2 and 10/);
  });

  it('truncates over-length labels to MAX_LABEL_CHARS', () => {
    const { store } = makeStore();
    const snapshot = store.set({
      items: [{ label: 'a'.repeat(200) }, { label: 'short' }],
    });
    expect(snapshot.items[0].label.length).toBeLessThanOrEqual(120);
  });

  it('replaces the active list wholesale on a second call', () => {
    const { store } = makeStore();
    const first = store.set({ items: [{ label: 'x' }, { label: 'y' }] });
    const second = store.set({ items: [{ label: 'a' }, { label: 'b' }, { label: 'c' }] });
    expect(second.todoId).not.toBe(first.todoId);
    expect(second.items).toHaveLength(3);
  });
});

describe('TodoRunStore.update', () => {
  it('applies a batched update and returns the new snapshot + applied deltas', () => {
    const { store, onUpdate } = makeStore();
    const snapshot = store.set({ items: [{ label: 'a' }, { label: 'b' }] });
    const [firstId, secondId] = snapshot.items.map((i) => i.id);
    const { snapshot: next, applied } = store.update({
      todoId: snapshot.todoId,
      updates: [
        { id: firstId, status: 'done' },
        { id: secondId, status: 'in_progress' },
      ],
    });
    expect(next.items[0].status).toBe('done');
    expect(next.items[1].status).toBe('in_progress');
    expect(applied).toHaveLength(2);
    expect(onUpdate).toHaveBeenCalledTimes(1);
  });

  it('rejects updates before any todo.set', () => {
    const { store } = makeStore();
    expect(() =>
      store.update({ todoId: 'ghost', updates: [{ id: 'x', status: 'done' }] }),
    ).toThrow(/called before todo.set/);
  });

  it('rejects stale todoId (drift guard)', () => {
    const { store } = makeStore();
    const first = store.set({ items: [{ label: 'a' }, { label: 'b' }] });
    store.set({ items: [{ label: 'x' }, { label: 'y' }] });
    expect(() =>
      store.update({ todoId: first.todoId, updates: [{ id: 'any', status: 'done' }] }),
    ).toThrow(/mismatched_todo|active todo is/);
  });

  it('rejects updates that would leave more than one item in_progress', () => {
    const { store } = makeStore();
    const snapshot = store.set({
      items: [{ label: 'a' }, { label: 'b' }, { label: 'c' }],
    });
    const [firstId, secondId] = snapshot.items.map((i) => i.id);
    // first starts in_progress; trying to mark second in_progress too is invalid.
    expect(() =>
      store.update({
        todoId: snapshot.todoId,
        updates: [{ id: secondId, status: 'in_progress' }],
      }),
    ).toThrow(/more than one item in_progress/);
    // Safe form: flip first to done in the same batch.
    const { snapshot: next } = store.update({
      todoId: snapshot.todoId,
      updates: [
        { id: firstId, status: 'done' },
        { id: secondId, status: 'in_progress' },
      ],
    });
    expect(next.items.filter((i) => i.status === 'in_progress')).toHaveLength(1);
  });

  it('rejects unknown item ids', () => {
    const { store } = makeStore();
    const snapshot = store.set({ items: [{ label: 'a' }, { label: 'b' }] });
    expect(() =>
      store.update({
        todoId: snapshot.todoId,
        updates: [{ id: 'not-a-real-id', status: 'done' }],
      }),
    ).toThrow(/not in the active list/);
  });
});
