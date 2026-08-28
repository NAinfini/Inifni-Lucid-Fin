import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('electron-builder release identity', () => {
  it('uses Linux-safe executable and Debian package names without renaming other platforms', async () => {
    const config = JSON.parse(
      await readFile(
        join(import.meta.dirname, '..', 'apps', 'desktop-main', 'electron-builder.json'),
        'utf8',
      ),
    ) as {
      deb?: { packageName?: string };
      executableName?: string;
      linux?: { executableName?: string };
    };

    expect(config.executableName).toBeUndefined();
    expect(config.linux?.executableName).toBe('lucid-fin');
    expect(config.deb?.packageName).toBe('lucid-fin');
    expect(config.linux?.executableName).toMatch(/^[A-Za-z0-9._ -]+$/);
    expect(config.deb?.packageName).toMatch(/^[a-z0-9][a-z0-9+.-]+$/);
  });

  it('declares only dependencies used by the canonical desktop composition', async () => {
    const packageJson = JSON.parse(
      await readFile(
        join(import.meta.dirname, '..', 'apps', 'desktop-main', 'package.json'),
        'utf8',
      ),
    ) as {
      dependencies?: Record<string, string>;
      optionalDependencies?: Record<string, string>;
    };

    expect(packageJson.dependencies).toEqual({
      '@lucid-fin/contracts': 'workspace:*',
      '@lucid-fin/media-engine': 'workspace:*',
      '@lucid-fin/runtime': 'workspace:*',
      '@lucid-fin/storage': 'workspace:*',
      keytar: '^7.9.0',
      zod: '^4.4.3',
    });
    expect(packageJson.optionalDependencies).toBeUndefined();
  });

  it('unpacks only the native modules used by the canonical desktop composition', async () => {
    const configText = await readFile(
      join(import.meta.dirname, '..', 'apps', 'desktop-main', 'electron-builder.json'),
      'utf8',
    );
    const config = JSON.parse(configText) as {
      afterPack?: string;
      asarUnpack?: string[];
    };

    expect(config.afterPack).toBeUndefined();
    expect(config.asarUnpack).toEqual(['node_modules/keytar/**']);
    expect(configText.toLowerCase()).not.toContain('codex');
  });
});
