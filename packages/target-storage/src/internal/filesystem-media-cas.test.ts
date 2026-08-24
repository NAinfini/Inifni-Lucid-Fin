import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createFilesystemMediaCas } from './filesystem-media-cas.js';

const directories: string[] = [];

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

async function* chunks(...values: Uint8Array[]): AsyncIterable<Uint8Array> {
  yield* values;
}

async function collect(bytes: AsyncIterable<Uint8Array>): Promise<Buffer> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of bytes) chunks.push(chunk);
  return Buffer.concat(chunks);
}

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { force: true, recursive: true })),
  );
});

describe('filesystem Media CAS', () => {
  it('streams, verifies, and atomically deduplicates immutable bytes without exposing paths', async () => {
    const root = await mkdtemp(join(tmpdir(), 'lucid-fin-media-cas-'));
    directories.push(root);
    const cas = createFilesystemMediaCas(root);
    const first = Buffer.from('immutable-media-bytes');
    const expected = { hash: sha256(first), byteLength: first.byteLength };

    const results = await Promise.all([
      cas.putVerified(expected, chunks(first.subarray(0, 8), first.subarray(8))),
      cas.putVerified(expected, chunks(first)),
    ]);

    expect(results.map(({ disposition }) => disposition).sort()).toEqual(['created', 'existing']);
    expect(
      results.every(
        (result) => Object.keys(result).sort().join(',') === 'byteLength,disposition,hash',
      ),
    ).toBe(true);
    expect(await cas.stat(expected.hash)).toEqual(expected);
    await expect(cas.verify(expected)).resolves.toBeUndefined();
    expect(await readFile(join(root, 'sha256', expected.hash.slice(0, 2), expected.hash))).toEqual(
      first,
    );
    expect(await readdir(join(root, '.incoming'))).toEqual([]);
  });

  it('rejects mismatched streams and never overwrites an existing final object', async () => {
    const root = await mkdtemp(join(tmpdir(), 'lucid-fin-media-cas-corrupt-'));
    directories.push(root);
    const cas = createFilesystemMediaCas(root);
    const expectedBytes = Buffer.from('expected');
    const expected = { hash: sha256(expectedBytes), byteLength: expectedBytes.byteLength };

    await expect(cas.putVerified(expected, chunks(Buffer.from('wrong')))).rejects.toThrow();
    expect(await cas.stat(expected.hash)).toBeNull();

    const finalDirectory = join(root, 'sha256', expected.hash.slice(0, 2));
    await mkdir(finalDirectory, { recursive: true });
    const finalPath = join(finalDirectory, expected.hash);
    const corruptBytes = Buffer.from('corrupt!');
    await writeFile(finalPath, corruptBytes, { flag: 'wx' });

    await expect(cas.putVerified(expected, chunks(expectedBytes))).rejects.toThrow();
    expect(await readFile(finalPath)).toEqual(corruptBytes);
    expect(await readdir(join(root, '.incoming'))).toEqual([]);
  });

  it('opens verified bytes lazily, rejects before the first byte, and can be reiterated', async () => {
    const root = await mkdtemp(join(tmpdir(), 'lucid-fin-media-cas-open-'));
    directories.push(root);
    const cas = createFilesystemMediaCas(root);
    const bytes = Buffer.alloc(96 * 1024, 7);
    const expected = { hash: sha256(bytes), byteLength: bytes.byteLength };
    await cas.putVerified(expected, chunks(bytes));

    const verified = cas.openVerified(expected);
    expect(await collect(verified)).toEqual(bytes);
    expect(await collect(verified)).toEqual(bytes);

    const iterator = cas.openVerified(expected)[Symbol.asyncIterator]();
    expect((await iterator.next()).done).toBe(false);
    await iterator.return?.();
    await rm(root, { force: true, recursive: true });
    directories.pop();

    const missing = cas.openVerified(expected)[Symbol.asyncIterator]();
    await expect(missing.next()).rejects.toMatchObject({ code: 'CORRUPT_DATA' });
  });

  it('detects tail corruption before yielding the first chunk', async () => {
    const root = await mkdtemp(join(tmpdir(), 'lucid-fin-media-cas-tail-'));
    directories.push(root);
    const cas = createFilesystemMediaCas(root);
    const bytes = Buffer.alloc(96 * 1024, 3);
    const expected = { hash: sha256(bytes), byteLength: bytes.byteLength };
    await cas.putVerified(expected, chunks(bytes));
    const path = join(root, 'sha256', expected.hash.slice(0, 2), expected.hash);
    const corrupted = Buffer.from(bytes);
    corrupted[corrupted.length - 1] ^= 1;
    await writeFile(path, corrupted);

    const iterator = cas.openVerified(expected)[Symbol.asyncIterator]();
    await expect(iterator.next()).rejects.toMatchObject({ code: 'CORRUPT_DATA' });
  });

  it('rejects a non-file object without exposing its filesystem path', async () => {
    const root = await mkdtemp(join(tmpdir(), 'lucid-fin-media-cas-non-file-'));
    directories.push(root);
    const cas = createFilesystemMediaCas(root);
    const bytes = Buffer.from('directory-is-not-media');
    const expected = { hash: sha256(bytes), byteLength: bytes.byteLength };
    await mkdir(join(root, 'sha256', expected.hash.slice(0, 2), expected.hash), {
      recursive: true,
    });

    const iterator = cas.openVerified(expected)[Symbol.asyncIterator]();
    const error = await iterator.next().catch((cause: unknown) => cause);
    expect(error).toMatchObject({ code: 'CORRUPT_DATA' });
    expect((error as Error).message).not.toContain(root);
  });
});
