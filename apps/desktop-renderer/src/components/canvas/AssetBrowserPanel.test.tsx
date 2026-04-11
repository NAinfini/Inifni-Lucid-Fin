// @vitest-environment jsdom

import React from 'react';
import { configureStore } from '@reduxjs/toolkit';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { Provider } from 'react-redux';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setLocale, t } from '../../i18n.js';
import { assetsSlice } from '../../store/slices/assets.js';
import { toastSlice } from '../../store/slices/toast.js';
import { getAPI } from '../../utils/api.js';
import { AssetBrowserPanel } from './AssetBrowserPanel.js';

vi.mock('../../utils/api.js', () => ({
  getAPI: vi.fn(),
}));

function createStore() {
  return configureStore({
    reducer: {
      assets: assetsSlice.reducer,
      toast: toastSlice.reducer,
    },
  });
}

function renderPanel() {
  const store = createStore();
  const view = render(
    <Provider store={store}>
      <AssetBrowserPanel />
    </Provider>,
  );

  return { store, ...view };
}

function createDroppedFile(path: string, name: string, type: string): File {
  const file = new File(['content'], name, { type });
  Object.defineProperty(file, 'path', {
    configurable: true,
    value: path,
  });
  return file;
}

describe('AssetBrowserPanel', () => {
  beforeEach(() => {
    vi.mocked(getAPI).mockReset();
    setLocale('en-US');
  });

  afterEach(() => {
    cleanup();
  });

  it('shows an error toast when a dropped file import fails', async () => {
    const query = vi.fn().mockResolvedValue([]);
    const importAsset = vi.fn().mockRejectedValue(new Error('Import exploded'));

    vi.mocked(getAPI).mockReturnValue({
      asset: {
        query,
        import: importAsset,
        pickFile: vi.fn(),
        delete: vi.fn(),
        exportBatch: vi.fn(),
        export: vi.fn(),
      },
    } as unknown as ReturnType<typeof getAPI>);

    const { store, container } = renderPanel();

    await waitFor(() => {
      expect(query).toHaveBeenCalledTimes(1);
    });

    const dropZone = container.querySelector('[class*="overflow-y-auto"]');
    expect(dropZone).toBeTruthy();

    const file = createDroppedFile('C:/tmp/bad.png', 'bad.png', 'image/png');

    fireEvent.drop(dropZone as HTMLElement, {
      dataTransfer: {
        files: [file],
        types: ['Files'],
        getData: vi.fn(() => ''),
      },
    });

    await waitFor(() => {
      expect(importAsset).toHaveBeenCalledWith('C:/tmp/bad.png', 'image');
    });

    expect(store.getState().toast.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          variant: 'error',
          message: expect.stringContaining('Import exploded'),
        }),
      ]),
    );
  });

  it('shows an error toast when a dropped file cannot be imported from disk', async () => {
    const query = vi.fn().mockResolvedValue([]);
    const importAsset = vi.fn();

    vi.mocked(getAPI).mockReturnValue({
      asset: {
        query,
        import: importAsset,
        pickFile: vi.fn(),
        delete: vi.fn(),
        exportBatch: vi.fn(),
        export: vi.fn(),
      },
    } as unknown as ReturnType<typeof getAPI>);

    const { store, container } = renderPanel();

    await waitFor(() => {
      expect(query).toHaveBeenCalledTimes(1);
    });

    const dropZone = container.querySelector('[class*="overflow-y-auto"]');
    expect(dropZone).toBeTruthy();

    const file = new File(['content'], 'missing-path.png', { type: 'image/png' });

    fireEvent.drop(dropZone as HTMLElement, {
      dataTransfer: {
        files: [file],
        types: ['Files'],
        getData: vi.fn(() => ''),
      },
    });

    await waitFor(() => {
      expect(store.getState().toast.items).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            variant: 'error',
            message: expect.stringContaining('missing-path.png'),
          }),
        ]),
      );
    });

    expect(importAsset).not.toHaveBeenCalled();
  });

  it('shows an error toast when a dropped file type is unsupported', async () => {
    const query = vi.fn().mockResolvedValue([]);
    const importAsset = vi.fn();

    vi.mocked(getAPI).mockReturnValue({
      asset: {
        query,
        import: importAsset,
        pickFile: vi.fn(),
        delete: vi.fn(),
        exportBatch: vi.fn(),
        export: vi.fn(),
      },
    } as unknown as ReturnType<typeof getAPI>);

    const { store, container } = renderPanel();

    await waitFor(() => {
      expect(query).toHaveBeenCalledTimes(1);
    });

    const dropZone = container.querySelector('[class*="overflow-y-auto"]');
    expect(dropZone).toBeTruthy();

    const file = createDroppedFile('C:/tmp/notes.txt', 'notes.txt', 'text/plain');

    fireEvent.drop(dropZone as HTMLElement, {
      dataTransfer: {
        files: [file],
        types: ['Files'],
        getData: vi.fn(() => ''),
      },
    });

    await waitFor(() => {
      expect(store.getState().toast.items).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            variant: 'error',
            message: expect.stringContaining('notes.txt'),
          }),
        ]),
      );
    });

    expect(importAsset).not.toHaveBeenCalled();
  });

  it('shows an error toast when asset deletion fails', async () => {
    const query = vi.fn().mockResolvedValue([
      {
        hash: 'asset-1',
        name: 'Broken Asset',
        type: 'image',
        path: 'C:/tmp/broken.png',
        tags: [],
        global: false,
        fileSize: 128,
        createdAt: 1,
      },
    ]);
    const deleteAsset = vi.fn().mockRejectedValue(new Error('Delete exploded'));

    vi.mocked(getAPI).mockReturnValue({
      asset: {
        query,
        import: vi.fn(),
        pickFile: vi.fn(),
        delete: deleteAsset,
        exportBatch: vi.fn(),
        export: vi.fn(),
      },
    } as unknown as ReturnType<typeof getAPI>);

    const { store } = renderPanel();

    const assetButton = await screen.findByRole('button', { name: /Broken Asset/i });
    fireEvent.click(assetButton);

    fireEvent.click(screen.getByRole('button', { name: t('action.delete') || 'Delete' }));

    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));

    await waitFor(() => {
      expect(deleteAsset).toHaveBeenCalledWith('asset-1');
    });

    expect(store.getState().assets.items).toEqual(
      expect.arrayContaining([expect.objectContaining({ hash: 'asset-1' })]),
    );
    expect(
      screen.getByText(t('assetBrowser.selectedCount').replace('{count}', '1')),
    ).toBeTruthy();
    expect(store.getState().toast.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          variant: 'error',
          message: expect.stringContaining('Delete exploded'),
        }),
      ]),
    );
  });

  it('shows an error toast when loading assets fails', async () => {
    const query = vi.fn().mockRejectedValue(new Error('Query exploded'));

    vi.mocked(getAPI).mockReturnValue({
      asset: {
        query,
        import: vi.fn(),
        pickFile: vi.fn(),
        delete: vi.fn(),
        exportBatch: vi.fn(),
        export: vi.fn(),
      },
    } as unknown as ReturnType<typeof getAPI>);

    const { store } = renderPanel();

    await waitFor(() => {
      expect(query).toHaveBeenCalledTimes(1);
    });

    await waitFor(() => {
      expect(store.getState().toast.items).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            variant: 'error',
            title: t('assetBrowser.loadFailed'),
            message: 'Query exploded',
          }),
        ]),
      );
    });
  });

  it('shows an error toast when exporting selected assets fails', async () => {
    const query = vi.fn().mockResolvedValue([
      {
        hash: 'asset-1',
        name: 'Export Asset',
        type: 'image',
        path: 'C:/tmp/export.png',
        tags: [],
        global: false,
        fileSize: 128,
        createdAt: 1,
      },
    ]);
    const exportBatch = vi.fn().mockRejectedValue(new Error('Export exploded'));

    vi.mocked(getAPI).mockReturnValue({
      asset: {
        query,
        import: vi.fn(),
        pickFile: vi.fn(),
        delete: vi.fn(),
        exportBatch,
        export: vi.fn(),
      },
    } as unknown as ReturnType<typeof getAPI>);

    const { store } = renderPanel();

    const assetButton = await screen.findByRole('button', { name: /Export Asset/i });
    fireEvent.click(assetButton);
    fireEvent.click(screen.getByRole('button', { name: t('assetBrowser.exportSelected') }));

    await waitFor(() => {
      expect(exportBatch).toHaveBeenCalledWith({
        items: [{ hash: 'asset-1', type: 'image', name: 'Export Asset' }],
      });
    });

    expect(store.getState().toast.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          variant: 'error',
          title: t('assetBrowser.exportFailed'),
          message: 'Export exploded',
        }),
      ]),
    );
  });

  it('localizes the selection context menu and batch rename panel content', async () => {
    const query = vi.fn().mockResolvedValue([
      {
        hash: 'asset-1',
        name: 'Localized Asset',
        type: 'image',
        path: 'C:/tmp/localized.png',
        tags: [],
        global: false,
        fileSize: 128,
        createdAt: 1,
      },
    ]);

    vi.mocked(getAPI).mockReturnValue({
      asset: {
        query,
        import: vi.fn(),
        pickFile: vi.fn(),
        delete: vi.fn(),
        exportBatch: vi.fn(),
        export: vi.fn(),
      },
    } as unknown as ReturnType<typeof getAPI>);

    setLocale('zh-CN');
    renderPanel();

    const assetButton = await screen.findByRole('button', { name: /Localized Asset/i });
    fireEvent.click(assetButton);
    fireEvent.contextMenu(assetButton, { clientX: 20, clientY: 20 });

    const exportSelectedLabel = `${t('assetBrowser.exportSelected')} (1)`;
    const batchRenameLabel = `${t('assetBrowser.batchRename')} (1)`;
    expect(await screen.findByRole('button', { name: exportSelectedLabel })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: batchRenameLabel }));

    expect(
      screen.getByText(t('assetBrowser.batchRenameItems').replace('{count}', '1')),
    ).toBeTruthy();
    expect(screen.getByText(t('assetBrowser.batchRenamePattern'))).toBeTruthy();
    expect(
      screen.getByPlaceholderText(t('assetBrowser.batchRenamePrefixPlaceholder')),
    ).toBeTruthy();
  });

  it('localizes delete confirmation actions', async () => {
    const query = vi.fn().mockResolvedValue([
      {
        hash: 'asset-1',
        name: 'Localized Asset',
        type: 'image',
        path: 'C:/tmp/localized.png',
        tags: [],
        global: false,
        fileSize: 128,
        createdAt: 1,
      },
    ]);

    vi.mocked(getAPI).mockReturnValue({
      asset: {
        query,
        import: vi.fn(),
        pickFile: vi.fn(),
        delete: vi.fn(),
        exportBatch: vi.fn(),
        export: vi.fn(),
      },
    } as unknown as ReturnType<typeof getAPI>);

    setLocale('zh-CN');
    renderPanel();

    const assetButton = await screen.findByRole('button', { name: /Localized Asset/i });
    fireEvent.click(assetButton);
    fireEvent.click(screen.getByRole('button', { name: t('action.delete') }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('button', { name: t('action.cancel') })).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: t('action.delete') })).toBeTruthy();
  });

  it('localizes the asset detail panel labels and visible values', async () => {
    const query = vi.fn().mockResolvedValue([
      {
        hash: 'asset-1',
        name: 'Localized Asset',
        type: 'image',
        path: 'C:/tmp/localized.png',
        tags: [],
        global: false,
        fileSize: 1363148,
        createdAt: new Date('2026-04-04T21:40:03').getTime(),
        format: 'png',
        width: 1920,
        height: 1080,
        provider: 'Fal',
        prompt: 'Test prompt',
      },
    ]);

    vi.mocked(getAPI).mockReturnValue({
      asset: {
        query,
        import: vi.fn(),
        pickFile: vi.fn(),
        delete: vi.fn(),
        exportBatch: vi.fn(),
        export: vi.fn(),
      },
    } as unknown as ReturnType<typeof getAPI>);

    setLocale('zh-CN');
    renderPanel();

    const assetButton = await screen.findByRole('button', { name: /Localized Asset/i });
    fireEvent.click(assetButton);

    expect(screen.getByText(t('assetBrowser.details'))).toBeTruthy();
    expect(screen.getByText(t('assetBrowser.fields.type'))).toBeTruthy();
    expect(screen.getByText(t('assetBrowser.fields.size'))).toBeTruthy();
    expect(screen.getByText(t('assetBrowser.fields.format'))).toBeTruthy();
    expect(screen.getByText(t('assetBrowser.fields.dimensions'))).toBeTruthy();
    expect(screen.getByText(t('assetBrowser.fields.hash'))).toBeTruthy();
    expect(screen.getByText(t('assetBrowser.created'))).toBeTruthy();
    expect(screen.getByText(t('assetBrowser.fields.provider'))).toBeTruthy();
    expect(screen.getByText(t('assetBrowser.fields.prompt'))).toBeTruthy();

    const typeRow = screen.getByText(t('assetBrowser.fields.type')).parentElement;
    expect(typeRow).toBeTruthy();
    expect(within(typeRow as HTMLElement).getByText(t('asset.image'))).toBeTruthy();
  });

  it('localizes the sticky selected-count label', async () => {
    const query = vi.fn().mockResolvedValue([
      {
        hash: 'asset-1',
        name: 'Asset One',
        type: 'image',
        path: 'C:/tmp/one.png',
        tags: [],
        global: false,
        fileSize: 128,
        createdAt: 1,
      },
      {
        hash: 'asset-2',
        name: 'Asset Two',
        type: 'image',
        path: 'C:/tmp/two.png',
        tags: [],
        global: false,
        fileSize: 128,
        createdAt: 2,
      },
      {
        hash: 'asset-3',
        name: 'Asset Three',
        type: 'image',
        path: 'C:/tmp/three.png',
        tags: [],
        global: false,
        fileSize: 128,
        createdAt: 3,
      },
    ]);

    vi.mocked(getAPI).mockReturnValue({
      asset: {
        query,
        import: vi.fn(),
        pickFile: vi.fn(),
        delete: vi.fn(),
        exportBatch: vi.fn(),
        export: vi.fn(),
      },
    } as unknown as ReturnType<typeof getAPI>);

    setLocale('zh-CN');
    renderPanel();

    fireEvent.click(await screen.findByRole('button', { name: /Asset One/i }), { ctrlKey: true });
    fireEvent.click(screen.getByRole('button', { name: /Asset Two/i }), { ctrlKey: true });
    fireEvent.click(screen.getByRole('button', { name: /Asset Three/i }), { ctrlKey: true });

    expect(
      screen.getByText(t('assetBrowser.selectedCount').replace('{count}', '3')),
    ).toBeTruthy();
  });

  it('localizes the asset type badge in list view', async () => {
    const query = vi.fn().mockResolvedValue([
      {
        hash: 'asset-1',
        name: 'Localized Video',
        type: 'video',
        path: 'C:/tmp/localized.mp4',
        tags: [],
        global: false,
        fileSize: 128,
        createdAt: 1,
      },
    ]);

    vi.mocked(getAPI).mockReturnValue({
      asset: {
        query,
        import: vi.fn(),
        pickFile: vi.fn(),
        delete: vi.fn(),
        exportBatch: vi.fn(),
        export: vi.fn(),
      },
    } as unknown as ReturnType<typeof getAPI>);

    setLocale('zh-CN');
    renderPanel();

    fireEvent.click(await screen.findByTitle(t('assetBrowser.viewList')));

    const listAssetButton = await screen.findByRole('button', { name: /Localized Video/i });
    expect(within(listAssetButton).getByText(t('asset.video'))).toBeTruthy();
  });

  it('does not nest quick export buttons inside the asset selection control', async () => {
    const query = vi.fn().mockResolvedValue([
      {
        hash: 'asset-1',
        name: 'Exportable Asset',
        type: 'image',
        path: 'C:/tmp/exportable.png',
        tags: [],
        global: false,
        fileSize: 128,
        createdAt: 1,
      },
    ]);

    vi.mocked(getAPI).mockReturnValue({
      asset: {
        query,
        import: vi.fn(),
        pickFile: vi.fn(),
        delete: vi.fn(),
        exportBatch: vi.fn(),
        export: vi.fn(),
      },
    } as unknown as ReturnType<typeof getAPI>);

    renderPanel();

    const assetButton = await screen.findByRole('button', { name: /Exportable Asset/i });
    expect(within(assetButton).queryByRole('button')).toBeNull();
  });
});
