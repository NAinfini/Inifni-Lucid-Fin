import { createHash, randomUUID } from 'node:crypto';
import { link, open, unlink } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalJson } from '../packages/target-contracts/src/index.js';
import {
  createLegacyBrowserStateSnapshot,
  type LegacyBrowserStateTrustedCapture,
} from '../packages/target-storage/src/migration/legacy-browser-state.js';

export interface LegacyBrowserStateSealReport {
  readonly schema: 'lucid-fin.legacy-browser-state-seal-report/v2';
  readonly snapshotFingerprint: string;
  readonly presentCount: number;
  readonly absentCount: number;
  readonly byteLength: string;
  readonly sha256: string;
  readonly publication: 'atomic_hard_link_no_replace';
  readonly ok: true;
}

const TEMPORARY_FILE_ATTEMPTS = 16;

function codeOf(error: unknown): string | undefined {
  if (error === null || typeof error !== 'object' || !('code' in error)) return undefined;
  const code = (error as { readonly code?: unknown }).code;
  return typeof code === 'string' ? code : undefined;
}

function noReplaceUnavailable(error: unknown): boolean {
  return ['EINVAL', 'EMLINK', 'ENOSYS', 'ENOTSUP', 'EOPNOTSUPP', 'EPERM', 'EXDEV'].includes(
    codeOf(error) ?? '',
  );
}

async function createExclusiveTemporaryFile(outputPath: string) {
  const directory = dirname(outputPath);
  const outputName = basename(outputPath);
  for (let attempt = 0; attempt < TEMPORARY_FILE_ATTEMPTS; attempt += 1) {
    const temporaryPath = join(directory, `.${outputName}.${randomUUID()}.tmp`);
    try {
      return { temporaryPath, handle: await open(temporaryPath, 'wx', 0o600) };
    } catch (error) {
      if (codeOf(error) === 'EEXIST') continue;
      throw error;
    }
  }
  throw new Error('Could not create an exclusive random temporary evidence file');
}

/**
 * Publishes through link(2), whose destination creation is no-replace and atomic within this directory.
 * There is intentionally no rename fallback: if hard-link publication is unavailable or denied, sealing
 * fails closed. Node has no portable directory-handle/no-follow primitive for hostile same-user writers;
 * Gate A must use the protected parent described in the approval evidence.
 */
async function writeAndPublishNoReplace(bytes: Uint8Array, outputPath: string): Promise<void> {
  const { temporaryPath, handle } = await createExclusiveTemporaryFile(outputPath);
  let openHandle: typeof handle | undefined = handle;
  let published = false;
  let outcome:
    { readonly kind: 'succeeded' } | { readonly kind: 'failed'; readonly cause: unknown };
  try {
    await openHandle.writeFile(bytes);
    await openHandle.sync();
    await openHandle.close();
    openHandle = undefined;
    try {
      await link(temporaryPath, outputPath);
      published = true;
    } catch (error) {
      if (noReplaceUnavailable(error)) {
        throw new Error(
          'Atomic no-replace publication is unavailable or denied; browser-state evidence was not published',
          { cause: error },
        );
      }
      throw error;
    }
    outcome = { kind: 'succeeded' };
  } catch (error) {
    outcome = { kind: 'failed', cause: error };
  }

  const cleanupFailures: unknown[] = [];
  if (openHandle !== undefined) {
    try {
      await openHandle.close();
    } catch (closeError) {
      cleanupFailures.push(closeError);
    }
  }
  try {
    await unlink(temporaryPath);
  } catch (cleanupError) {
    if (codeOf(cleanupError) !== 'ENOENT') {
      if (published) {
        cleanupFailures.push(
          new Error('Evidence was published but its private temporary file could not be removed', {
            cause: cleanupError,
          }),
        );
      } else {
        cleanupFailures.push(cleanupError);
      }
    }
  }

  if (outcome.kind === 'failed') {
    if (cleanupFailures.length > 0) {
      throw new AggregateError(
        [outcome.cause, ...cleanupFailures],
        'Browser-state evidence processing failed and temporary-file cleanup also failed',
      );
    }
    throw outcome.cause;
  }
  if (cleanupFailures.length === 1) throw cleanupFailures[0];
  if (cleanupFailures.length > 0) {
    throw new AggregateError(
      cleanupFailures,
      'Browser-state evidence temporary-file cleanup failed',
    );
  }
}

/** Seals one result from the trusted reader boundary; it never reads Chromium or caller-supplied JSON. */
export async function sealLegacyBrowserState(
  capture: LegacyBrowserStateTrustedCapture,
  outputPath: string,
): Promise<LegacyBrowserStateSealReport> {
  const snapshot = createLegacyBrowserStateSnapshot(capture);
  const bytes = Buffer.from(`${canonicalJson(snapshot)}\n`, 'utf8');
  await writeAndPublishNoReplace(bytes, resolve(outputPath));
  const presentCount = snapshot.entries.filter(({ state }) => state === 'present').length;
  return {
    schema: 'lucid-fin.legacy-browser-state-seal-report/v2',
    snapshotFingerprint: snapshot.fingerprint,
    presentCount,
    absentCount: snapshot.entries.length - presentCount,
    byteLength: String(bytes.byteLength),
    sha256: createHash('sha256').update(bytes).digest('hex'),
    publication: 'atomic_hard_link_no_replace',
    ok: true,
  };
}

async function main(): Promise<void> {
  if (process.argv.includes('--apply') || process.argv.includes('--cutover')) {
    throw new Error('This command only seals browser-state evidence');
  }
  throw new Error(
    'Gate A trusted browser collection is intentionally not implemented. This command refuses caller-supplied localStorage JSON; use captureLegacyBrowserState only from the approved trusted collector boundary.',
  );
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
