import { useState, useEffect } from 'react';

const cache = new Map<string, string>();

export function useAssetUrl(
  hash: string | undefined,
  type: 'image' | 'video' | 'audio',
  ext: string,
): { url: string | null; loading: boolean } {
  const [url, setUrl] = useState<string | null>(() => {
    if (!hash) return null;
    const cacheKey = `${hash}:${type}:${ext}`;
    if (cache.has(cacheKey)) return cache.get(cacheKey)!;
    const assetUrl = `lucid-asset://${hash}/${type}/${ext}`;
    cache.set(cacheKey, assetUrl);
    return assetUrl;
  });

  useEffect(() => {
    if (!hash) {
      setUrl(null);
      return;
    }
    const assetUrl = `lucid-asset://${hash}/${type}/${ext}`;
    cache.set(`${hash}:${type}:${ext}`, assetUrl);
    setUrl(assetUrl);
  }, [hash, type, ext]);

  return { url, loading: false };
}
