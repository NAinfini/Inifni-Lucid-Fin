// @vitest-environment jsdom

import React from 'react';
import { configureStore } from '@reduxjs/toolkit';
import { act, renderHook } from '@testing-library/react';
import { Provider } from 'react-redux';
import { afterEach, describe, expect, it } from 'vitest';
import { toastActionRegistry, toastSlice } from '../store/slices/toast.js';
import { useToast } from './use-toast.js';

function createWrapper() {
  const store = configureStore({
    reducer: {
      toast: toastSlice.reducer,
    },
  });

  function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(Provider, { store, children });
  }

  return { store, Wrapper };
}

describe('useToast', () => {
  afterEach(() => {
    toastActionRegistry.clear();
  });

  it('enqueues variant-specific toasts', () => {
    const { store, Wrapper } = createWrapper();
    const { result } = renderHook(() => useToast(), { wrapper: Wrapper });

    act(() => {
      result.current.info({ title: 'Info title' });
      result.current.success({ title: 'Success title' });
      result.current.warning({ title: 'Warning title' });
      result.current.error({ title: 'Error title' });
    });

    expect(store.getState().toast.items.map((toast) => toast.variant)).toEqual([
      'info',
      'success',
      'warning',
      'error',
    ]);
  });

  it('supports generic show, dismiss, and clear flows', () => {
    const { store, Wrapper } = createWrapper();
    const { result } = renderHook(() => useToast(), { wrapper: Wrapper });

    act(() => {
      result.current.showToast({
        title: 'With action',
        variant: 'success',
        actionLabel: 'Retry',
        onAction: () => undefined,
      });
    });

    const firstToast = store.getState().toast.items[0];
    expect(firstToast).toEqual(
      expect.objectContaining({
        title: 'With action',
        variant: 'success',
        actionLabel: 'Retry',
      }),
    );
    expect(toastActionRegistry.has(firstToast!.id)).toBe(true);

    act(() => {
      result.current.dismiss(firstToast!.id);
    });

    expect(store.getState().toast.items).toEqual([]);
    expect(toastActionRegistry.has(firstToast!.id)).toBe(false);

    act(() => {
      result.current.info({ title: 'A' });
      result.current.warning({ title: 'B' });
      result.current.clear();
    });

    expect(store.getState().toast.items).toEqual([]);
    expect(toastActionRegistry.size).toBe(0);
  });
});
