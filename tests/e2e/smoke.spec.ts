import { expect, test } from '@playwright/test';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(TEST_DIR, '..', '..');
const MAIN_ENTRY = path.join(REPO_ROOT, 'apps', 'desktop-main', 'dist', 'electron.js');

function resolveElectronBinary(): string {
  const candidates = [
    path.join(REPO_ROOT, 'apps', 'desktop-main', 'node_modules', 'electron'),
    path.join(REPO_ROOT, 'node_modules', 'electron'),
  ];

  for (const electronDir of candidates) {
    const pathFile = path.join(electronDir, 'path.txt');
    if (fs.existsSync(pathFile)) {
      const executablePath = fs.readFileSync(pathFile, 'utf-8').trim();
      return path.join(electronDir, 'dist', executablePath);
    }
  }

  throw new Error(
    'Could not find Electron binary. Run `pnpm install --frozen-lockfile` in the repo root first.',
  );
}

function isBuildAvailable(): boolean {
  return fs.existsSync(MAIN_ENTRY);
}

async function stopProcessTree(proc: ChildProcessWithoutNullStreams): Promise<void> {
  if (proc.killed || proc.exitCode !== null) return;

  if (process.platform === 'win32' && proc.pid) {
    await new Promise<void>((resolve) => {
      const killer = spawn('taskkill', ['/pid', String(proc.pid), '/t', '/f']);
      killer.on('exit', () => resolve());
      killer.on('error', () => resolve());
    });
    return;
  }

  proc.kill('SIGTERM');
}

async function removeTemporaryProfile(directory: string): Promise<void> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      fs.rmSync(directory, { recursive: true, force: true });
      return;
    } catch (error) {
      if (attempt === 4) throw error;
      await new Promise((resolve) => setTimeout(resolve, 100 * (attempt + 1)));
    }
  }
}

async function launchAndWaitForStartup(): Promise<string> {
  const electronBinary = resolveElectronBinary();
  const appDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lucid-fin-smoke-'));
  const roamingAppDataDir = path.join(appDataDir, 'AppData', 'Roaming');
  const localAppDataDir = path.join(appDataDir, 'AppData', 'Local');
  fs.mkdirSync(roamingAppDataDir, { recursive: true });
  fs.mkdirSync(localAppDataDir, { recursive: true });
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  env.APPDATA = roamingAppDataDir;
  env.ELECTRON_IS_E2E = '1';
  env.HOME = appDataDir;
  env.LOCALAPPDATA = localAppDataDir;
  env.NODE_ENV = 'test';
  env.USERPROFILE = appDataDir;

  const proc = spawn(electronBinary, [MAIN_ENTRY], {
    cwd: REPO_ROOT,
    env,
  });

  let output = '';
  const append = (chunk: Buffer) => {
    output += chunk.toString('utf8');
  };
  proc.stdout.on('data', append);
  proc.stderr.on('data', append);

  try {
    await new Promise<void>((resolve, reject) => {
      let pollTimer: ReturnType<typeof setTimeout> | undefined;
      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error(`Timed out waiting for Electron startup.\n${output}`));
      }, 45_000);

      const cleanup = () => {
        clearTimeout(timeout);
        if (pollTimer) clearTimeout(pollTimer);
        proc.off('exit', onExit);
      };

      const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
        cleanup();
        reject(
          new Error(`Electron exited before startup: code=${code} signal=${signal}\n${output}`),
        );
      };
      proc.once('exit', onExit);

      const checkReady = () => {
        if (output.includes('Lucid Fin initialized successfully')) {
          cleanup();
          resolve();
        } else {
          pollTimer = setTimeout(checkReady, 250);
        }
      };
      checkReady();
    });

    return output;
  } finally {
    try {
      await stopProcessTree(proc);
    } finally {
      await removeTemporaryProfile(appDataDir);
    }
  }
}

test.describe('Electron smoke', () => {
  test.skip(!isBuildAvailable(), 'Electron build not found; run `pnpm run build` first');

  test('built app starts the main process', async () => {
    const output = await launchAndWaitForStartup();

    expect(output).toContain('Lucid Fin initialized successfully');
    expect(output).toContain('IPC handlers registered');
  });
});
