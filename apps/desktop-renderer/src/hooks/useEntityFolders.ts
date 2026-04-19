import { useCallback, useEffect, useMemo, useRef } from 'react';
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

  // Callers pass a fresh `{ actions: {...} }` object literal per render. Stash
  // it in a ref so callbacks below stay identity-stable — otherwise
  // `loadFolders`'s identity changes every render, its effect refires, IPC
  // spams `folder.<kind>:list`, and dispatches re-trigger the cycle until the
  // app freezes.
  const actionsRef = useRef(actions);
  actionsRef.current = actions;

  const apiGroup = useMemo(() => getAPI()?.folder?.[kind], [kind]);

  const loadFolders = useCallback(async () => {
    if (!apiGroup) return;
    dispatch(actionsRef.current.setFoldersLoading(true));
    try {
      const list = (await apiGroup.list()) as Folder[];
      dispatch(actionsRef.current.setFolders(list));
    } catch (reason) {
      console.error(`[useEntityFolders:${kind}] loadFolders failed`, reason);
    } finally {
      dispatch(actionsRef.current.setFoldersLoading(false));
    }
  }, [apiGroup, dispatch, kind]);

  useEffect(() => {
    void loadFolders();
  }, [loadFolders]);

  const createFolder = useCallback(
    async (parentId: string | null, name: string): Promise<Folder | null> => {
      if (!apiGroup) return null;
      try {
        const created = (await apiGroup.create(parentId, name)) as Folder;
        dispatch(actionsRef.current.addFolder(created));
        return created;
      } catch (reason) {
        console.error(`[useEntityFolders:${kind}] createFolder failed`, reason);
        return null;
      }
    },
    [apiGroup, dispatch, kind],
  );

  const renameFolder = useCallback(
    async (id: string, name: string): Promise<Folder | null> => {
      if (!apiGroup) return null;
      try {
        const updated = (await apiGroup.rename(id, name)) as Folder;
        dispatch(actionsRef.current.updateFolder(updated));
        return updated;
      } catch (reason) {
        console.error(`[useEntityFolders:${kind}] renameFolder failed`, reason);
        return null;
      }
    },
    [apiGroup, dispatch, kind],
  );

  const moveFolder = useCallback(
    async (id: string, newParentId: string | null): Promise<Folder | null> => {
      if (!apiGroup) return null;
      try {
        const updated = (await apiGroup.move(id, newParentId)) as Folder;
        dispatch(actionsRef.current.updateFolder(updated));
        return updated;
      } catch (reason) {
        console.error(`[useEntityFolders:${kind}] moveFolder failed`, reason);
        return null;
      }
    },
    [apiGroup, dispatch, kind],
  );

  const deleteFolder = useCallback(
    async (id: string): Promise<void> => {
      if (!apiGroup) return;
      try {
        await apiGroup.delete(id);
        dispatch(actionsRef.current.removeFolder(id));
      } catch (reason) {
        console.error(`[useEntityFolders:${kind}] deleteFolder failed`, reason);
      }
    },
    [apiGroup, dispatch, kind],
  );

  const setCurrentFolder = useCallback(
    (id: string | null) => {
      dispatch(actionsRef.current.setCurrentFolder(id));
    },
    [dispatch],
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
