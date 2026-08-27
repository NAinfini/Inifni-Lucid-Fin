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

  it('declares Codex platform binaries directly for pnpm production packaging', async () => {
    const packageJson = JSON.parse(
      await readFile(
        join(import.meta.dirname, '..', 'apps', 'desktop-main', 'package.json'),
        'utf8',
      ),
    ) as { optionalDependencies?: Record<string, string> };

    expect(packageJson.optionalDependencies).toEqual({
      '@openai/codex-darwin-arm64': 'npm:@openai/codex@0.145.0-darwin-arm64',
      '@openai/codex-darwin-x64': 'npm:@openai/codex@0.145.0-darwin-x64',
      '@openai/codex-linux-arm64': 'npm:@openai/codex@0.145.0-linux-arm64',
      '@openai/codex-linux-x64': 'npm:@openai/codex@0.145.0-linux-x64',
      '@openai/codex-win32-arm64': 'npm:@openai/codex@0.145.0-win32-arm64',
      '@openai/codex-win32-x64': 'npm:@openai/codex@0.145.0-win32-x64',
    });
  });
});
