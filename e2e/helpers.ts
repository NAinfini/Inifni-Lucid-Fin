import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const desktopMainAppDir = path.resolve(__dirname, '..', 'apps', 'desktop-main');

export function getElectronLaunchOptions() {
  const env = { ...process.env } as NodeJS.ProcessEnv;
  delete env.ELECTRON_RUN_AS_NODE;

  return {
    args: [desktopMainAppDir],
    env: {
      ...env,
      NODE_ENV: 'test',
    },
  };
}

export async function launchApp(): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await electron.launch(getElectronLaunchOptions());

  const page = await app.firstWindow();
  // Wait for the renderer to be ready
  await page.waitForLoadState('domcontentloaded');
  return { app, page };
}
