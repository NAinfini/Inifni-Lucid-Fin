import { useCallback, useRef, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import type { RootState } from '../store/index.js';
import {
  setAssets,
  removeAsset,
  type Asset,
} from '../store/slices/assets.js';
import { addLog } from '../store/slices/logger.js';
import { getAPI } from '../utils/api.js';
import { t } from '../i18n.js';
import { useToast } from './use-toast.js';
import { getErrorMessage, getErrorDetail, formatFailureSummary } from '../components/canvas/asset-browser/utils.js';

/**
 * Encapsulates asset CRUD operations (load, import, drop-import, delete, export, copy-hash, reindex).
 * Used by AssetBrowserPanel to keep the component focused on rendering.
 */
export function useAssetOperations() {
  const dispatch = useDispatch();
  const { error: showErrorToast } = useToast();
  const allAssets = useSelector((state: RootState) => state.assets.items);
  const { filterType } = useSelector((state: RootState) => state.assets);

  const [loading, setLoading] = useState(false);
  const [semanticIndexing, setSemanticIndexing] = useState(false);
  const [semanticResults, setSemanticResults] = useState<{ hash: string; score: number; description: string }[]>([]);
  const semanticSearchTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const logAssetFailure = useCallback((message: string, error: unknown) => {
    dispatch(
      addLog({ level: 'error', category: 'asset', message, detail: getErrorDetail(error) }),
    );
  }, [dispatch]);

  // --- Load ---
  const loadAssets = useCallback(async () => {
    setLoading(true);
    try {
      const api = getAPI();
      const result = await api?.asset.query(filterType === 'all' ? {} : { type: filterType });
      if (!Array.isArray(result)) return;

      dispatch(
        setAssets(
          result.map((asset) => ({
            id: asset.hash,
            hash: asset.hash,
            name: typeof asset.name === 'string' ? asset.name : (typeof asset.originalName === 'string' ? asset.originalName : asset.hash.slice(0, 12)),
            type: (asset.type as Asset['type']) ?? 'other',
            path: typeof asset.path === 'string' ? asset.path : '',
            tags: Array.isArray(asset.tags) ? (asset.tags as string[]) : [],
            global: Boolean(asset.global),
            size: typeof asset.fileSize === 'number' ? asset.fileSize : (typeof asset.size === 'number' ? asset.size : 0),
            createdAt: typeof asset.createdAt === 'number' ? asset.createdAt : Date.now(),
            format: typeof asset.format === 'string' ? asset.format : undefined,
            width: typeof asset.width === 'number' ? asset.width : undefined,
            height: typeof asset.height === 'number' ? asset.height : undefined,
            duration: typeof asset.duration === 'number' ? asset.duration : undefined,
            provider: typeof asset.provider === 'string' ? asset.provider : undefined,
            prompt: typeof asset.prompt === 'string' ? asset.prompt : undefined,
            folderId: typeof asset.folderId === 'string' ? asset.folderId : null,
          })),
        ),
      );
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
    try {
      const ref = await api.asset.pickFile('image');
      if (!ref) return;
      await loadAssets();
    } catch (error) {
      const title = t('assetBrowser.importFailed');
      logAssetFailure(title, error);
      showErrorToast({ title, message: getErrorMessage(error) });
    }
  }, [loadAssets, logAssetFailure, showErrorToast]);

  // --- Drop import ---
  const handleDropImport = useCallback(async (e: React.DragEvent) => {
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
          api.asset.import(filePath, type)
            .then(() => undefined)
            .catch((error: unknown) => {
              const msg = `${file.name}: ${getErrorMessage(error)}`;
              failedImports.push(msg);
              dispatch(addLog({ level: 'error', category: 'asset', message: msg }));
            }),
        );
      } else if (api.asset.importBuffer) {
        importPromises.push(
          file.arrayBuffer()
            .then((buf) => api.asset.importBuffer!(buf, file.name, type!))
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
      showErrorToast({ title: t('assetBrowser.importFailed'), message: formatFailureSummary(summary, extraCount) });
    }
    await loadAssets();
  }, [dispatch, loadAssets, showErrorToast]);

  // --- Delete ---
  const executeDelete = useCallback(async (pendingDeleteHashes: Set<string>) => {
    const api = getAPI();
    if (!api) return new Set<string>();
    const deletedHashes = new Set<string>();
    const failedDeletes: string[] = [];
    for (const hash of pendingDeleteHashes) {
      const asset = allAssets.find((entry) => entry.hash === hash);
      try {
        await api.asset.delete(hash);
        deletedHashes.add(hash);
        if (asset) dispatch(removeAsset(asset.id));
      } catch (error) {
        const msg = `${asset?.name ?? hash}: ${getErrorMessage(error)}`;
        failedDeletes.push(msg);
        dispatch(addLog({ level: 'error', category: 'asset', message: msg }));
      }
    }
    if (failedDeletes.length > 0) {
      const summary = failedDeletes[0] ?? t('toast.error.unknownError');
      const extraCount = failedDeletes.length - 1;
      showErrorToast({ title: t('assetBrowser.deleteFailed'), message: formatFailureSummary(summary, extraCount) });
    }
    return deletedHashes;
  }, [allAssets, dispatch, showErrorToast]);

  // --- Export ---
  const handleExportSelected = useCallback(async (items: Array<{ hash: string; type: 'image' | 'video' | 'audio'; name: string }>) => {
    const api = getAPI();
    if (!api || items.length === 0) return;
    try {
      await api.asset.exportBatch({ items });
    } catch (error) {
      const title = t('assetBrowser.exportFailed');
      logAssetFailure(title, error);
      showErrorToast({ title, message: getErrorMessage(error) });
    }
  }, [logAssetFailure, showErrorToast]);

  const handleQuickExport = useCallback(async (asset: Asset, exportConfig: { type: 'image' | 'video' | 'audio'; format: string }) => {
    const api = getAPI();
    if (!api) return;
    try {
      await api.asset.export({ hash: asset.hash, type: exportConfig.type, format: exportConfig.format, name: asset.name });
    } catch (error) {
      const title = t('assetBrowser.exportFailed');
      logAssetFailure(title, error);
      showErrorToast({ title, message: getErrorMessage(error) });
    }
  }, [logAssetFailure, showErrorToast]);

  // --- Copy hash ---
  const handleCopyHash = useCallback(async (hash: string) => {
    try {
      await navigator.clipboard.writeText(hash);
    } catch (error) {
      const title = t('assetBrowser.copyHashFailed');
      logAssetFailure(title, error);
      showErrorToast({ title, message: getErrorMessage(error) });
    }
  }, [logAssetFailure, showErrorToast]);

  // --- Semantic search ---
  const handleSemanticSearch = useCallback(async (query: string) => {
    if (!query.trim()) { setSemanticResults([]); return; }
    const api = getAPI();
    if (!api?.embedding) return;
    try {
      const results = await api.embedding.search(query, 50);
      setSemanticResults(results);
    } catch (error) {
      dispatch(addLog({ level: 'error', category: 'asset', message: 'Semantic search failed', detail: getErrorDetail(error) }));
      setSemanticResults([]);
    }
  }, [dispatch]);

  const handleReindex = useCallback(async () => {
    const api = getAPI();
    if (!api?.embedding) return;
    setSemanticIndexing(true);
    try {
      await api.embedding.reindex();
    } catch (error) {
      dispatch(addLog({ level: 'error', category: 'asset', message: 'Re-index failed', detail: getErrorDetail(error) }));
    } finally {
      setSemanticIndexing(false);
    }
  }, [dispatch]);

  /** Schedule a debounced semantic search (for typing in search box) */
  const scheduleSemanticSearch = useCallback((query: string) => {
    clearTimeout(semanticSearchTimerRef.current);
    semanticSearchTimerRef.current = setTimeout(() => void handleSemanticSearch(query), 350);
  }, [handleSemanticSearch]);

  return {
    loading,
    semanticIndexing,
    semanticResults,
    setSemanticResults,
    loadAssets,
    handleImport,
    handleDropImport,
    executeDelete,
    handleExportSelected,
    handleQuickExport,
    handleCopyHash,
    handleSemanticSearch,
    handleReindex,
    scheduleSemanticSearch,
  };
}
