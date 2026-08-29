import { expect, isBuildAvailable, test } from './fixtures.js';

test.describe('canonical Project journey', () => {
  test.skip(!isBuildAvailable(), 'Electron build not found; run pnpm run build first');

  test('creates a Project through the real generated IPC wire', async ({ mainWindow }) => {
    await expect(mainWindow.getByRole('form', { name: 'New Project' })).toBeVisible({
      timeout: 30_000,
    });

    await mainWindow
      .getByPlaceholder('Describe the film you want to make…')
      .fill('A moonlit harbor mystery told in one continuous night.');
    await mainWindow
      .getByRole('textbox', { name: 'Project name (optional)' })
      .fill('E2E Canonical Project');
    await mainWindow.getByRole('button', { name: 'Create project & start' }).click();

    await expect(
      mainWindow.getByRole('heading', { level: 1, name: 'E2E Canonical Project' }),
    ).toBeVisible({ timeout: 30_000 });
    await expect(mainWindow.getByRole('button', { name: /^Overview\b/u })).toBeVisible();

    const projectSettings = mainWindow.getByRole('button', { name: 'Settings', exact: true });
    await expect(projectSettings).toBeEnabled();
    await projectSettings.click();
    const settingsDialog = mainWindow.getByRole('dialog', { name: 'Project settings' });
    await expect(settingsDialog).toBeVisible();
    await settingsDialog.getByRole('button', { name: 'Close Project settings' }).click();
    await expect(settingsDialog).toHaveCount(0);

    const firstChange = mainWindow.locator('.lucid-change-row').first();
    await expect(firstChange).toBeVisible();
    await firstChange.click();
    const changeDetails = mainWindow.getByRole('region', { name: 'Change details' });
    await expect(changeDetails).toBeVisible();
    await expect(mainWindow.locator('.lucid-focus-shell')).toHaveCount(0);
    await firstChange.click();
    await expect(changeDetails).toHaveCount(0);

    await expect(mainWindow.getByText(/No handler registered/i)).toHaveCount(0);
  });
});
