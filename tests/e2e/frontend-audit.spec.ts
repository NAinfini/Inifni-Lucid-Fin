import type { Locator } from '@playwright/test';
import { expect, isBuildAvailable, test } from './fixtures.js';

async function expectHoverFeedback(control: Locator) {
  const before = await control.evaluate((element) => getComputedStyle(element).backgroundColor);
  await control.hover();
  await control.evaluate(() => new Promise((resolve) => window.setTimeout(resolve, 160)));
  const after = await control.evaluate((element) => getComputedStyle(element).backgroundColor);
  expect(after).not.toBe(before);
}

test.describe('frontend quality', () => {
  test.skip(!isBuildAvailable(), 'Electron build not found; run pnpm run build first');

  test('keeps the complete desktop path usable at wide and minimum window sizes', async ({
    electronApp,
    mainWindow,
  }) => {
    const description = 'A quiet winter harbor seen through one sleepless night.';
    const rendererErrors: string[] = [];
    mainWindow.on('console', (message) => {
      if (message.type() === 'error') rendererErrors.push(message.text());
    });
    mainWindow.on('pageerror', (error) => rendererErrors.push(error.message));

    await expect(mainWindow.getByRole('form', { name: 'New Project' })).toBeVisible({
      timeout: 30_000,
    });
    await expect(mainWindow.getByRole('button', { name: 'Close new Project' })).toBeVisible();
    await expect(mainWindow.getByRole('button', { name: 'New Project', exact: true })).toHaveCount(
      0,
    );
    await mainWindow.getByRole('textbox', { name: 'Project description' }).fill(description);
    await mainWindow.getByRole('button', { name: 'Create project & start' }).click();
    await expect(mainWindow.getByRole('heading', { level: 1, name: description })).toBeVisible({
      timeout: 30_000,
    });

    const projectNavigation = mainWindow.getByRole('navigation', { name: 'Project workspace' });
    for (const workspace of ['Overview', 'Canvas', 'Media', 'Production', 'Delivery'] as const) {
      const destination = projectNavigation.getByRole('button', {
        name: new RegExp(`^${workspace}\\b`, 'u'),
      });
      await destination.click();
      await expect(destination).toHaveAttribute('aria-current', 'page');
      await expect(mainWindow.getByRole('heading', { level: 2, name: workspace })).toBeVisible();
    }

    await mainWindow.getByRole('button', { name: 'Project settings' }).click();
    const projectSettings = mainWindow.getByRole('dialog', { name: 'Project settings' });
    await expect(projectSettings).toBeVisible();
    await projectSettings.getByRole('button', { name: 'Close Project settings' }).click();

    await electronApp.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setSize(1024, 720);
    });
    await mainWindow.waitForFunction(() => window.innerWidth <= 1279);
    const workspaceDockToggle = mainWindow.locator('.lucid-workspace-header .lucid-dock-toggle');
    await expect(workspaceDockToggle).toHaveAccessibleName('Open Commander');
    await workspaceDockToggle.click();
    const commanderColumn = mainWindow.locator('.lucid-commander-column');
    await expect(commanderColumn).toBeVisible();
    await expect(commanderColumn).toHaveCSS('top', '58px');
    await expect(workspaceDockToggle).toHaveAccessibleName('Collapse Commander');
    await workspaceDockToggle.click();
    await expect(mainWindow.locator('.lucid-commander-column')).toHaveCount(0);
    await workspaceDockToggle.click();
    await expect(mainWindow.locator('.lucid-commander-column')).toBeVisible();
    expect(
      await mainWindow.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      ),
    ).toBe(true);

    await mainWindow.getByRole('link', { name: 'Projects' }).click();
    await expect(mainWindow.getByRole('heading', { level: 1, name: 'Projects' })).toBeVisible();
    await expect(mainWindow.getByRole('button', { name: 'Settings' })).toHaveCount(0);
    const rowMenu = mainWindow.locator('.lucid-row-menu');
    const rowMenuTrigger = mainWindow.getByLabel(`${description} more actions`);
    await rowMenuTrigger.click();
    const rename = mainWindow.getByRole('button', { name: 'Rename' });
    await expectHoverFeedback(rename);
    await rowMenuTrigger.focus();
    await mainWindow.keyboard.press('Escape');
    await expect(rowMenu).not.toHaveAttribute('open', '');

    await rowMenuTrigger.click();
    await expect(mainWindow.getByRole('button', { name: 'Export metadata' })).toHaveCount(0);
    await mainWindow.getByRole('button', { name: 'Delete project' }).click();
    await expect(rowMenu).not.toHaveAttribute('open', '');
    const deleteConfirmation = mainWindow.getByRole('alertdialog', {
      name: `Delete ${description}`,
    });
    await expect(deleteConfirmation).toBeVisible();
    await deleteConfirmation.getByRole('button', { name: 'Cancel' }).click();

    await mainWindow.getByRole('link', { name: 'Global Media' }).click();
    await expect(mainWindow.getByRole('heading', { level: 1, name: 'Global Media' })).toBeVisible();
    await expect(mainWindow.getByRole('button', { name: 'Settings' })).toHaveCount(0);
    expect(rendererErrors).toEqual([]);
  });
});
