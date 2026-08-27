import { access, mkdtemp, readdir, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import * as fsPromises from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { canonicalJson } from '../packages/target-contracts/src/index.js';
import {
  LEGACY_BROWSER_STATE_KEYS,
  captureLegacyBrowserState,
  parseLegacyBrowserStateSnapshot,
} from '../packages/target-storage/src/migration/legacy-browser-state.js';
import { sealLegacyBrowserState } from './seal-legacy-browser-state.js';

vi.mock('node:fs/promises', { spy: true });

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

function capture() {
  const emptySkills = canonicalJson({ builtInCustoms: {}, builtInNames: {}, customSkills: [] });
  const values = Object.fromEntries(
    LEGACY_BROWSER_STATE_KEYS.map((key) => [key, key === 'lucid-skills-v2' ? emptySkills : null]),
  ) as Readonly<Record<(typeof LEGACY_BROWSER_STATE_KEYS)[number], string | null>>;
  return captureLegacyBrowserState(
    {
      captureRunId: 'seal-run-1',
      captureSessionId: 'seal-session-1',
      chromiumProfile: { platform: 'win32' as const, path: 'C:/Lucid/Profile 1' },
      origin: 'file:///C:/Lucid/app/index.html',
      challenge: 'A'.repeat(43),
      capturedAt: '2026-08-25T12:00:00.000Z',
    },
    (key) => values[key],
  );
}

describe('seal Legacy browser state', () => {
  it('writes one private canonical snapshot without echoing raw values in its report', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'lucid-browser-state-seal-'));
    temporaryDirectories.push(directory);
    const output = join(directory, 'browser-state.json');
    const input = capture();
    const report = await sealLegacyBrowserState(input, output);
    const snapshot = parseLegacyBrowserStateSnapshot(
      JSON.parse(await readFile(output, 'utf8')) as unknown,
    );

    expect(report).toMatchObject({
      presentCount: 1,
      absentCount: 9,
      publication: 'atomic_hard_link_no_replace',
      ok: true,
    });
    expect(snapshot.capture.origin).toBe('opaque:file');
    expect(report.snapshotFingerprint).toBe(snapshot.fingerprint);
    expect(canonicalJson(report)).not.toContain('builtInCustoms');
    expect(canonicalJson(report)).not.toContain('Profile 1');
    await expect(sealLegacyBrowserState(input, output)).rejects.toMatchObject({ code: 'EEXIST' });
  });

  it('blocks a trusted capture error instead of treating it as absent and never creates output', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'lucid-browser-state-seal-'));
    temporaryDirectories.push(directory);
    const output = join(directory, 'browser-state.json');
    const failedCapture = captureLegacyBrowserState(
      {
        captureRunId: 'seal-run-1',
        captureSessionId: 'seal-session-1',
        chromiumProfile: { platform: 'win32', path: 'C:/Lucid/Profile 1' },
        origin: 'opaque:file',
        challenge: 'A'.repeat(43),
        capturedAt: '2026-08-25T12:00:00.000Z',
      },
      (key) => {
        if (key === 'lucid-fin:theme') throw new Error('localStorage read failed');
        return null;
      },
    );

    await expect(sealLegacyBrowserState(failedCapture, output)).rejects.toThrow(
      'capture did not complete',
    );
    await expect(access(output)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('does not replace an existing artifact, cleans its own temporary file, and permits a retry', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'lucid-browser-state-seal-'));
    temporaryDirectories.push(directory);
    const output = join(directory, 'browser-state.json');
    await writeFile(output, 'operator artifact\n', { mode: 0o600 });

    await expect(sealLegacyBrowserState(capture(), output)).rejects.toMatchObject({
      code: 'EEXIST',
    });
    await expect(readFile(output, 'utf8')).resolves.toBe('operator artifact\n');
    expect(await readdir(directory)).toEqual(['browser-state.json']);

    await unlink(output);
    await expect(sealLegacyBrowserState(capture(), output)).resolves.toMatchObject({ ok: true });
    expect(await readdir(directory)).toEqual(['browser-state.json']);
  });

  it('aggregates a publication failure with a temporary-file cleanup failure', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'lucid-browser-state-seal-'));
    temporaryDirectories.push(directory);
    const output = join(directory, 'browser-state.json');
    await writeFile(output, 'operator artifact\n', { mode: 0o600 });
    const cleanupFailure = new Error('injected temporary-file cleanup failure');
    const unlinkSpy = vi.mocked(fsPromises.unlink).mockRejectedValueOnce(cleanupFailure);

    try {
      const failure = await sealLegacyBrowserState(capture(), output).catch(
        (cause: unknown) => cause,
      );
      expect(failure).toBeInstanceOf(AggregateError);
      expect((failure as AggregateError).errors).toEqual([
        expect.objectContaining({ code: 'EEXIST' }),
        cleanupFailure,
      ]);
    } finally {
      unlinkSpy.mockClear();
    }
  });

  it('preserves the published-cleanup error when it is the only failure', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'lucid-browser-state-seal-'));
    temporaryDirectories.push(directory);
    const output = join(directory, 'browser-state.json');
    const cleanupFailure = new Error('injected temporary-file cleanup failure');
    const unlinkSpy = vi.mocked(fsPromises.unlink).mockRejectedValueOnce(cleanupFailure);

    try {
      const failure = await sealLegacyBrowserState(capture(), output).catch(
        (cause: unknown) => cause,
      );
      expect(failure).toMatchObject({
        message: 'Evidence was published but its private temporary file could not be removed',
        cause: cleanupFailure,
      });
      expect(await readFile(output, 'utf8')).toContain('schema');
    } finally {
      unlinkSpy.mockClear();
    }
  });
});
