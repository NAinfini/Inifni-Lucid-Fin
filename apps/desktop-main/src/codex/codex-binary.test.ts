import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CODEX_VERSION, mapAsarToUnpacked, resolveCodexBinary } from './codex-binary.js';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe('Codex binary resolution', () => {
  it('maps the pinned platform package from app.asar to its unpacked native executable', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lucid-codex-binary-'));
    temporaryDirectories.push(root);
    const packageRoot = path.join(
      root,
      'resources',
      'app.asar',
      'node_modules',
      '@openai',
      'codex',
    );
    fs.mkdirSync(packageRoot, { recursive: true });
    const packageJson = path.join(packageRoot, 'package.json');
    fs.writeFileSync(
      packageJson,
      JSON.stringify({ version: `${CODEX_VERSION}-win32-x64` }),
      'utf8',
    );
    const expected = path.join(
      root,
      'resources',
      'app.asar.unpacked',
      'node_modules',
      '@openai',
      'codex',
      'vendor',
      'x86_64-pc-windows-msvc',
      'bin',
      'codex.exe',
    );
    const probe = vi.fn();

    expect(
      resolveCodexBinary({
        platform: 'win32',
        arch: 'x64',
        resolvePackageJson: () => packageJson,
        exists: (candidate) => candidate === expected,
        probe,
      }),
    ).toBe(expected);
    expect(probe).toHaveBeenCalledWith(expected);
    expect(mapAsarToUnpacked('C:\\app\\resources\\app.asar\\native.exe')).toBe(
      'C:\\app\\resources\\app.asar.unpacked\\native.exe',
    );
    expect(
      mapAsarToUnpacked(
        '/release/mac-arm64/Lucid Fin.app/Contents/Resources/app.asar/node_modules/native',
      ),
    ).toBe(
      '/release/mac-arm64/Lucid Fin.app/Contents/Resources/app.asar.unpacked/node_modules/native',
    );
  });

  it('rejects an optional package that does not match the pinned Codex version', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lucid-codex-version-'));
    temporaryDirectories.push(root);
    const packageJson = path.join(root, 'package.json');
    fs.writeFileSync(packageJson, JSON.stringify({ version: '0.144.0-win32-x64' }), 'utf8');

    expect(() =>
      resolveCodexBinary({
        platform: 'win32',
        arch: 'x64',
        resolvePackageJson: () => packageJson,
        exists: () => true,
        probe: vi.fn(),
      }),
    ).toThrow('does not match the pinned runtime');
  });
});
