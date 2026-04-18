import { useCallback, useEffect, useMemo } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import type { ActionCreatorWithPayload } from '@reduxjs/toolkit';
import type { Folder, FolderKind } from '@lucid-fin/contracts';
import type { RootState } from '../store/index.js';
import { getAPI } from '../utils/api.js';

/**
 * Bundle of folder-related action creators each kind-slice must expose. The
 * hook is agnostic to the specific slice — callers pass in the relevant
 * creators, so one hook drives characters/equipment/locations/assets.
 */
export interface FolderActionCreators {
  setFolders: ActionCreatorWithPayload<Folder[]>;
  addFolder: ActionCreatorWithPayload<Folder>;
  updateFolder: ActionCreatorWithPayload<Folder>;
  removeFolder: ActionCreatorWithPayload<string>;
  setCurrentFolder: ActionCreatorWithPayload<string | null>;
  setFoldersLoading: ActionCreatorWithPayload<boolean>;
}

export interface UseEntityFoldersArgs {
  kind: FolderKind;
  /** State selector returning the slice's folder substate. */
  selectFolders: (state: RootState) => Folder[];
  selectCurrentFolderId: (state: RootState) => string | null;
  selectFoldersLoading: (state: RootState) => boolean;
  actions: FolderActionCreators;
}

export interface UseEntityFoldersResult {
  folders: Folder[];
  currentFolderId: string | null;
  loading: boolean;
  /** Ordered ancestry from root → currentFolder (empty at root). */
  breadcrumb: Folder[];
  loadFolders: () => Promise<void>;
  createFolder: (parentId: string | null, name: string) => Promise<Folder | null>;
  renameFolder: (id: string, name: string) => Promise<Folder | null>;
  moveFolder: (id: string, newParentId: string | null) => Promise<Folder | null>;
  deleteFolder: (id: string) => Promise<void>;
  setCurrentFolder: (id: string | null) => void;
}

/**
 * Shared folder state + server-sync logic for the 4 entity kinds.
 * Keeps IPC calls + Redux writes colocated so panels only need UI concerns.
 */
export function useEntityFolders(args: UseEntityFoldersArgs): UseEntityFoldersResult {
  const { kind, selectFolders, selectCurrentFolderId, selectFoldersLoading, actions } = args;
  const dispatch = useDispatch();
  const folders = useSelector(selectFolders);
  const currentFolderId = useSelector(selectCurrentFolderId);
  const loading = useSelector(selectFoldersLoading);

  const apiGroup = useMemo(() => getAPI()?.folder[kind], [kind]);

  const loadFolders = useCallback(async () => {
    if (!apiGroup) return;
    dispatch(actions.setFoldersLoading(true));
    try {
      const list = (await apiGroup.list()) as Folder[];
      dispatch(actions.setFolders(list));
    } finally {
      dispatch(actions.setFoldersLoading(false));
    }
  }, [apiGroup, dispatch, actions]);

  useEffect(() => {
    void loadFolders();
  }, [loadFolders]);

  const createFolder = useCallback(
    async (parentId: string | null, name: string): Promise<Folder | null> => {
      if (!apiGroup) return null;
      const created = (await apiGroup.create(parentId, name)) as Folder;
      dispatch(actions.addFolder(created));
      return created;
    },
    [apiGroup, dispatch, actions],
  );

  const renameFolder = useCallback(
    async (id: string, name: string): Promise<Folder | null> => {
      if (!apiGroup) return null;
      const updated = (await apiGroup.rename(id, name)) as Folder;
      dispatch(actions.updateFolder(updated));
      return updated;
    },
    [apiGroup, dispatch, actions],
  );

  const moveFolder = useCallback(
    async (id: string, newParentId: string | null): Promise<Folder | null> => {
      if (!apiGroup) return null;
      const updated = (await apiGroup.move(id, newParentId)) as Folder;
      dispatch(actions.updateFolder(updated));
      return updated;
    },
    [apiGroup, dispatch, actions],
  );

  const deleteFolder = useCallback(
    async (id: string): Promise<void> => {
      if (!apiGroup) return;
      await apiGroup.delete(id);
      dispatch(actions.removeFolder(id));
    },
    [apiGroup, dispatch, actions],
  );

  const setCurrentFolder = useCallback(
    (id: string | null) => {
      dispatch(actions.setCurrentFolder(id));
    },
    [dispatch, actions],
  );

  const breadcrumb = useMemo(() => {
    if (!currentFolderId) return [];
    const byId = new Map(folders.map((f) => [f.id, f] as const));
    const chain: Folder[] = [];
    let cursor: string | null = currentFolderId;
    let guard = 0;
    while (cursor && guard < 64) {
      const node = byId.get(cursor);
      if (!node) break;
      chain.unshift(node);
      cursor = node.parentId;
      guard += 1;
    }
    return chain;
  }, [folders, currentFolderId]);

  return {
    folders,
    currentFolderId,
    loading,
    breadcrumb,
    loadFolders,
    createFolder,
    renameFolder,
    moveFolder,
    deleteFolder,
    setCurrentFolder,
  };
}
