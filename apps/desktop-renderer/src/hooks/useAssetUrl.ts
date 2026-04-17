import { useCallback, useEffect, useState } from 'react';
// eslint-disable-next-line no-restricted-imports -- Phase C (LRUCache relocation to shared-utils) will fix this
import { LRUCache } from '@lucid-fin/application/dist/lru-cache.js';

const cache = new LRUCache<string, string>(5000);
const failedKeys = new LRUCache<string, true>(2000);

const DEFAULT_EXT: Record<string, string> = {
  image: 'png',
  video: 'mp4',
  audio: 'mp3',
};

/**
 * Builds a `lucid-asset://` URL for the given CAS hash.
 *
 * The `ext` parameter is a *hint* — the protocol handler reads `meta.json`
 * and falls back to common extensions, so the caller does not need to know
 * the exact stored format.  When omitted, a sensible default is used.
 */
export function useAssetUrl(
  hash: string | undefined,
  type: 'image' | 'video' | 'audio',
  ext?: string,
): { url: string | null; loading: boolean; markFailed: () => void } {
  const resolvedExt = ext || DEFAULT_EXT[type] || 'bin';
  const cacheKey = hash ? `${hash}:${type}:${resolvedExt}` : null;

  const [url, setUrl] = useState<string | null>(() => {
    if (!hash || !cacheKey || failedKeys.has(cacheKey)) return null;
    if (cache.has(cacheKey)) return cache.get(cacheKey)!;
    const assetUrl = `lucid-asset://${hash}/${type}/${resolvedExt}`;
    cache.set(cacheKey, assetUrl);
    return assetUrl;
  });

  const markFailed = useCallback(() => {
    if (!cacheKey) return;
    failedKeys.set(cacheKey, true);
    cache.delete(cacheKey);
    setUrl(null);
  }, [cacheKey]);

  useEffect(() => {
    if (!hash || !cacheKey) {
      setUrl(null);
      return;
    }
    if (failedKeys.has(cacheKey)) {
      setUrl(null);
      return;
    }
    const assetUrl = `lucid-asset://${hash}/${type}/${resolvedExt}`;
    cache.set(cacheKey, assetUrl);
    setUrl(assetUrl);
  }, [cacheKey, hash, resolvedExt, type]);

  return { url, loading: false, markFailed };
}

export function resetAssetUrlCacheForTests() {
  cache.clear();
  failedKeys.clear();
}
