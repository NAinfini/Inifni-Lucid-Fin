// @vitest-environment jsdom

import { renderHook } from '@testing-library/react';
import { act } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';
import { resetAssetUrlCacheForTests, useAssetUrl } from './useAssetUrl.js';

describe('useAssetUrl', () => {
  beforeEach(() => {
    resetAssetUrlCacheForTests();
  });

  it('returns null when no hash is provided', () => {
    const { result } = renderHook(() => useAssetUrl(undefined, 'image'));

    expect(result.current.url).toBeNull();
    expect(result.current.loading).toBe(false);
  });

  it('builds a URL with the default extension for the asset type', () => {
    const { result } = renderHook(() => useAssetUrl('hash-image', 'image'));

    expect(result.current.url).toBe('lucid-asset://hash-image/image/png');
    expect(result.current.loading).toBe(false);
  });

  it('updates the URL when the hash or extension changes', () => {
    const { result, rerender } = renderHook(({ hash, ext }) => useAssetUrl(hash, 'video', ext), {
      initialProps: { hash: 'hash-video', ext: undefined as string | undefined },
    });

    expect(result.current.url).toBe('lucid-asset://hash-video/video/mp4');

    rerender({ hash: 'hash-video-2', ext: 'mov' });

    expect(result.current.url).toBe('lucid-asset://hash-video-2/video/mov');
    expect(result.current.loading).toBe(false);
  });

  it('stops returning a URL for the same asset after a load failure until the key changes', () => {
    const { result, rerender } = renderHook(({ hash, ext }) => useAssetUrl(hash, 'image', ext), {
      initialProps: { hash: 'broken-hash', ext: 'png' },
    });

    expect(result.current.url).toBe('lucid-asset://broken-hash/image/png');

    act(() => {
      result.current.markFailed();
    });

    expect(result.current.url).toBeNull();

    rerender({ hash: 'broken-hash', ext: 'png' });
    expect(result.current.url).toBeNull();

    rerender({ hash: 'fresh-hash', ext: 'png' });
    expect(result.current.url).toBe('lucid-asset://fresh-hash/image/png');
  });
});
