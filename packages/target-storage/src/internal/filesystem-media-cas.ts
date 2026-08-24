import { createHash, randomUUID } from 'node:crypto';
import { link, mkdir, open, unlink, type FileHandle } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import {
  CountSchema,
  Sha256Schema,
  parseCanonical,
  strictObject,
} from '@lucid-fin/target-contracts';
import type { MediaCas, MediaCasExpectedObject, MediaCasPutResult } from '../kernel/media-cas.js';
import { TargetStorageError } from '../kernel/errors.js';

const ExpectedObjectSchema = strictObject({
  hash: Sha256Schema,
  byteLength: CountSchema,
});

function expectedObject(value: MediaCasExpectedObject): MediaCasExpectedObject {
  return parseCanonical(ExpectedObjectSchema, value);
}

function finalPath(rootPath: string, hash: string): string {
  return join(rootPath, 'sha256', hash.slice(0, 2), hash);
}

async function removeOwnTemporary(path: string): Promise<void> {
  await unlink(path).catch((cause: NodeJS.ErrnoException) => {
    if (cause.code !== 'ENOENT') throw cause;
  });
}

async function inspectOpenFile(handle: FileHandle): Promise<{ byteLength: number; hash: string }> {
  const info = await handle.stat();
  if (!info.isFile()) {
    throw new TargetStorageError('CORRUPT_DATA', 'Media CAS object is not a regular file');
  }
  const digest = createHash('sha256');
  const buffer = Buffer.allocUnsafe(64 * 1024);
  let byteLength = 0;
  while (true) {
    const { bytesRead } = await handle.read(buffer, 0, buffer.byteLength, byteLength);
    if (bytesRead === 0) break;
    digest.update(buffer.subarray(0, bytesRead));
    byteLength += bytesRead;
  }
  return { byteLength, hash: digest.digest('hex') };
}

async function inspectFile(path: string): Promise<{ byteLength: number; hash: string }> {
  const handle = await open(path, 'r');
  try {
    return await inspectOpenFile(handle);
  } finally {
    await handle.close();
  }
}

function assertActual(
  expected: MediaCasExpectedObject,
  actual: { readonly hash: string; readonly byteLength: number },
): void {
  if (actual.hash !== expected.hash || actual.byteLength !== expected.byteLength) {
    throw new TargetStorageError(
      'CORRUPT_DATA',
      `Media CAS object ${expected.hash} does not match its expected bytes`,
    );
  }
}

export function createFilesystemMediaCas(rootPathInput: string): MediaCas {
  const rootPath = resolve(rootPathInput);
  const incomingDirectory = join(rootPath, '.incoming');

  const cas: MediaCas = {
    async putVerified(expectedInput, bytes) {
      const expected = expectedObject(expectedInput);
      const destination = finalPath(rootPath, expected.hash);
      await Promise.all([
        mkdir(incomingDirectory, { recursive: true }),
        mkdir(join(rootPath, 'sha256', expected.hash.slice(0, 2)), { recursive: true }),
      ]);
      const temporaryPath = join(incomingDirectory, `${randomUUID()}.part`);
      const handle = await open(temporaryPath, 'wx', 0o600);
      let handleOpen = true;
      try {
        const digest = createHash('sha256');
        let byteLength = 0;
        for await (const chunk of bytes) {
          if (!(chunk instanceof Uint8Array)) {
            throw new TargetStorageError('INVALID_REQUEST', 'Media byte stream is invalid');
          }
          if (byteLength + chunk.byteLength > expected.byteLength) {
            throw new TargetStorageError(
              'INVALID_REQUEST',
              'Media byte stream is longer than expected',
            );
          }
          const buffer = Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength);
          let offset = 0;
          while (offset < buffer.byteLength) {
            const { bytesWritten } = await handle.write(
              buffer,
              offset,
              buffer.byteLength - offset,
              null,
            );
            offset += bytesWritten;
          }
          digest.update(buffer);
          byteLength += buffer.byteLength;
        }
        const actual = { byteLength, hash: digest.digest('hex') };
        assertActual(expected, actual);
        await handle.sync();
        await handle.close();
        handleOpen = false;

        try {
          await link(temporaryPath, destination);
          await removeOwnTemporary(temporaryPath);
          return { ...expected, disposition: 'created' } satisfies MediaCasPutResult;
        } catch (cause) {
          if ((cause as NodeJS.ErrnoException).code !== 'EEXIST') throw cause;
          assertActual(expected, await inspectFile(destination));
          await removeOwnTemporary(temporaryPath);
          return { ...expected, disposition: 'existing' } satisfies MediaCasPutResult;
        }
      } catch (cause) {
        if (handleOpen) await handle.close().catch(() => undefined);
        await removeOwnTemporary(temporaryPath);
        throw cause;
      }
    },

    async stat(hashInput) {
      const hash = parseCanonical(Sha256Schema, hashInput);
      try {
        const handle = await open(finalPath(rootPath, hash), 'r');
        try {
          const info = await handle.stat();
          if (!info.isFile()) {
            throw new TargetStorageError('CORRUPT_DATA', `Media CAS object ${hash} is not a file`);
          }
          return expectedObject({ hash, byteLength: info.size });
        } finally {
          await handle.close();
        }
      } catch (cause) {
        if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw cause;
      }
    },

    async verify(expectedInput) {
      const expected = expectedObject(expectedInput);
      try {
        assertActual(expected, await inspectFile(finalPath(rootPath, expected.hash)));
      } catch (cause) {
        if ((cause as NodeJS.ErrnoException).code === 'ENOENT') {
          throw new TargetStorageError(
            'CORRUPT_DATA',
            `Media CAS object ${expected.hash} is missing`,
            { cause },
          );
        }
        throw cause;
      }
    },

    openVerified(expectedInput) {
      const expected = expectedObject(expectedInput);
      return {
        async *[Symbol.asyncIterator]() {
          let handle: FileHandle;
          try {
            handle = await open(finalPath(rootPath, expected.hash), 'r');
          } catch {
            throw new TargetStorageError(
              'CORRUPT_DATA',
              `Media CAS object ${expected.hash} is missing or unreadable`,
            );
          }
          try {
            assertActual(expected, await inspectOpenFile(handle));
            const buffer = Buffer.allocUnsafe(64 * 1024);
            let offset = 0;
            while (offset < expected.byteLength) {
              const { bytesRead } = await handle.read(
                buffer,
                0,
                Math.min(buffer.byteLength, expected.byteLength - offset),
                offset,
              );
              if (bytesRead === 0) {
                throw new TargetStorageError(
                  'CORRUPT_DATA',
                  `Media CAS object ${expected.hash} changed while reading`,
                );
              }
              offset += bytesRead;
              yield Uint8Array.from(buffer.subarray(0, bytesRead));
            }
          } finally {
            await handle.close();
          }
        },
      };
    },
  };
  return Object.freeze(cas);
}
