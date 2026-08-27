import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

const PROJECT_URL = '/#/projects/project.blue-hour/overview';

async function fixtureCallCount(page: Page, call: string) {
  return page.evaluate((callName) => {
    const fixture = Reflect.get(window, '__targetE2eFixture') as {
      calls: Record<string, { mock: { calls: unknown[][] } }>;
    };
    return fixture.calls[callName]?.mock.calls.length ?? 0;
  }, call);
}

async function fixtureCallInput(page: Page, call: string, index = 0): Promise<unknown> {
  return page.evaluate(
    ({ callName, callIndex }) => {
      const fixture = Reflect.get(window, '__targetE2eFixture') as {
        calls: Record<string, { mock: { calls: unknown[][] } }>;
      };
      const request = fixture.calls[callName]?.mock.calls[callIndex]?.[0] as
        { input?: unknown } | undefined;
      return request?.input ?? null;
    },
    { callName: call, callIndex: index },
  );
}

test('navigates the complete Target workspace and Commander journey', async ({ page }) => {
  await page.goto(PROJECT_URL);
  await expect(page.getByRole('heading', { name: 'Blue Hour', level: 1 })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Overview', level: 2 })).toBeVisible();

  for (const workspace of ['Canvas', 'Media', 'Production', 'Delivery'] as const) {
    await page
      .getByRole('button', { name: new RegExp(`^${workspace}`) })
      .first()
      .click();
    await expect(page).toHaveURL(new RegExp(`/${workspace.toLowerCase()}$`));
    await expect(page.getByRole('heading', { name: workspace, level: 2 })).toBeVisible();
  }

  await page
    .getByRole('button', { name: /^Overview/ })
    .first()
    .click();
  await page.getByRole('button', { name: 'Focus' }).click();
  await expect(page.getByRole('complementary', { name: 'Project Chats' })).toBeVisible();

  const composer = page.getByRole('textbox', { name: 'Describe the next change…' });
  await composer.fill('Keep the harbor lighting restrained.');
  await page.getByRole('button', { name: 'Send' }).click();
  await expect.poll(() => fixtureCallCount(page, 'runSendFollowup')).toBe(1);

  await page.getByRole('button', { name: 'Exit Focus' }).click();
  await page.getByRole('link', { name: 'Global Media' }).click();
  await expect(page).toHaveURL(/#\/media$/);
  await expect(page.getByRole('heading', { name: 'Global Media', level: 1 })).toBeVisible();
  await page.getByRole('link', { name: 'Projects' }).click();
  await expect(page).toHaveURL(/#\/projects$/);
  await expect(page.getByRole('heading', { name: 'Projects', level: 1 })).toBeVisible();
});

test('creates a Project, Chat, first Message, and accepted Run as one browser journey', async ({
  page,
}) => {
  await page.goto('/#/projects');
  await page.getByRole('button', { name: 'New Project' }).click();
  await page
    .getByPlaceholder('Describe the film you want to make…')
    .fill('A quiet harbor film with restrained practical lighting.');
  await page.getByRole('button', { name: 'Create project & start' }).click();

  await expect(page).toHaveURL(
    /#\/projects\/project\.blue-hour\/overview\?chat=chat\.opening-direction&run=run\.opening-direction$/,
  );
  await expect(page.getByRole('heading', { name: 'Blue Hour', level: 1 })).toBeVisible();
  for (const call of ['projectCreate', 'chatCreate', 'messageSend'] as const) {
    await expect.poll(() => fixtureCallCount(page, call)).toBe(1);
  }
});

test('records and undoes an authoritative generated-result decision', async ({ page }) => {
  await page.goto('/#/projects/project.blue-hour/media');
  await page.getByRole('tab', { name: 'Candidates' }).click();
  const candidates = page.getByRole('tabpanel');
  await candidates.getByRole('button', { name: /^Select$/ }).click();
  await expect(candidates.getByText('Selected')).toBeVisible();
  await expect.poll(() => fixtureCallCount(page, 'decisionRecord')).toBe(1);

  await page.getByRole('tab', { name: 'Compare' }).click();
  const comparison = page.getByRole('tabpanel');
  await comparison.getByRole('button', { name: /^Undo$/ }).click();
  await expect(comparison.getByRole('button', { name: /^Undo$/ })).toHaveCount(0);
  await expect.poll(() => fixtureCallCount(page, 'decisionRecord')).toBe(2);
});

test('moves a Canvas placement through the authoritative browser action', async ({ page }) => {
  await page.goto('/#/projects/project.blue-hour/canvas');
  const placement = page.getByRole('button', { name: /select and move shot 04/i });
  await placement.press('ArrowRight');

  await expect.poll(() => fixtureCallCount(page, 'canvasApply')).toBe(1);
  expect(await fixtureCallInput(page, 'canvasApply')).toEqual({
    projectId: 'project.blue-hour',
    expectedCanvasRevision: 1,
    command: {
      action: 'move',
      placementId: 'placement.shot-04',
      position: { x: 130, y: 90 },
    },
  });
});

test('requires and submits explicit protection confirmation', async ({ page }) => {
  await page.goto('/#/projects/project.blue-hour/media');
  await page.getByRole('tab', { name: 'Candidates' }).click();
  await page.getByRole('button', { name: 'Inspect candidate result.opening.1' }).click();
  await page.getByRole('button', { name: /^Focus$/ }).click();

  const inspector = page.getByRole('complementary', { name: 'Result inspector' });
  await inspector.getByRole('button', { name: 'Request protection' }).click();
  await expect(inspector.getByText('Explicit confirmation required')).toBeVisible();
  await inspector.getByRole('button', { name: 'Confirm explicitly' }).click();

  await expect.poll(() => fixtureCallCount(page, 'decisionProtect')).toBe(1);
  await expect.poll(() => fixtureCallCount(page, 'confirmationRespond')).toBe(1);
  expect(await fixtureCallInput(page, 'decisionProtect')).toMatchObject({
    mode: 'protect',
    owner: { authority: 'production', id: 'shot.04', revision: 3 },
    field: {
      owner: 'production',
      objectId: 'shot.04',
      field: 'resultDecision',
      resultId: 'result.opening.1',
    },
  });
  expect(await fixtureCallInput(page, 'confirmationRespond')).toEqual({
    confirmationId: 'confirmation.protection.1',
    immutableInputHash: 'a'.repeat(64),
    decision: 'approved',
  });
});

test('binds a selected Delivery destination and cancels the running operation', async ({
  page,
}) => {
  await page.goto('/#/projects/project.blue-hour/delivery');
  await page.getByRole('button', { name: 'Choose destination & export' }).click();
  await expect.poll(() => fixtureCallCount(page, 'exportPick')).toBe(1);
  await expect.poll(() => fixtureCallCount(page, 'runSendFollowup')).toBe(1);
  expect(await fixtureCallInput(page, 'exportPick')).toEqual({
    chatId: 'chat.opening-direction',
    projectId: 'project.blue-hour',
    deliveryPlan: {
      authority: 'delivery',
      id: 'delivery.blue-hour',
      revision: 4,
      contentHash: 'a'.repeat(64),
    },
    destination: 'file',
    suggestedFileName: 'delivery.blue-hour.mp4',
    allowedExtensions: ['mp4'],
  });
  expect(await fixtureCallInput(page, 'runSendFollowup')).toMatchObject({
    selectedContext: [
      {
        ref: {
          authority: 'delivery',
          id: 'delivery.blue-hour',
          revision: 4,
          contentHash: 'a'.repeat(64),
        },
        role: 'selected',
      },
    ],
    exportDestinationGrant: {
      destination: {
        grantId: 'grant.export.blue-hour',
        projectId: 'project.blue-hour',
        allowedExtensions: ['mp4'],
      },
    },
  });

  await page.getByRole('button', { name: 'Cancel Review Cut operation.review.blue-hour' }).click();
  await expect(page.getByText('Cancellation requested')).toBeVisible();
  await expect.poll(() => fixtureCallCount(page, 'operationCancel')).toBe(1);
  expect(await fixtureCallInput(page, 'operationCancel')).toEqual({
    operations: [
      {
        ref: {
          id: 'operation.review.blue-hour',
          revision: 1,
          kind: 'review_cut_attempt',
          ownerRef: {
            authority: 'review_cut_attempt',
            id: 'review.blue-hour',
            revision: 1,
            contentHash: 'c'.repeat(64),
          },
        },
        expectedRevision: 1,
        expectedState: 'running',
      },
    ],
  });
});

test('does not enqueue Delivery work when destination selection is cancelled', async ({ page }) => {
  await page.goto('/#/projects/project.blue-hour/delivery');
  await page.evaluate(() => {
    const fixture = Reflect.get(window, '__targetE2eFixture') as {
      controls: { cancelNextExportPick: () => void };
    };
    fixture.controls.cancelNextExportPick();
  });

  const exportButton = page.getByRole('button', { name: 'Choose destination & export' });
  await exportButton.click();
  await expect.poll(() => fixtureCallCount(page, 'exportPick')).toBe(1);
  await expect(exportButton).toBeEnabled();
  expect(await fixtureCallCount(page, 'runSendFollowup')).toBe(0);
});

test('imports and removes Global Media through the browser shell', async ({ page }) => {
  await page.goto('/#/media');
  await page.getByRole('button', { name: 'Import Media' }).click();
  await expect(page.getByText('New reference', { exact: true })).toBeVisible();
  await expect.poll(() => fixtureCallCount(page, 'mediaPick')).toBe(1);
  await expect.poll(() => fixtureCallCount(page, 'mediaGlobalImport')).toBe(1);

  await page.getByRole('button', { name: 'Remove New reference' }).click();
  await expect(page.getByText('New reference', { exact: true })).toHaveCount(0);
  await expect.poll(() => fixtureCallCount(page, 'mediaGlobalRemove')).toBe(1);
});

test('canonicalizes an invalid workspace route', async ({ page }) => {
  await page.goto('/#/projects/project.blue-hour/not-a-workspace');
  await expect(page).toHaveURL(/#\/projects\/project\.blue-hour\/overview$/);
  await expect(page.getByRole('heading', { name: 'Overview', level: 2 })).toBeVisible();
});

for (const viewport of [
  { width: 390, height: 844 },
  { width: 320, height: 800 },
] as const) {
  test(`keeps the critical Project route usable at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto(PROJECT_URL);
    await expect(page.getByRole('heading', { name: 'Blue Hour', level: 1 })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Open Commander' })).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
      .toBe(true);

    await page.getByRole('button', { name: 'Open Commander' }).click();
    await expect(page.getByRole('button', { name: 'Exit Focus' })).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Describe the next change…' })).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
      .toBe(true);
  });
}
