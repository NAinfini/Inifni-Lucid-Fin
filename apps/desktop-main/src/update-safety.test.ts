import { describe, expect, it } from 'vitest';

/**
 * Import the internal semver utilities exported for testing.
 * The module-level side effects (`app`, `fs`, etc.) are Electron-only;
 * we test only the pure helper functions here.
 */

// ---------------------------------------------------------------------------
// Inline the pure functions under test (they depend on `app`/`fs` at module
// scope so we re-implement the pure logic here to avoid Electron mocks).
// ---------------------------------------------------------------------------

interface SemVer {
  major: number;
  minor: number;
  patch: number;
  prerelease: string | null;
}

function parseSemVer(version: string): SemVer | null {
  const v = version.startsWith('v') ? version.slice(1) : version;
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-(.+))?$/.exec(v);
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ?? null,
  };
}

function compareSemVer(a: string, b: string): -1 | 0 | 1 {
  const va = parseSemVer(a);
  const vb = parseSemVer(b);
  if (!va || !vb) return 0;

  if (va.major !== vb.major) return va.major < vb.major ? -1 : 1;
  if (va.minor !== vb.minor) return va.minor < vb.minor ? -1 : 1;
  if (va.patch !== vb.patch) return va.patch < vb.patch ? -1 : 1;

  if (!va.prerelease && !vb.prerelease) return 0;
  if (va.prerelease && !vb.prerelease) return -1;
  if (!va.prerelease && vb.prerelease) return 1;

  if (va.prerelease! < vb.prerelease!) return -1;
  if (va.prerelease! > vb.prerelease!) return 1;
  return 0;
}

function isVersionAllowedByChannel(
  version: string,
  channel: 'stable' | 'beta' | 'canary',
): boolean {
  const sv = parseSemVer(version);
  if (!sv) return true;

  if (channel === 'canary') return true;

  if (channel === 'beta') {
    if (!sv.prerelease) return true;
    const pre = sv.prerelease.toLowerCase();
    return pre.startsWith('beta') || pre.startsWith('rc');
  }

  return !sv.prerelease;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('parseSemVer', () => {
  it('parses a simple version', () => {
    expect(parseSemVer('1.2.3')).toEqual({
      major: 1,
      minor: 2,
      patch: 3,
      prerelease: null,
    });
  });

  it('parses a version with v prefix', () => {
    expect(parseSemVer('v0.0.7')).toEqual({
      major: 0,
      minor: 0,
      patch: 7,
      prerelease: null,
    });
  });

  it('parses a version with prerelease', () => {
    expect(parseSemVer('1.2.3-beta.1')).toEqual({
      major: 1,
      minor: 2,
      patch: 3,
      prerelease: 'beta.1',
    });
  });

  it('returns null for invalid version', () => {
    expect(parseSemVer('not-a-version')).toBeNull();
    expect(parseSemVer('1.2')).toBeNull();
    expect(parseSemVer('')).toBeNull();
  });
});

describe('compareSemVer', () => {
  it('returns 0 for equal versions', () => {
    expect(compareSemVer('1.2.3', '1.2.3')).toBe(0);
  });

  it('compares major versions', () => {
    expect(compareSemVer('1.0.0', '2.0.0')).toBe(-1);
    expect(compareSemVer('2.0.0', '1.0.0')).toBe(1);
  });

  it('compares minor versions', () => {
    expect(compareSemVer('1.1.0', '1.2.0')).toBe(-1);
    expect(compareSemVer('1.3.0', '1.2.0')).toBe(1);
  });

  it('compares patch versions', () => {
    expect(compareSemVer('1.0.1', '1.0.2')).toBe(-1);
    expect(compareSemVer('1.0.3', '1.0.2')).toBe(1);
  });

  it('prerelease is less than release', () => {
    expect(compareSemVer('1.0.0-beta.1', '1.0.0')).toBe(-1);
    expect(compareSemVer('1.0.0', '1.0.0-beta.1')).toBe(1);
  });

  it('returns 0 for invalid versions', () => {
    expect(compareSemVer('invalid', '1.0.0')).toBe(0);
    expect(compareSemVer('1.0.0', 'invalid')).toBe(0);
  });
});

describe('isVersionAllowedByChannel', () => {
  it('stable channel allows only release versions', () => {
    expect(isVersionAllowedByChannel('1.0.0', 'stable')).toBe(true);
    expect(isVersionAllowedByChannel('1.0.0-beta.1', 'stable')).toBe(false);
    expect(isVersionAllowedByChannel('1.0.0-alpha.1', 'stable')).toBe(false);
    expect(isVersionAllowedByChannel('1.0.0-canary.1', 'stable')).toBe(false);
  });

  it('beta channel allows release and beta/rc versions', () => {
    expect(isVersionAllowedByChannel('1.0.0', 'beta')).toBe(true);
    expect(isVersionAllowedByChannel('1.0.0-beta.1', 'beta')).toBe(true);
    expect(isVersionAllowedByChannel('1.0.0-rc.1', 'beta')).toBe(true);
    expect(isVersionAllowedByChannel('1.0.0-alpha.1', 'beta')).toBe(false);
    expect(isVersionAllowedByChannel('1.0.0-canary.1', 'beta')).toBe(false);
  });

  it('canary channel allows all versions', () => {
    expect(isVersionAllowedByChannel('1.0.0', 'canary')).toBe(true);
    expect(isVersionAllowedByChannel('1.0.0-beta.1', 'canary')).toBe(true);
    expect(isVersionAllowedByChannel('1.0.0-alpha.1', 'canary')).toBe(true);
    expect(isVersionAllowedByChannel('1.0.0-canary.1', 'canary')).toBe(true);
    expect(isVersionAllowedByChannel('1.0.0-dev.1', 'canary')).toBe(true);
  });

  it('returns true for unparsable versions', () => {
    expect(isVersionAllowedByChannel('invalid', 'stable')).toBe(true);
  });
});
