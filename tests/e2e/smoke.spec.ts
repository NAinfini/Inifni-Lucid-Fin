import { expect, test } from '@playwright/test';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import fs from 'node:fs';
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

  throw new Error('Could not find Electron binary. Run `npm install` in the repo root first.');
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

async function launchAndWaitForStartup(): Promise<string> {
  const electronBinary = resolveElectronBinary();
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  env.ELECTRON_IS_E2E = '1';
  env.NODE_ENV = 'test';

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
      const timeout = setTimeout(() => {
        reject(new Error(`Timed out waiting for Electron startup.\n${output}`));
      }, 45_000);

      proc.on('exit', (code, signal) => {
        clearTimeout(timeout);
        reject(new Error(`Electron exited before startup: code=${code} signal=${signal}\n${output}`));
      });

      const checkReady = () => {
        if (
          output.includes('Lucid Fin initialized successfully') &&
          output.includes('[api-server] Listening')
        ) {
          clearTimeout(timeout);
          resolve();
        } else {
          setTimeout(checkReady, 250);
        }
      };
      checkReady();
    });

    return output;
  } finally {
    await stopProcessTree(proc);
  }
}

test.describe('Electron smoke', () => {
  test.beforeEach(() => {
    test.skip(!isBuildAvailable(), 'Electron build not found; run `npm run build` first');
  });

  test('built app starts main process and local API server', async () => {
    const output = await launchAndWaitForStartup();

    expect(output).toContain('Lucid Fin initialized successfully');
    expect(output).toContain('[api-server] Listening');
    expect(output).toContain('IPC handlers registered');
  });
});
