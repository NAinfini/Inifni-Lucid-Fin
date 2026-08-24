// @vitest-environment jsdom

import React, { type PropsWithChildren } from 'react';
import { configureStore } from '@reduxjs/toolkit';
import { act, cleanup, renderHook } from '@testing-library/react';
import { Provider } from 'react-redux';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  addAssets,
  assetsSlice,
  moveItemsToFolder,
  removeAssets,
  setAssets,
  type Asset,
} from '../store/slices/assets.js';
import { loggerSlice } from '../store/slices/logger.js';
import { toastSlice } from '../store/slices/toast.js';
import { getAPI } from '../utils/api.js';
import { useAssetOperations } from './useAssetOperations.js';

vi.mock('../utils/api.js', () => ({ getAPI: vi.fn() }));

function createAsset(id: string, name: string, folderId: string | null = null): Asset {
  return {
    id,
    hash: `${id}-hash`,
    name,
    type: 'image',
    path: '',
    tags: [],
    global: false,
    size: 128,
    createdAt: 1,
    folderId,
  };
}

function createEntry(id: string, displayName: string, folderId: string | null = null) {
  return {
    id,
    hash: `${id}-hash`,
    displayName,
    type: 'image' as const,
    format: 'png',
    originalName: `${displayName}.png`,
    fileSize: 128,
    tags: [],
    folderId,
    createdAt: 1,
    contentCreatedAt: 1,
  };
}

describe('useAssetOperations bulk mutations', () => {
  afterEach(() => {
    cleanup();
    vi.mocked(getAPI).mockReset();
  });

  it('uses one IPC call and one batch reducer action per mutation', async () => {
    const deleteEntries = vi.fn(async (entryIds: string[]) => ({ deletedEntryIds: entryIds }));
    const moveEntries = vi.fn(async (entryIds: string[]) => ({ movedEntryIds: entryIds }));
    const copiedEntries = [
      createEntry('entry-copy-a', 'Copy A'),
      createEntry('entry-copy-b', 'Copy B'),
    ];
    const copyEntries = vi.fn().mockResolvedValue(copiedEntries);
    vi.mocked(getAPI).mockReturnValue({
      assetEntry: {
        delete: deleteEntries,
        move: moveEntries,
        copy: copyEntries,
      },
    } as unknown as ReturnType<typeof getAPI>);

    const store = configureStore({
      reducer: {
        assets: assetsSlice.reducer,
        logger: loggerSlice.reducer,
        toast: toastSlice.reducer,
      },
    });
    store.dispatch(
      setAssets([createAsset('entry-a', 'Asset A'), createAsset('entry-b', 'Asset B')]),
    );
    const dispatchSpy = vi.spyOn(store, 'dispatch');
    const wrapper = ({ children }: PropsWithChildren) => (
      <Provider store={store}>{children}</Provider>
    );
    const { result } = renderHook(() => useAssetOperations(), { wrapper });

    await act(async () => {
      await result.current.executeDelete(new Set(['entry-a', 'entry-b']));
      await result.current.executeMove(['entry-a', 'entry-b'], 'folder-1');
      await result.current.executeCopy(['entry-a', 'entry-b'], null);
    });

    expect(deleteEntries).toHaveBeenCalledOnce();
    expect(deleteEntries).toHaveBeenCalledWith(['entry-a', 'entry-b']);
    expect(moveEntries).toHaveBeenCalledOnce();
    expect(moveEntries).toHaveBeenCalledWith(['entry-a', 'entry-b'], 'folder-1');
    expect(copyEntries).toHaveBeenCalledOnce();
    expect(copyEntries).toHaveBeenCalledWith(['entry-a', 'entry-b'], null);

    const dispatchedTypes = dispatchSpy.mock.calls.map(([action]) => action.type);
    expect(dispatchedTypes.filter((type) => type === removeAssets.type)).toHaveLength(1);
    expect(dispatchedTypes.filter((type) => type === moveItemsToFolder.type)).toHaveLength(1);
    expect(dispatchedTypes.filter((type) => type === addAssets.type)).toHaveLength(1);
  });
});
