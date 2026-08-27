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
});
