import path from 'node:path';

/** Ensure resolved path stays within the allowed root directory */
export function assertWithinRoot(root: string, target: string): string {
  const resolved = path.resolve(root, target);
  if (!resolved.startsWith(path.resolve(root) + path.sep) && resolved !== path.resolve(root)) {
    throw new Error(`Path traversal detected: ${target}`);
  }
  return resolved;
}

/** Sanitize a filename component — strip path separators, traversal, and control characters */
export function sanitizeFilename(name: string): string {
  return (
    name
      .replace(/[<>:"/\\|?*]/g, '_')
      .replace(/[^\x20-\x7E\x80-\uFFFF]/g, '_')
      .replace(/\.\./g, '_')
      .trim() || 'untitled'
  );
}

/** Validate AssetType is one of the allowed values */
export function assertValidAssetType(type: string): asserts type is 'image' | 'video' | 'audio' {
  if (!['image', 'video', 'audio'].includes(type)) {
    throw new Error(`Invalid asset type: ${type}`);
  }
}
