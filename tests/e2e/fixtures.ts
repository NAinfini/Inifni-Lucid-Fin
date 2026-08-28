import { test as base, type ElectronApplication, type Page, _electron } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

/** Repo root — two levels up from tests/e2e/ */
const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(TEST_DIR, '..', '..');

/**
 * Resolve the checked-in E2E entry. It imports the production build but
 * supplies disposable recovery-key and model adapters, so native smoke never
 * reads the system keychain or reaches a provider.
 */
function resolveMainEntry(): string {
  return path.join(REPO_ROOT, 'tests', 'e2e', 'electron-main.mjs');
}

/**
 * Resolve the Electron binary by reading the `path.txt` file that electron
 * writes during install, mirroring electron/index.js logic without require().
 */
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

/** Check whether the Electron build output exists. */
export function isBuildAvailable(): boolean {
  return (
    fs.existsSync(resolveMainEntry()) &&
    fs.existsSync(path.join(REPO_ROOT, 'apps', 'desktop-main', 'dist', 'electron.js'))
  );
}

export type TestFixtures = {
  electronApp: ElectronApplication;
  mainWindow: Page;
};

/**
 * Extended Playwright test fixture that launches the Electron app.
 *
 * - Uses a checked-in E2E composition with an in-memory recovery-key store.
 * - Gives every test its own disposable profile directory.
 * - Closes the app in teardown.
 * - Provides both `electronApp` (for app-level APIs) and `mainWindow` (the
 *   first BrowserWindow's page object).
 */
export const test = base.extend<TestFixtures>({
  // eslint-disable-next-line no-empty-pattern
  electronApp: async ({}, use) => {
    const mainEntry = resolveMainEntry();

    if (!isBuildAvailable()) {
      throw new Error(
        `Electron build not found at ${mainEntry}. ` +
          'Run `pnpm run build` from the repo root before running E2E tests.',
      );
    }

    const electronBinary = resolveElectronBinary();
    const appDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lucid-fin-e2e-'));
    const roamingAppDataDir = path.join(appDataDir, 'AppData', 'Roaming');
    const localAppDataDir = path.join(appDataDir, 'AppData', 'Local');
    fs.mkdirSync(roamingAppDataDir, { recursive: true });
    fs.mkdirSync(localAppDataDir, { recursive: true });

    const app = await _electron.launch({
      executablePath: electronBinary,
      args: [mainEntry],
      env: {
        ...process.env,
        APPDATA: roamingAppDataDir,
        HOME: appDataDir,
        LOCALAPPDATA: localAppDataDir,
        NODE_ENV: 'test',
        USERPROFILE: appDataDir,
      },
    });

    try {
      await use(app);
    } finally {
      try {
        await app.close();
      } finally {
        fs.rmSync(appDataDir, { recursive: true, force: true });
      }
    }
  },

  mainWindow: async ({ electronApp }, use) => {
    // Wait for the first BrowserWindow to open
    const window = await electronApp.firstWindow();
    // Give the renderer time to initialize
    await window.waitForLoadState('domcontentloaded');
    await use(window);
  },
});

export { expect } from '@playwright/test';
