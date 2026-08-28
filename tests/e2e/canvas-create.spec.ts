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
    await expect(mainWindow.getByText(/No handler registered/i)).toHaveCount(0);
  });
});
