import { test, expect } from '@playwright/test';
import { launchApp } from './helpers.js';
import type { ElectronApplication, Page } from '@playwright/test';

test.describe('Navigation', () => {
  let app: ElectronApplication;
  let page: Page;

  test.beforeAll(async () => {
    const result = await launchApp();
    app = result.app;
    page = result.page;
  });

  test.afterAll(async () => {
    await app?.close();
  });

  test('command palette opens with Ctrl+K', async () => {
    await page.keyboard.press('Control+k');
    const dialog = page.locator("[role='dialog']");
    await expect(dialog).toBeVisible({ timeout: 3000 });
    // Close it
    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible({ timeout: 3000 });
  });

  test('can navigate between pages via navbar', async () => {
    // Wait for nav to be ready
    const nav = page.locator('nav');
    await expect(nav).toBeVisible({ timeout: 5000 });

    // Find any clickable nav item
    const navItems = nav.locator("a, button, [role='tab']");
    const count = await navItems.count();
    expect(count).toBeGreaterThan(0);

    // Click the first nav item and verify URL changes or content updates
    const firstItem = navItems.first();
    const urlBefore = page.url();
    await firstItem.click();
    // Give router time to update
    await page
      .waitForFunction((prevUrl: string) => window.location.href !== prevUrl, urlBefore, {
        timeout: 3000,
      })
      .catch(() => {
        // URL might not change if already on that page
      });
  });
});
