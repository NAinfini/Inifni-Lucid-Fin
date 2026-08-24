// @vitest-environment jsdom

import React from 'react';
import { configureStore } from '@reduxjs/toolkit';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Provider } from 'react-redux';
import { VirtuosoGridMockContext } from 'react-virtuoso';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetEntityClipboardForTests } from '../../hooks/useEntityClipboard.js';
import { setLocale, t } from '../../i18n.js';
import { assetsSlice } from '../../store/slices/assets.js';
import { toastSlice } from '../../store/slices/toast.js';
import { getAPI } from '../../utils/api.js';
import { AssetBrowserPanel } from './AssetBrowserPanel.js';

vi.mock('../../utils/api.js', () => ({ getAPI: vi.fn() }));

const virtualGridMetrics = {
  viewportHeight: 600,
  viewportWidth: 900,
  itemHeight: 160,
  itemWidth: 160,
};

function createStore() {
  return configureStore({
    reducer: {
      assets: assetsSlice.reducer,
      toast: toastSlice.reducer,
    },
  });
}

function createEntry(id: string, displayName: string, hash = 'shared-hash') {
  return {
    id,
    hash,
    displayName,
    type: 'image' as const,
    format: 'png',
    originalName: `${displayName}.png`,
    fileSize: 128,
    tags: [],
    folderId: null,
    createdAt: 1,
    contentCreatedAt: 1,
  };
}

function setup(entries = [createEntry('entry-1', 'Asset one')]) {
  const query = vi.fn().mockResolvedValue(entries);
  const copy = vi
    .fn()
    .mockResolvedValue([createEntry('entry-copy', entries[0]?.displayName ?? 'Copy')]);
  const move = vi
    .fn()
    .mockImplementation(async (entryIds: string[]) => ({ movedEntryIds: entryIds }));
  const api = {
    assetEntry: {
      query,
      copy,
      move,
      rename: vi.fn(),
      import: vi.fn(),
      importBuffer: vi.fn(),
      pickFile: vi.fn(),
      delete: vi.fn(async (entryIds: string[]) => ({ deletedEntryIds: entryIds })),
    },
    assetContent: {
      export: vi.fn(),
      exportBatch: vi.fn(),
      getPath: vi.fn(),
    },
  };
  vi.mocked(getAPI).mockReturnValue(api as unknown as ReturnType<typeof getAPI>);

  const store = createStore();
  render(
    <VirtuosoGridMockContext.Provider value={virtualGridMetrics}>
      <Provider store={store}>
        <AssetBrowserPanel />
      </Provider>
    </VirtuosoGridMockContext.Provider>,
  );
  return { api, copy, move, query, store };
}

describe('AssetBrowserPanel logical entry clipboard', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    vi.mocked(getAPI).mockReset();
    resetEntityClipboardForTests();
    setLocale('en-US');
  });

  afterEach(() => {
    cleanup();
    resetEntityClipboardForTests();
    vi.unstubAllGlobals();
  });

  it('renders distinct logical entries that share one content hash', async () => {
    const { store } = setup([
      createEntry('entry-a', 'First entry'),
      createEntry('entry-b', 'Second entry'),
    ]);

    expect(await screen.findByRole('button', { name: /First entry/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Second entry/i })).toBeTruthy();
    expect(store.getState().assets.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'entry-a', hash: 'shared-hash' }),
        expect.objectContaining({ id: 'entry-b', hash: 'shared-hash' }),
      ]),
    );
  });

  it('copy then paste uses one IPC and one batch state update', async () => {
    const { copy, move, query, store } = setup();
    fireEvent.click(await screen.findByRole('button', { name: /Asset one/i }));
    fireEvent.click(screen.getByRole('button', { name: t('contextMenu.copy') }));
    fireEvent.click(screen.getByRole('button', { name: t('contextMenu.paste') }));

    await waitFor(() => expect(copy).toHaveBeenCalledWith(['entry-1'], null));
    expect(copy).toHaveBeenCalledOnce();
    expect(query).toHaveBeenCalledOnce();
    expect(move).not.toHaveBeenCalled();
    expect(store.getState().assets.items.map(({ id }) => id)).toEqual(['entry-1', 'entry-copy']);
  });

  it('cut then paste uses one IPC and does not reload the library', async () => {
    const { copy, move, query } = setup();
    fireEvent.click(await screen.findByRole('button', { name: /Asset one/i }));
    fireEvent.click(screen.getByRole('button', { name: t('contextMenu.cut') }));
    fireEvent.click(screen.getByRole('button', { name: t('contextMenu.paste') }));

    await waitFor(() => expect(move).toHaveBeenCalledWith(['entry-1'], null));
    expect(move).toHaveBeenCalledOnce();
    expect(query).toHaveBeenCalledOnce();
    expect(copy).not.toHaveBeenCalled();
  });
});
