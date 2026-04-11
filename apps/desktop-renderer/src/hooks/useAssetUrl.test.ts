// @vitest-environment jsdom

import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useAssetUrl } from './useAssetUrl.js';

describe('useAssetUrl', () => {
  it('returns null when no hash is provided', () => {
    const { result } = renderHook(() => useAssetUrl(undefined, 'image'));

    expect(result.current).toEqual({ url: null, loading: false });
  });

  it('builds a URL with the default extension for the asset type', () => {
    const { result } = renderHook(() => useAssetUrl('hash-image', 'image'));

    expect(result.current).toEqual({
      url: 'lucid-asset://hash-image/image/png',
      loading: false,
    });
  });

  it('updates the URL when the hash or extension changes', () => {
    const { result, rerender } = renderHook(
      ({ hash, ext }) => useAssetUrl(hash, 'video', ext),
      {
        initialProps: { hash: 'hash-video', ext: undefined as string | undefined },
      },
    );

    expect(result.current.url).toBe('lucid-asset://hash-video/video/mp4');

    rerender({ hash: 'hash-video-2', ext: 'mov' });

    expect(result.current.url).toBe('lucid-asset://hash-video-2/video/mov');
    expect(result.current.loading).toBe(false);
  });
});
