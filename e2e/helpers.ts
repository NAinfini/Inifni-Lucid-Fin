import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export async function launchApp(): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await electron.launch({
    args: [path.join(__dirname, '..', 'apps', 'desktop-main', 'dist', 'electron.js')],
    env: {
      ...process.env,
      NODE_ENV: 'test',
    },
  });

  const page = await app.firstWindow();
  // Wait for the renderer to be ready
  await page.waitForLoadState('domcontentloaded');
  return { app, page };
}
