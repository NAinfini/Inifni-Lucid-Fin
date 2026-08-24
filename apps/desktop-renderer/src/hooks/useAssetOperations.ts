import { useCallback, useMemo, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import type { AssetEntry } from '@lucid-fin/contracts';
import type { RootState } from '../store/index.js';
import {
  addAssets,
  moveItemsToFolder,
  removeAssets,
  setAssets,
  type Asset,
} from '../store/slices/assets.js';
import { addLog } from '../store/slices/logger.js';
import { getAPI } from '../utils/api.js';
import { t } from '../i18n.js';
import { useToast } from './use-toast.js';
import {
  getErrorMessage,
  getErrorDetail,
  formatFailureSummary,
} from '../components/canvas/asset-browser/utils.js';

function toAsset(asset: AssetEntry): Asset {
  const generationMetadata = asset.generationMetadata;
  return {
    id: asset.id,
    hash: asset.hash,
    name:
      typeof asset.displayName === 'string' && asset.displayName.trim()
        ? asset.displayName
        : typeof asset.originalName === 'string' && asset.originalName.trim()
          ? asset.originalName
          : asset.hash.slice(0, 12),
    type: (asset.type as Asset['type']) ?? 'other',
    path: '',
    tags: Array.isArray(asset.tags) ? asset.tags : [],
    global: false,
    size: typeof asset.fileSize === 'number' ? asset.fileSize : 0,
    createdAt: typeof asset.createdAt === 'number' ? asset.createdAt : Date.now(),
    format: typeof asset.format === 'string' ? asset.format : undefined,
    width: typeof asset.width === 'number' ? asset.width : undefined,
    height: typeof asset.height === 'number' ? asset.height : undefined,
    duration: typeof asset.duration === 'number' ? asset.duration : undefined,
    provider: typeof asset.provider === 'string' ? asset.provider : undefined,
    prompt:
      typeof generationMetadata?.prompt === 'string'
        ? generationMetadata.prompt
        : typeof asset.prompt === 'string'
          ? asset.prompt
          : undefined,
    negativePrompt:
      typeof generationMetadata?.negativePrompt === 'string'
        ? generationMetadata.negativePrompt
        : undefined,
    promptAssemblyId:
      typeof generationMetadata?.promptAssemblyId === 'string'
        ? generationMetadata.promptAssemblyId
        : undefined,
    folderId: typeof asset.folderId === 'string' ? asset.folderId : null,
  };
}

/**
 * Encapsulates asset CRUD operations (load, import, drop-import, delete, export, copy-hash).
 * Used by AssetBrowserPanel to keep the component focused on rendering.
 */
export function useAssetOperations() {
  const dispatch = useDispatch();
  const { error: showErrorToast } = useToast();
  const allAssets = useSelector((state: RootState) => state.assets.items);
  const assetsById = useMemo(
    () => new Map(allAssets.map((asset) => [asset.id, asset])),
    [allAssets],
  );
  const { filterType } = useSelector((state: RootState) => state.assets);

  const [loading, setLoading] = useState(false);
  const logAssetFailure = useCallback(
    (message: string, error: unknown) => {
      dispatch(
        addLog({ level: 'error', category: 'asset', message, detail: getErrorDetail(error) }),
      );
    },
    [dispatch],
  );

  // --- Load ---
  const loadAssets = useCallback(async () => {
    setLoading(true);
    try {
      const api = getAPI();
      const result = await api?.assetEntry.query(filterType === 'all' ? {} : { type: filterType });
      if (!Array.isArray(result)) return;

      dispatch(setAssets(result.map(toAsset)));
    } catch (error) {
      const title = t('assetBrowser.loadFailed');
      logAssetFailure(title, error);
      showErrorToast({ title, message: getErrorMessage(error) });
    } finally {
      setLoading(false);
    }
  }, [dispatch, filterType, logAssetFailure, showErrorToast]);

  // --- Import (file picker) ---
  const handleImport = useCallback(async () => {
    const api = getAPI();
    if (!api) return;
    if (filterType === 'all') {
      showErrorToast({
        title: t('assetBrowser.importFailed'),
        message: t('assetBrowser.selectImportType'),
      });
      return;
    }
    try {
      const ref = await api.assetEntry.pickFile(filterType);
      if (!ref) return;
      await loadAssets();
    } catch (error) {
      const title = t('assetBrowser.importFailed');
      logAssetFailure(title, error);
      showErrorToast({ title, message: getErrorMessage(error) });
    }
  }, [filterType, loadAssets, logAssetFailure, showErrorToast]);

  // --- Drop import ---
  const handleDropImport = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      const api = getAPI();
      if (!api) return;

      const nodeAssetRaw = e.dataTransfer.getData('application/x-lucid-node-asset');
      if (nodeAssetRaw) {
        await loadAssets();
        return;
      }

      const files = e.dataTransfer.files;
      if (files.length === 0) return;
      const importPromises: Promise<void>[] = [];
      const failedImports: string[] = [];
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        if (!file) continue;
        let type: string | null = null;
        if (file.type.startsWith('image/')) type = 'image';
        else if (file.type.startsWith('video/')) type = 'video';
        else if (file.type.startsWith('audio/')) type = 'audio';
        if (!type) {
          const msg = `${file.name}: ${t('assetBrowser.unsupportedFileType')}`;
          failedImports.push(msg);
          dispatch(addLog({ level: 'warn', category: 'asset', message: msg }));
          continue;
        }
        const filePath = (file as { path?: string }).path ?? '';
        if (filePath) {
          importPromises.push(
            api.assetEntry
              .import(filePath, type)
              .then(() => undefined)
              .catch((error: unknown) => {
                const msg = `${file.name}: ${getErrorMessage(error)}`;
                failedImports.push(msg);
                dispatch(addLog({ level: 'error', category: 'asset', message: msg }));
              }),
          );
        } else if (api.assetEntry.importBuffer) {
          importPromises.push(
            file
              .arrayBuffer()
              .then((buf) => api.assetEntry.importBuffer(buf, file.name, type!))
              .then(() => undefined)
              .catch((error: unknown) => {
                const msg = `${file.name}: ${getErrorMessage(error)}`;
                failedImports.push(msg);
                dispatch(addLog({ level: 'error', category: 'asset', message: msg }));
              }),
          );
        } else {
          const msg = `${file.name}: ${t('assetBrowser.importPathUnavailable')}`;
          failedImports.push(msg);
          dispatch(addLog({ level: 'error', category: 'asset', message: msg }));
        }
      }
      await Promise.all(importPromises);
      if (failedImports.length > 0) {
        const summary = failedImports[0] ?? t('toast.error.unknownError');
        const extraCount = failedImports.length - 1;
        showErrorToast({
          title: t('assetBrowser.importFailed'),
          message: formatFailureSummary(summary, extraCount),
        });
      }
      await loadAssets();
    },
    [dispatch, loadAssets, showErrorToast],
  );

  // --- Delete ---
  const executeDelete = useCallback(
    async (pendingDeleteEntryIds: Set<string>) => {
      const api = getAPI();
      if (!api) return new Set<string>();
      const entryIds = [...pendingDeleteEntryIds];
      if (entryIds.length === 0) return new Set<string>();
      try {
        const { deletedEntryIds } = await api.assetEntry.delete(entryIds);
        dispatch(removeAssets(deletedEntryIds));
        return new Set(deletedEntryIds);
      } catch (error) {
        const names = entryIds.map((id) => assetsById.get(id)?.name ?? id).join(', ');
        const message = `${names}: ${getErrorMessage(error)}`;
        dispatch(addLog({ level: 'error', category: 'asset', message }));
        showErrorToast({
          title: t('assetBrowser.deleteFailed'),
          message,
        });
        return new Set<string>();
      }
    },
    [assetsById, dispatch, showErrorToast],
  );

  const executeMove = useCallback(
    async (entryIds: string[], folderId: string | null) => {
      if (entryIds.length === 0) return [];
      const api = getAPI();
      if (!api) return [];
      const { movedEntryIds } = await api.assetEntry.move(entryIds, folderId);
      dispatch(moveItemsToFolder({ ids: movedEntryIds, folderId }));
      return movedEntryIds;
    },
    [dispatch],
  );

  const executeCopy = useCallback(
    async (entryIds: string[], targetFolderId: string | null) => {
      if (entryIds.length === 0) return [];
      const api = getAPI();
      if (!api) return [];
      const copied = await api.assetEntry.copy(entryIds, targetFolderId);
      const created = copied.map(toAsset);
      dispatch(addAssets(created));
      return created;
    },
    [dispatch],
  );

  // --- Export ---
  const handleQuickExport = useCallback(
    async (asset: Asset, exportConfig: { type: 'image' | 'video' | 'audio'; format: string }) => {
      const api = getAPI();
      if (!api) return;
      try {
        await api.assetContent.export({
          hash: asset.hash,
          type: exportConfig.type,
          format: exportConfig.format,
          name: asset.name,
        });
      } catch (error) {
        const title = t('assetBrowser.exportFailed');
        logAssetFailure(title, error);
        showErrorToast({ title, message: getErrorMessage(error) });
      }
    },
    [logAssetFailure, showErrorToast],
  );

  // --- Copy hash ---
  const handleCopyHash = useCallback(
    async (hash: string) => {
      try {
        await navigator.clipboard.writeText(hash);
      } catch (error) {
        const title = t('assetBrowser.copyHashFailed');
        logAssetFailure(title, error);
        showErrorToast({ title, message: getErrorMessage(error) });
      }
    },
    [logAssetFailure, showErrorToast],
  );

  return {
    loading,
    loadAssets,
    handleImport,
    handleDropImport,
    executeDelete,
    executeMove,
    executeCopy,
    handleQuickExport,
    handleCopyHash,
  };
}
