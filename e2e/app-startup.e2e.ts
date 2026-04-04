import { test, expect } from '@playwright/test';
import { launchApp } from './helpers.js';
import type { ElectronApplication, Page } from '@playwright/test';

test.describe('App Startup', () => {
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

  test('window opens with correct title', async () => {
    const title = await page.title();
    expect(title).toContain('Lucid Fin');
  });

  test('navigation sidebar renders', async () => {
    const nav = page.locator('nav');
    await expect(nav).toBeVisible({ timeout: 10_000 });
    // Nav should have at least one link/button
    const navItems = nav.locator("a, button, [role='tab']");
    expect(await navItems.count()).toBeGreaterThan(0);
  });

  test('app:ready event fires within 15s', async () => {
    // Check that the main content area has rendered (not just body exists)
    const mainContent = page.locator("main, [role='main'], #root > div");
    await expect(mainContent.first()).toBeVisible({ timeout: 15_000 });
  });
});
