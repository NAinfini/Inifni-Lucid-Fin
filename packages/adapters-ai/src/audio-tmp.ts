import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';

/**
 * Write a buffer to a deterministic tmp file path and return the path.
 *
 * @param buffer - The audio data to write.
 * @param prefix - Filename prefix (e.g. "tts-11labs", "sfx-11labs"). Must not
 *   contain path separators — only alphanumeric, hyphens, and underscores.
 * @param ext    - File extension without leading dot. Defaults to "mp3".
 * @param precomputedHash - Optional pre-computed hash to avoid redundant SHA-256.
 * @returns Absolute path to the written file, always inside os.tmpdir().
 */
export async function writeTmpAudioFile(buffer: Buffer, prefix: string, ext = 'mp3', precomputedHash?: string): Promise<string> {
  const hash = precomputedHash ?? createHash('sha256').update(buffer).digest('hex').slice(0, 16);
  const filename = `${prefix}-${hash}.${ext}`;
  const outPath = join(tmpdir(), filename);

  // Path-traversal guard: reject any path that escapes tmpdir.
  const tmpBase = resolve(tmpdir());
  const resolved = resolve(outPath);
  if (!resolved.startsWith(tmpBase + sep) && resolved !== tmpBase) {
    throw new Error(`Unsafe audio tmp path: ${resolved}`);
  }

  await writeFile(outPath, buffer);
  return outPath;
}
