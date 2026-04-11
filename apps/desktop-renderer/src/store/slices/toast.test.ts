import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  clearToasts,
  dismissToast,
  enqueueToast,
  toastActionRegistry,
  toastSlice,
} from './toast.js';

afterEach(() => {
  toastActionRegistry.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('toast slice', () => {
  it('has the expected initial state', () => {
    expect(toastSlice.reducer(undefined, { type: '@@INIT' })).toEqual({
      items: [],
    });
  });

  it('exports action creators with prepared payloads', () => {
    vi.spyOn(Date, 'now').mockReturnValue(100);
    vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue(
      '00000000-0000-4000-8000-000000000001',
    );
    const onAction = vi.fn();

    const action = enqueueToast({
      title: 'Saved',
      message: 'Project saved',
      variant: 'success',
      durationMs: 9000,
      actionLabel: 'Undo',
      onAction,
    });

    expect(action).toMatchObject({
      type: 'toast/enqueueToast',
      payload: {
        id: '00000000-0000-4000-8000-000000000001',
        title: 'Saved',
        message: 'Project saved',
        variant: 'success',
        durationMs: 9000,
        createdAt: 100,
        actionLabel: 'Undo',
      },
    });
    expect(dismissToast('00000000-0000-4000-8000-000000000001')).toMatchObject({
      type: 'toast/dismissToast',
      payload: '00000000-0000-4000-8000-000000000001',
    });
    expect(clearToasts()).toMatchObject({
      type: 'toast/clearToasts',
    });
    expect(toastActionRegistry.get('00000000-0000-4000-8000-000000000001')).toBe(onAction);
  });

  it('uses default variant and duration when omitted', () => {
    vi.spyOn(Date, 'now').mockReturnValue(200);
    vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue(
      '00000000-0000-4000-8000-000000000002',
    );

    const action = enqueueToast({ title: 'Info only' });

    expect(action.payload).toMatchObject({
      id: '00000000-0000-4000-8000-000000000002',
      title: 'Info only',
      variant: 'info',
      durationMs: 3500,
      createdAt: 200,
    });
  });

  it('falls back to a timestamp-based id when crypto.randomUUID is unavailable', () => {
    vi.stubGlobal('crypto', undefined);
    vi.spyOn(Date, 'now').mockReturnValue(1234);
    vi.spyOn(Math, 'random').mockReturnValue(0.25);

    const action = enqueueToast({ title: 'Fallback id' });

    expect(action.payload.id.startsWith('1234-')).toBe(true);
    expect(action.payload.createdAt).toBe(1234);
  });

  it('enqueues toasts, registers callbacks, dismisses by id, and clears all toasts', () => {
    vi.spyOn(Date, 'now').mockReturnValue(300);
    vi.spyOn(globalThis.crypto, 'randomUUID')
      .mockReturnValueOnce('00000000-0000-4000-8000-000000000003')
      .mockReturnValueOnce('00000000-0000-4000-8000-000000000004');

    let state = toastSlice.reducer(
      undefined,
      enqueueToast({
        title: 'With action',
        actionLabel: 'Retry',
        onAction: vi.fn(),
      }),
    );
    state = toastSlice.reducer(
      state,
      enqueueToast({
        title: 'Warning',
        variant: 'warning',
      }),
    );

    expect(state.items.map((toast) => toast.id)).toEqual([
      '00000000-0000-4000-8000-000000000003',
      '00000000-0000-4000-8000-000000000004',
    ]);
    expect(toastActionRegistry.has('00000000-0000-4000-8000-000000000003')).toBe(true);
    expect(toastActionRegistry.has('00000000-0000-4000-8000-000000000004')).toBe(false);

    state = toastSlice.reducer(state, dismissToast('00000000-0000-4000-8000-000000000003'));
    state = toastSlice.reducer(state, dismissToast('missing'));

    expect(state.items.map((toast) => toast.id)).toEqual(['00000000-0000-4000-8000-000000000004']);
    expect(toastActionRegistry.has('00000000-0000-4000-8000-000000000003')).toBe(false);

    state = toastSlice.reducer(state, clearToasts());
    expect(state.items).toEqual([]);
    expect(toastActionRegistry.size).toBe(0);
  });
});
