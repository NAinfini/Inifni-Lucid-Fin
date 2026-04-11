import { useState, useEffect } from 'react';

const cache = new Map<string, string>();

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
): { url: string | null; loading: boolean } {
  const resolvedExt = ext || DEFAULT_EXT[type] || 'bin';

  const [url, setUrl] = useState<string | null>(() => {
    if (!hash) return null;
    const cacheKey = `${hash}:${type}:${resolvedExt}`;
    if (cache.has(cacheKey)) return cache.get(cacheKey)!;
    const assetUrl = `lucid-asset://${hash}/${type}/${resolvedExt}`;
    cache.set(cacheKey, assetUrl);
    return assetUrl;
  });

  useEffect(() => {
    if (!hash) {
      setUrl(null);
      return;
    }
    const assetUrl = `lucid-asset://${hash}/${type}/${resolvedExt}`;
    cache.set(`${hash}:${type}:${resolvedExt}`, assetUrl);
    setUrl(assetUrl);
  }, [hash, type, resolvedExt]);

  return { url, loading: false };
}
