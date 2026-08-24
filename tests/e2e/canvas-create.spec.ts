import { test, expect, isBuildAvailable } from './fixtures.js';

test.describe('Canvas workspace', () => {
  test.skip(!isBuildAvailable(), 'Electron build not found; run `pnpm run build` first');

  test('app starts and renders the main layout', async ({ mainWindow }) => {
    // Title bar should show the app name
    await expect(mainWindow.locator('text=Lucid Fin').first()).toBeVisible({ timeout: 30_000 });

    // The <main> landmark should be present (AppShell renders id="main-content")
    const mainContent = mainWindow.locator('#main-content');
    await expect(mainContent).toBeVisible();

    // Status bar footer (role="contentinfo") should be present
    const statusBar = mainWindow.locator('footer[role="contentinfo"]');
    await expect(statusBar).toBeVisible();
  });

  test('left toolbar is visible with navigation buttons', async ({ mainWindow }) => {
    // LeftToolbar renders <aside role="toolbar">
    const toolbar = mainWindow.locator('aside[role="toolbar"]');
    await expect(toolbar).toBeVisible({ timeout: 30_000 });

    // Toolbar should contain multiple buttons with aria-label
    const buttons = toolbar.locator('button[aria-label]');
    await expect(buttons.first()).toBeVisible();

    // Should have at least the core toolbar buttons (add, assets, characters, etc.)
    const count = await buttons.count();
    expect(count).toBeGreaterThanOrEqual(5);
  });

  test('canvas page shows either workspace or empty state', async ({ mainWindow }) => {
    // Wait for the app to bootstrap — either the canvas workspace (role="application")
    // or the empty-state create button will be visible
    const workspace = mainWindow.locator('[role="application"]');
    const createButton = mainWindow.locator('button', { hasText: /Canvas/ });

    // One of these should appear within the timeout
    await expect(workspace.or(createButton).first()).toBeVisible({ timeout: 30_000 });
  });

  test('right toolbar is visible with panel toggle buttons', async ({ mainWindow }) => {
    // Wait for app to load
    await expect(mainWindow.locator('#main-content')).toBeVisible({ timeout: 30_000 });

    // RightToolbar renders an <aside> on the right side with panel toggle buttons
    // It has buttons with aria-pressed attributes
    const rightButtons = mainWindow.locator('aside button[aria-pressed]');
    await expect(rightButtons.first()).toBeVisible();

    // Left toolbar has its own set; right toolbar buttons are in the second <aside>
    const asides = mainWindow.locator('aside');
    const asideCount = await asides.count();
    expect(asideCount).toBeGreaterThanOrEqual(2);
  });

  test('creates a Canvas and opens an interactive Commander chat through real IPC', async ({
    mainWindow,
  }) => {
    const skipOnboarding = mainWindow.getByRole('button', { name: /skip|跳过/i });
    if (await skipOnboarding.isVisible()) await skipOnboarding.click();

    const createButton = mainWindow.getByRole('button', {
      name: /create canvas|创建画布/i,
    });
    await expect(createButton).toBeVisible({ timeout: 30_000 });
    await expect(createButton).toBeEnabled();
    await createButton.click();

    await expect(mainWindow.getByTestId('rf__wrapper')).toBeVisible({ timeout: 30_000 });
    await expect(mainWindow.getByText(/No handler registered/i)).toHaveCount(0);

    const ipcResult = await mainWindow.evaluate(async () => {
      const api = (window as unknown as {
        lucidAPI: {
          canvas: { loadAll: () => Promise<Array<{ id: string }>> };
          taskLists: { list: (request: { entityType: string }) => Promise<unknown[]> };
          session: {
            upsert: (request: {
              id: string;
              defaultCanvasId: string | null;
              title: string;
              messages: string;
              createdAt: number;
              updatedAt: number;
            }) => Promise<unknown>;
            list: (limit: number) => Promise<Array<{ id: string }>>;
          };
        };
      }).lucidAPI;
      const canvases = await api.canvas.loadAll();
      const taskLists = await api.taskLists.list({ entityType: 'canvas' });
      const now = Date.now();
      await api.session.upsert({
        id: 'e2e-session',
        defaultCanvasId: canvases[0]?.id ?? null,
        title: 'E2E session',
        messages: '[]',
        createdAt: now,
        updatedAt: now,
      });
      const sessions = await api.session.list(10);
      return {
        canvasCount: canvases.length,
        taskListsAreArray: Array.isArray(taskLists),
        sessionPersisted: sessions.some((session) => session.id === 'e2e-session'),
      };
    });

    expect(ipcResult.canvasCount).toBeGreaterThan(0);
    expect(ipcResult.taskListsAreArray).toBe(true);
    expect(ipcResult.sessionPersisted).toBe(true);

    const commanderButton = mainWindow.getByRole('button', {
      name: /Lucid AI|梦鱼/i,
    });
    await commanderButton.click();
    const commanderInput = mainWindow.locator(
      'textarea[placeholder*="Commander AI"], textarea[placeholder*="Commander"]',
    );
    await expect(commanderInput).toBeVisible({ timeout: 30_000 });
    await expect(commanderInput).toBeEnabled();
    await commanderInput.fill('E2E input focus check');
    await expect(commanderInput).toHaveValue('E2E input focus check');
    await commanderInput.fill('');
  });
});
