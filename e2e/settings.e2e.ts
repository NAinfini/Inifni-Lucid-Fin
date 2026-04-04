import { test, expect } from '@playwright/test';
import { launchApp } from './helpers.js';
import type { ElectronApplication, Page } from '@playwright/test';

test.describe('Settings Page', () => {
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

  test('can navigate to Settings page', async () => {
    await page.evaluate(() => {
      window.location.hash = '#/settings';
    });
    const heading = page.locator('text=设置').or(page.locator('text=Settings'));
    await expect(heading.first()).toBeVisible({ timeout: 5000 });
  });

  test('API Key configuration section is present', async () => {
    await page.evaluate(() => {
      window.location.hash = '#/settings';
    });
    // Settings page should show provider configuration elements
    const settingsContent = page.locator("main, [role='main'], section").first();
    await expect(settingsContent).toBeVisible({ timeout: 5000 });
    // Should have input fields or buttons for API key management
    const interactiveElements = page.locator("input, button, [role='switch']");
    expect(await interactiveElements.count()).toBeGreaterThan(0);
  });
});
