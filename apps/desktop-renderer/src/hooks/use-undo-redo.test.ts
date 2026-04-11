// @vitest-environment jsdom

import React from 'react';
import { configureStore } from '@reduxjs/toolkit';
import { act, renderHook } from '@testing-library/react';
import { Provider } from 'react-redux';
import { describe, expect, it } from 'vitest';
import { useUndoRedo } from './use-undo-redo.js';

function createWrapper() {
  const store = configureStore({
    reducer: (
      state = { actions: [] as string[] },
      action: { type: string },
    ) => ({
      actions: [...state.actions, action.type],
    }),
  });

  function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(Provider, { store, children });
  }

  return { store, Wrapper };
}

describe('useUndoRedo', () => {
  it('dispatches undo and redo shortcuts and prevents default browser behavior', () => {
    const { store, Wrapper } = createWrapper();
    renderHook(() => useUndoRedo(), { wrapper: Wrapper });

    const undoEvent = new KeyboardEvent('keydown', {
      key: 'z',
      ctrlKey: true,
      cancelable: true,
    });
    const redoEvent = new KeyboardEvent('keydown', {
      key: 'y',
      metaKey: true,
      cancelable: true,
    });
    const shiftRedoEvent = new KeyboardEvent('keydown', {
      key: 'z',
      ctrlKey: true,
      shiftKey: true,
      cancelable: true,
    });

    act(() => {
      window.dispatchEvent(undoEvent);
      window.dispatchEvent(redoEvent);
      window.dispatchEvent(shiftRedoEvent);
    });

    expect(store.getState().actions).toEqual(
      expect.arrayContaining(['undo/undo', 'undo/redo']),
    );
    expect(undoEvent.defaultPrevented).toBe(true);
    expect(redoEvent.defaultPrevented).toBe(true);
    expect(shiftRedoEvent.defaultPrevented).toBe(true);
  });

  it('ignores key presses without a modifier key', () => {
    const { store, Wrapper } = createWrapper();
    renderHook(() => useUndoRedo(), { wrapper: Wrapper });
    const beforeCount = store.getState().actions.length;

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', cancelable: true }));
    });

    expect(store.getState().actions).toHaveLength(beforeCount);
  });

  it('removes the keydown listener on unmount', () => {
    const { store, Wrapper } = createWrapper();
    const { unmount } = renderHook(() => useUndoRedo(), { wrapper: Wrapper });
    const beforeCount = store.getState().actions.length;

    unmount();

    act(() => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, cancelable: true }),
      );
    });

    expect(store.getState().actions).toHaveLength(beforeCount);
  });
});
