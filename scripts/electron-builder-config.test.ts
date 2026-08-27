import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);

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

  it('resolves packaged resources through electron-builder on every platform', async () => {
    const hookPath = join(
      import.meta.dirname,
      '..',
      'apps',
      'desktop-main',
      'build',
      'verify-codex-binary.cjs',
    );
    const hook = require(hookPath) as {
      resolveCodexBinaryPath: (
        context: {
          appOutDir: string;
          packager: { getResourcesDir: (appOutDir: string) => string };
        },
        target: readonly [string, string, string],
      ) => string;
    };
    const appOutDir = join('release', 'mac-arm64');
    const resourcesDir = join(appOutDir, 'Lucid Fin.app', 'Contents', 'Resources');
    const getResourcesDir = vi.fn(() => resourcesDir);

    const binaryPath = hook.resolveCodexBinaryPath({ appOutDir, packager: { getResourcesDir } }, [
      '@openai/codex-darwin-arm64',
      'aarch64-apple-darwin',
      'codex',
    ]);

    expect(getResourcesDir).toHaveBeenCalledWith(appOutDir);
    expect(binaryPath).toBe(
      join(
        resourcesDir,
        'app.asar.unpacked',
        'node_modules',
        '@openai',
        'codex-darwin-arm64',
        'vendor',
        'aarch64-apple-darwin',
        'bin',
        'codex',
      ),
    );
  });
});
