import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

const APP_ROOT = path.join(os.homedir(), '.lucid-fin');

/**
 * Resolve a path and verify it falls within one of the allowed root
 * directories. Returns the resolved absolute path on success; throws
 * if the path is outside every allowed root.
 *
 * This is the single choke-point for all IPC path containment checks.
 */
export function assertSafePath(filePath: string, allowedRoots: string[]): string {
  let resolved = path.resolve(filePath);
  try {
    resolved = fs.realpathSync(resolved);
  } catch {
    // File may not exist yet — string-level check is still applied
  }
  const normalizedRoots = allowedRoots.map((r) => path.resolve(r));
  for (const root of normalizedRoots) {
    if (resolved === root || resolved.startsWith(root + path.sep)) {
      return resolved;
    }
  }
  throw new Error(`Path outside allowed directories: ${resolved}`);
}

/**
 * Standard set of safe roots for programmatic (non-dialog) paths.
 * Handlers that accept user-dialog-selected paths should skip this
 * check entirely since the user explicitly chose the location.
 */
export function getSafeRoots(extras: string[] = []): string[] {
  return [APP_ROOT, os.tmpdir(), ...extras];
}

/**
 * Like getSafeRoots but includes the CAS assets root.
 */
export function getImportSafeRoots(assetsRoot: string): string[] {
  return getSafeRoots([assetsRoot]);
}

/** SQLite file header magic bytes (first 16 bytes of every valid SQLite DB). */
const SQLITE_MAGIC = 'SQLite format 3\0';

/**
 * Validate that a file begins with the SQLite header magic string.
 * Reads only the first 16 bytes, so cost is negligible.
 */
export async function assertSqliteHeader(filePath: string): Promise<void> {
  const fsp = await import('node:fs/promises');
  const fh = await fsp.open(filePath, 'r');
  try {
    const buf = Buffer.alloc(16);
    await fh.read(buf, 0, 16, 0);
    if (buf.toString('ascii') !== SQLITE_MAGIC) {
      throw new Error('File is not a valid SQLite database');
    }
  } finally {
    await fh.close();
  }
}
