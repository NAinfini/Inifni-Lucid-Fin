import { expect, isBuildAvailable, test } from './fixtures.js';

test.describe('canonical Electron smoke', () => {
  test.skip(!isBuildAvailable(), 'Electron build not found; run pnpm run build first');

  test('loads the sole generated preload bridge and canonical renderer', async ({ mainWindow }) => {
    await expect(mainWindow.locator('#lucid-main')).toBeVisible({ timeout: 30_000 });
    await expect(mainWindow.getByRole('heading', { level: 1, name: 'Projects' })).toBeVisible();

    const bridges = await mainWindow.evaluate(() => {
      const pageWindow = window as Window & { readonly lucidFin?: unknown };
      return {
        canonical: typeof pageWindow.lucidFin === 'object',
        removedBridgePresent: 'lucidAPI' in pageWindow,
      };
    });
    expect(bridges).toEqual({ canonical: true, removedBridgePresent: false });
  });
});
