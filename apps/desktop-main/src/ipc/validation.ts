import path from 'node:path';
import fs from 'node:fs';

/** Ensure resolved path stays within the allowed root directory */
export function assertWithinRoot(root: string, target: string): string {
  const resolved = path.resolve(root, target);
  const resolvedRoot = path.resolve(root);
  if (!resolved.startsWith(resolvedRoot + path.sep) && resolved !== resolvedRoot) {
    throw new Error(`Path traversal detected: ${target}`);
  }
  // Defense-in-depth: verify canonical path after symlink resolution
  // Only check if both paths actually exist on disk
  try {
    const realTarget = fs.realpathSync(resolved);
    const realRoot = fs.realpathSync(resolvedRoot);
    if (!realTarget.startsWith(realRoot + path.sep) && realTarget !== realRoot) {
      throw new Error(`Path traversal via symlink detected: ${target}`);
    }
  } catch (e) {
    // If paths don't exist yet (pre-creation validation), the string check above is sufficient
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
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
