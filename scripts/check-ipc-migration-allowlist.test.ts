import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkIpcMigrationAllowlist } from './check-ipc-migration-allowlist.js';

async function withTempRepo(
  files: Record<string, string>,
  run: (repoRoot: string) => Promise<void>,
): Promise<void> {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), 'ipc-allowlist-'));
  try {
    for (const [relativePath, content] of Object.entries(files)) {
      const fullPath = path.join(repoRoot, relativePath);
      await mkdir(path.dirname(fullPath), { recursive: true });
      await writeFile(fullPath, content, 'utf-8');
    }
    await run(repoRoot);
  } finally {
    await rm(repoRoot, { recursive: true, force: true });
  }
}

describe('checkIpcMigrationAllowlist', () => {
  it('passes when every raw ipcMain.handle registration is allowlisted', async () => {
    await withTempRepo(
      {
        'allowlist.txt': 'apps/desktop-main/src/electron.ts :: logger:getRecent\n',
        'apps/desktop-main/src/electron.ts':
          "import { ipcMain } from 'electron';\nipcMain.handle('logger:getRecent', () => []);\n",
      },
      async (repoRoot) => {
        const result = await checkIpcMigrationAllowlist({
          repoRoot,
          sourceRoot: 'apps/desktop-main/src',
          allowlistPath: 'allowlist.txt',
        });

        expect(result.ok).toBe(true);
        expect(result.unapproved).toEqual([]);
      },
    );
  });

  it('fails when a new raw ipcMain.handle registration is not allowlisted', async () => {
    await withTempRepo(
      {
        'allowlist.txt': 'apps/desktop-main/src/electron.ts :: logger:getRecent\n',
        'apps/desktop-main/src/electron.ts':
          "import { ipcMain } from 'electron';\nipcMain.handle('logger:getRecent', () => []);\nipcMain.handle('new:raw', () => null);\n",
      },
      async (repoRoot) => {
        const result = await checkIpcMigrationAllowlist({
          repoRoot,
          sourceRoot: 'apps/desktop-main/src',
          allowlistPath: 'allowlist.txt',
        });

        expect(result.ok).toBe(false);
        expect(result.unapproved).toEqual([
          {
            entry: 'apps/desktop-main/src/electron.ts :: new:raw',
            file: 'apps/desktop-main/src/electron.ts',
            line: 3,
            channel: 'new:raw',
          },
        ]);
      },
    );
  });

  it('normalizes dynamic channel expressions for explicit review', async () => {
    await withTempRepo(
      {
        'allowlist.txt': '',
        'apps/desktop-main/src/ipc/handlers/folder.handlers.ts':
          'ipcMain.handle(`folder.${kind}:list`, async () => []);\n',
      },
      async (repoRoot) => {
        const result = await checkIpcMigrationAllowlist({
          repoRoot,
          sourceRoot: 'apps/desktop-main/src',
          allowlistPath: 'allowlist.txt',
        });

        expect(result.unapproved[0]?.entry).toBe(
          'apps/desktop-main/src/ipc/handlers/folder.handlers.ts :: `folder.${kind}:list`',
        );
      },
    );
  });

  it('ignores ipcMain.handle examples inside comments', async () => {
    await withTempRepo(
      {
        'allowlist.txt': '',
        'apps/desktop-main/src/ipc/ipc-error-handler.ts':
          "/* ipcMain.handle('comment:block', () => null); */\n// ipcMain.handle('comment:line', () => null);\n",
      },
      async (repoRoot) => {
        const result = await checkIpcMigrationAllowlist({
          repoRoot,
          sourceRoot: 'apps/desktop-main/src',
          allowlistPath: 'allowlist.txt',
        });

        expect(result.registrations).toEqual([]);
        expect(result.ok).toBe(true);
      },
    );
  });
});
