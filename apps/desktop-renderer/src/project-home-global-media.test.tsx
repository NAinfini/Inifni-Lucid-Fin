// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { App } from './App.js';
import { createDesktopApiFixture, globalMediaFixture, projectFixture } from './test-fixture.js';

afterEach(cleanup);

describe('Project Home and Global Media', () => {
  it('offers Global Media as an available app-level destination', async () => {
    const fixture = createDesktopApiFixture();
    render(
      <MemoryRouter initialEntries={['/projects']}>
        <App api={fixture.api} createRequestId={() => 'request.ui.global-media'} />
      </MemoryRouter>,
    );

    const globalMedia = await screen.findByRole('link', {
      name: 'Global Media',
    });
    fireEvent.click(globalMedia);

    expect(await screen.findByRole('heading', { level: 1, name: 'Global Media' })).toBeTruthy();
    await waitFor(() => expect(fixture.calls.mediaGlobalList).toHaveBeenCalledTimes(1));
  });

  it('imports and removes Global Media through the existing desktop authorities', async () => {
    const fixture = createDesktopApiFixture();
    render(
      <MemoryRouter initialEntries={['/media']}>
        <App api={fixture.api} createRequestId={() => 'request.ui.global-media-commands'} />
      </MemoryRouter>,
    );

    expect(await screen.findByText('Harbor reference')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Import Media' }));

    await waitFor(() => expect(fixture.calls.mediaPick).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(fixture.calls.mediaGlobalImport).toHaveBeenCalledTimes(1));
    expect(fixture.calls.mediaGlobalImport.mock.calls[0]?.[0].input).toEqual({
      capabilityToken: 'capability.global-media-picker',
      displayName: null,
      tags: [],
    });
    expect(await screen.findByText('New reference')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Remove Harbor reference' }));
    await waitFor(() => expect(fixture.calls.mediaGlobalRemove).toHaveBeenCalledTimes(1));
    expect(fixture.calls.mediaGlobalRemove.mock.calls[0]?.[0].input).toMatchObject({
      globalAssetId: 'asset.harbor-reference',
      expectedRevision: 1,
    });
    expect(screen.queryByText('Harbor reference')).toBeNull();
  });

  it('loads additional Project pages instead of hiding them after the initial list', async () => {
    const fixture = createDesktopApiFixture();
    const secondProject = {
      ...projectFixture,
      id: 'project.page-two',
      name: 'Midnight Harbor',
      contentHash: 'd'.repeat(64),
    };
    fixture.calls.projectList.mockImplementation(async (request) => ({
      wireVersion: 1,
      kind: 'success',
      requestId: request.requestId,
      method: 'project.list',
      result:
        request.input.cursor === null
          ? { items: [projectFixture], nextCursor: 'cursor.projects.page.2' }
          : { items: [secondProject], nextCursor: null },
    }));
    render(
      <MemoryRouter initialEntries={['/projects']}>
        <App api={fixture.api} createRequestId={() => 'request.ui.projects-page'} />
      </MemoryRouter>,
    );

    expect(await screen.findByRole('button', { name: 'Open Blue Hour' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Load more Projects' }));
    expect(await screen.findByRole('button', { name: 'Open Midnight Harbor' })).toBeTruthy();
    expect(fixture.calls.projectList.mock.calls.at(-1)?.[0].input.cursor).toBe(
      'cursor.projects.page.2',
    );
  });

  it('loads additional Global Media pages and blocks mutation while the first page loads', async () => {
    const fixture = createDesktopApiFixture();
    const secondItem = {
      ...globalMediaFixture,
      asset: {
        ...globalMediaFixture.asset,
        id: 'asset.page-two',
        displayName: 'Night reference',
        filename: 'night-reference.png',
        contentHash: 'd'.repeat(64),
      },
    };
    let resolveFirstPage!: (
      value: Awaited<ReturnType<typeof fixture.calls.mediaGlobalList>>,
    ) => void;
    const firstPage = new Promise<Awaited<ReturnType<typeof fixture.calls.mediaGlobalList>>>(
      (resolve) => {
        resolveFirstPage = resolve;
      },
    );
    let resolveMorePage!: (
      value: Awaited<ReturnType<typeof fixture.calls.mediaGlobalList>>,
    ) => void;
    const morePage = new Promise<Awaited<ReturnType<typeof fixture.calls.mediaGlobalList>>>(
      (resolve) => {
        resolveMorePage = resolve;
      },
    );
    fixture.calls.mediaGlobalList.mockImplementation(async (request) => {
      if (request.input.page.cursor === null) return firstPage;
      return morePage;
    });
    render(
      <MemoryRouter initialEntries={['/media']}>
        <App api={fixture.api} createRequestId={() => 'request.ui.media-page'} />
      </MemoryRouter>,
    );

    expect(
      (screen.getByRole('button', { name: 'Import Media' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    await waitFor(() => expect(fixture.calls.mediaGlobalList).toHaveBeenCalledTimes(1));
    await act(async () => {
      resolveFirstPage({
        wireVersion: 1,
        kind: 'success',
        requestId: 'request.ui.media-page',
        method: 'media.global.list',
        result: { items: [globalMediaFixture], nextCursor: 'cursor.media.page.2' },
      });
      await Promise.resolve();
    });

    expect(await screen.findByText('Harbor reference')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Load more Media' }));
    expect(
      (screen.getByRole('button', { name: 'Import Media' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(
      (screen.getByRole('button', { name: 'Remove Harbor reference' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    await act(async () => {
      resolveMorePage({
        wireVersion: 1,
        kind: 'success',
        requestId: 'request.ui.media-page-more',
        method: 'media.global.list',
        result: { items: [secondItem], nextCursor: null },
      });
      await Promise.resolve();
    });
    expect(await screen.findByText('Night reference')).toBeTruthy();
    expect(fixture.calls.mediaGlobalList.mock.calls.at(-1)?.[0].input.page.cursor).toBe(
      'cursor.media.page.2',
    );
  });

  it('offers an explicit recovery path when Project setup fails after creation', async () => {
    const fixture = createDesktopApiFixture();
    fixture.calls.chatCreate.mockRejectedValueOnce(new Error('Chat setup failed.'));
    render(
      <MemoryRouter initialEntries={['/projects']}>
        <App api={fixture.api} createRequestId={() => 'request.ui.project-recovery'} />
      </MemoryRouter>,
    );

    fireEvent.click(await screen.findByRole('button', { name: 'New Project' }));
    fireEvent.change(screen.getByPlaceholderText(/describe the film/i), {
      target: { value: 'A recovery-safe harbor project.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create project & start' }));

    expect((await screen.findByRole('alert')).textContent).toContain('Chat setup failed.');
    expect(screen.getByRole('button', { name: 'Open created Project' })).toBeTruthy();
    expect(screen.queryByRole('form', { name: 'New Project' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Open created Project' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Blue Hour' })).toBeTruthy();
  });

  it('keeps Global Settings and metadata export visibly unavailable at their real authority boundary', async () => {
    const fixture = createDesktopApiFixture();
    render(
      <MemoryRouter initialEntries={['/projects']}>
        <App api={fixture.api} createRequestId={() => 'request.ui.authority-boundary'} />
      </MemoryRouter>,
    );

    const settings = (await screen.findByRole('button', { name: 'Settings' })) as HTMLButtonElement;
    expect(settings.disabled).toBe(true);
    expect(settings.title).toBe(
      'Applying captured provider/settings/locale/theme preferences is Gate B work.',
    );

    fireEvent.click(screen.getByLabelText('Blue Hour more actions'));
    const metadataExport = screen.getByRole('button', {
      name: 'Export metadata',
    }) as HTMLButtonElement;
    expect(metadataExport.disabled).toBe(true);
    expect(
      screen.getByText('Metadata export is not connected to a canonical authority.'),
    ).toBeTruthy();
  });

  it('renames, archives, restores, and soft-deletes Projects only after a second confirmation', async () => {
    const fixture = createDesktopApiFixture();
    render(
      <MemoryRouter initialEntries={['/projects']}>
        <App api={fixture.api} createRequestId={() => 'request.ui.project-lifecycle'} />
      </MemoryRouter>,
    );

    await screen.findByRole('button', { name: 'Open Blue Hour' });
    fireEvent.click(screen.getByLabelText('Blue Hour more actions'));
    fireEvent.click(screen.getByRole('button', { name: 'Rename' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Rename Blue Hour' }), {
      target: { value: 'Harbor After Dark' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save name' }));
    await waitFor(() => expect(fixture.calls.projectUpdate).toHaveBeenCalledTimes(1));
    expect(fixture.calls.projectUpdate.mock.calls[0]?.[0].input).toMatchObject({
      projectId: 'project.blue-hour',
      name: 'Harbor After Dark',
      lifecycle: null,
    });

    fireEvent.click(screen.getByLabelText('Harbor After Dark more actions'));
    fireEvent.click(screen.getByRole('button', { name: 'Archive' }));
    await waitFor(() => expect(fixture.calls.projectUpdate).toHaveBeenCalledTimes(2));
    expect(fixture.calls.projectUpdate.mock.calls[1]?.[0].input.lifecycle).toBe('archived');
    expect(screen.queryByRole('button', { name: 'Open Harbor After Dark' })).toBeNull();

    fireEvent.click(screen.getByRole('tab', { name: 'Archived projects' }));
    expect(await screen.findByRole('button', { name: 'Open Harbor After Dark' })).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Harbor After Dark more actions'));
    fireEvent.click(screen.getByRole('button', { name: 'Restore' }));
    await waitFor(() => expect(fixture.calls.projectUpdate).toHaveBeenCalledTimes(3));
    expect(fixture.calls.projectUpdate.mock.calls[2]?.[0].input.lifecycle).toBe('active');

    fireEvent.click(screen.getByRole('tab', { name: 'Active projects' }));
    expect(await screen.findByRole('button', { name: 'Open Harbor After Dark' })).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Harbor After Dark more actions'));
    fireEvent.click(screen.getByRole('button', { name: 'Delete project' }));
    expect(fixture.calls.projectUpdate).toHaveBeenCalledTimes(3);

    const confirmation = await screen.findByRole('alertdialog', {
      name: 'Delete Harbor After Dark',
    });
    expect(confirmation.textContent).toContain('does not physically erase stored data');
    fireEvent.click(screen.getByRole('button', { name: 'Confirm soft delete' }));
    await waitFor(() => expect(fixture.calls.projectUpdate).toHaveBeenCalledTimes(4));
    expect(fixture.calls.projectUpdate.mock.calls[3]?.[0].input.lifecycle).toBe('deleted');
    expect(screen.queryByRole('button', { name: 'Open Harbor After Dark' })).toBeNull();
  });

  it('presents Global Media authority failures as alerts', async () => {
    const fixture = createDesktopApiFixture();
    fixture.calls.mediaGlobalList.mockRejectedValueOnce(new Error('Global media is unavailable.'));
    render(
      <MemoryRouter initialEntries={['/media']}>
        <App api={fixture.api} createRequestId={() => 'request.ui.global-media-failure'} />
      </MemoryRouter>,
    );

    expect((await screen.findByRole('alert')).textContent).toContain(
      'Global media is unavailable.',
    );
  });
});
