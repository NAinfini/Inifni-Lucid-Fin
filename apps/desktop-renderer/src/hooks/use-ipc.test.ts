// @vitest-environment jsdom

import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useIpc } from './use-ipc.js';

describe('useIpc', () => {
  afterEach(() => {
    Reflect.deleteProperty(window, 'lucidAPI');
  });

  it('calls the requested IPC handler with arguments', async () => {
    const sum = vi.fn(async (...values: unknown[]) =>
      values.reduce<number>((acc, value) => acc + Number(value), 0),
    );
    window.lucidAPI = {
      math: { sum },
    } as never;

    const { result } = renderHook(() => useIpc<number>('math', 'sum'));

    await expect(result.current(2, 3, 5)).resolves.toBe(10);
    expect(sum).toHaveBeenCalledWith(2, 3, 5);
  });

  it('throws when the IPC action is unavailable', async () => {
    window.lucidAPI = {
      math: {},
    } as never;

    const { result } = renderHook(() => useIpc<number>('math', 'missing'));

    await expect(result.current()).rejects.toThrow('IPC not available: math.missing');
  });

  it('keeps the callback stable when domain and action do not change', () => {
    window.lucidAPI = {
      system: { ping: vi.fn(async () => 'pong') },
    } as never;

    const { result, rerender } = renderHook(
      ({ domain, action }) => useIpc<string>(domain, action),
      {
        initialProps: { domain: 'system', action: 'ping' },
      },
    );

    const firstRef = result.current;
    rerender({ domain: 'system', action: 'ping' });

    expect(result.current).toBe(firstRef);
  });
});
