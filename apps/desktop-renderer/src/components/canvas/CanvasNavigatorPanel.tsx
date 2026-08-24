import React, { useMemo, useState } from 'react';
import {
  Archive,
  ArrowDownAZ,
  Check,
  Clock,
  Layers,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  Trash2,
} from 'lucide-react';
import { useDispatch, useSelector } from 'react-redux';
import { Virtuoso } from 'react-virtuoso';
import type { RootState } from '../../store/index.js';
import {
  addCanvas,
  archiveCanvas,
  removeCanvas,
  renameCanvas,
  restoreCanvas,
  setActiveCanvas,
} from '../../store/slices/canvas/canvas.js';
import { unassignSessionsFromCanvas } from '../../store/slices/commander.js';
import { selectCanvasMetadataList } from '../../store/slices/canvas/canvas-selectors.js';
import { getAPI } from '../../utils/api.js';
import { cn } from '../../lib/utils.js';
import { t, getLocale } from '../../i18n.js';
import { useConfirm } from '../../components/ui/ConfirmDialog.js';
import { enqueueToast } from '../../store/slices/toast.js';

type SortMode = 'recent' | 'name';

export function CanvasNavigatorPanel() {
  const { confirm, ConfirmDialog } = useConfirm();
  const dispatch = useDispatch();
  const canvases = useSelector(selectCanvasMetadataList);
  const activeCanvasId = useSelector((state: RootState) => state.canvas.activeCanvasId);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortMode, setSortMode] = useState<SortMode>('recent');

  const sortedCanvases = useMemo(() => {
    let filtered = canvases;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      filtered = canvases.filter((c) => c.name.toLowerCase().includes(q));
    }
    return [...filtered].sort((left, right) => {
      const archiveOrder =
        Number(left.archivedAt !== undefined) - Number(right.archivedAt !== undefined);
      if (archiveOrder !== 0) return archiveOrder;
      return sortMode === 'name'
        ? left.name.localeCompare(right.name)
        : right.updatedAt - left.updatedAt;
    });
  }, [canvases, searchQuery, sortMode]);

  const startEditing = (canvas: { id: string; name: string }) => {
    setEditingId(canvas.id);
    setEditingName(canvas.name);
  };

  const commitRename = async () => {
    if (!editingId) return;
    const name = editingName.trim();
    if (!name) {
      setEditingId(null);
      return;
    }

    const api = getAPI();
    if (!api) return;
    try {
      await api.canvas.rename(editingId, name);
      dispatch(renameCanvas({ id: editingId, name }));
      setEditingId(null);
    } catch (error) {
      dispatch(
        enqueueToast({
          variant: 'error',
          title: t('toast.error.operationFailed'),
          message: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  };

  const handleArchive = async (canvas: (typeof canvases)[number]) => {
    const confirmed = await confirm({
      title: t('history.archiveCanvasConfirm'),
      description: t('history.archiveCanvasDescription'),
      confirmLabel: t('history.archiveCanvas'),
      cancelLabel: t('action.cancel'),
    });
    if (!confirmed) return;
    try {
      const api = getAPI();
      if (!api?.canvas.delete) throw new Error('Canvas archive API is unavailable');
      await api.canvas.delete(canvas.id);
      dispatch(archiveCanvas({ id: canvas.id, archivedAt: Date.now() }));
    } catch (error) {
      dispatch(
        enqueueToast({
          variant: 'error',
          title: t('toast.error.operationFailed'),
          message: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  };

  const handleRestore = async (canvasId: string) => {
    try {
      const api = getAPI();
      if (!api?.canvas.restore) throw new Error('Canvas restore API is unavailable');
      await api.canvas.restore(canvasId);
      dispatch(restoreCanvas(canvasId));
    } catch (error) {
      dispatch(
        enqueueToast({
          variant: 'error',
          title: t('toast.error.operationFailed'),
          message: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  };

  const handlePermanentDelete = async (canvas: (typeof canvases)[number]) => {
    const confirmed = await confirm({
      title: t('history.deleteCanvasPermanentlyConfirm'),
      description: t('history.deleteCanvasPermanentlyDescription'),
      destructive: true,
      confirmLabel: t('history.deletePermanently'),
      cancelLabel: t('action.cancel'),
    });
    if (!confirmed) return;
    try {
      const api = getAPI();
      if (!api?.canvas.deletePermanent) {
        throw new Error('Permanent Canvas delete API is unavailable');
      }
      if (canvas.archivedAt === undefined) {
        if (!api.canvas.delete) {
          throw new Error('Canvas archive API is unavailable');
        }
        const archivedAt = Date.now();
        await api.canvas.delete(canvas.id);
        dispatch(archiveCanvas({ id: canvas.id, archivedAt }));
      }
      await api.canvas.deletePermanent(canvas.id);
      dispatch(unassignSessionsFromCanvas(canvas.id));
      dispatch(removeCanvas(canvas.id));
    } catch (error) {
      dispatch(
        enqueueToast({
          variant: 'error',
          title: t('toast.error.operationFailed'),
          message: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  };

  return (
    <div className="flex h-full flex-col bg-card">
      <div className="border-b border-border/60 px-3 py-2">
        <div className="flex items-center gap-2">
          <Layers className="h-3.5 w-3.5 text-primary" />
          <h2 className="text-xs font-semibold">{t('panels.canvasNavigator')}</h2>
        </div>
        <p className="mt-0.5 text-[11px] text-muted-foreground">
          {t('panels.canvasNavigatorHint')}
        </p>
      </div>

      {/* Search & Sort */}
      {canvases.length > 3 && (
        <div className="border-b border-border/60 px-3 py-1.5 flex items-center gap-1.5">
          <div className="flex flex-1 items-center gap-1 rounded-md border border-border/40 bg-muted/30 px-1.5 py-0.5">
            <Search className="h-3 w-3 text-muted-foreground shrink-0" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t('panels.searchCanvases')}
              className="flex-1 bg-transparent text-[11px] outline-none placeholder:text-muted-foreground/50"
            />
          </div>
          <button
            type="button"
            onClick={() => setSortMode((m) => (m === 'recent' ? 'name' : 'recent'))}
            className="shrink-0 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
            title={sortMode === 'recent' ? t('panels.sortByName') : t('panels.sortByRecent')}
          >
            {sortMode === 'recent' ? (
              <Clock className="h-3.5 w-3.5" />
            ) : (
              <ArrowDownAZ className="h-3.5 w-3.5" />
            )}
          </button>
        </div>
      )}

      <div className="border-b border-border/60 px-3 py-2">
        <button
          type="button"
          aria-label={t('panels.createCanvas')}
          onClick={async () => {
            const index = canvases.length + 1;
            const api = getAPI();
            if (!api) return;
            try {
              const created = await api.canvas.create(`Canvas ${index}`);
              if (!created) return;
              dispatch(addCanvas(created));
              dispatch(setActiveCanvas(created.id));
            } catch (error) {
              dispatch(
                enqueueToast({
                  variant: 'error',
                  title: t('toast.error.operationFailed'),
                  message: error instanceof Error ? error.message : String(error),
                }),
              );
            }
          }}
          className="inline-flex items-center gap-1.5 rounded-md bg-primary px-2.5 py-1.5 text-xs text-primary-foreground transition-opacity hover:opacity-90"
        >
          <Plus className="h-3.5 w-3.5" />
          {t('panels.createCanvas')}
        </button>
      </div>

      <div className="min-h-0 flex-1">
        <Virtuoso
          data={sortedCanvases}
          computeItemKey={(_index, canvas) => canvas.id}
          itemContent={(_index, canvas) => {
            const isActive = canvas.id === activeCanvasId;
            const isEditing = canvas.id === editingId;
            const isArchived = canvas.archivedAt !== undefined;

            return (
              <div data-canvas-id={canvas.id} className="px-2 pb-1.5 first:pt-2">
                {isArchived &&
                (_index === 0 || sortedCanvases[_index - 1]?.archivedAt === undefined) ? (
                  <div className="mb-1 flex items-center gap-1.5 px-1 py-1 text-[10px] font-medium text-muted-foreground">
                    <Archive className="h-3 w-3" aria-hidden="true" />
                    {t('history.archivedCanvases')}
                  </div>
                ) : null}
                <div
                  className={cn(
                    'rounded-md border border-border/60 bg-background px-2.5 py-1.5',
                    isActive && 'border-primary/50 bg-primary/5',
                    isArchived && 'opacity-70',
                  )}
                >
                  <div className="flex items-start gap-2">
                    <button
                      type="button"
                      aria-label={canvas.name}
                      disabled={isArchived}
                      onClick={() => dispatch(setActiveCanvas(canvas.id))}
                      className="flex min-w-0 flex-1 items-start gap-2 text-left"
                    >
                      <span
                        className={cn(
                          'mt-1 h-2.5 w-2.5 shrink-0 rounded-full',
                          isActive ? 'bg-primary' : 'bg-muted-foreground/30',
                        )}
                      />
                      <span className="min-w-0 flex-1">
                        {isEditing ? (
                          <input
                            autoFocus
                            value={editingName}
                            onChange={(event) => setEditingName(event.target.value)}
                            onBlur={() => void commitRename()}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter') {
                                event.preventDefault();
                                void commitRename();
                              }
                              if (event.key === 'Escape') {
                                setEditingId(null);
                              }
                            }}
                            className="w-full rounded-md border border-border/60 bg-card px-2 py-1 text-xs outline-none focus:ring-1 focus:ring-ring"
                          />
                        ) : (
                          <>
                            <span className="block truncate text-xs font-medium">
                              {canvas.name}
                            </span>
                            {isArchived ? (
                              <span className="mt-0.5 flex items-center gap-1 text-[10px] text-muted-foreground">
                                <Archive className="h-3 w-3" aria-hidden="true" />
                                {t('history.archivedCanvas')}
                              </span>
                            ) : null}
                            <span className="block text-[10px] text-muted-foreground">
                              {canvas.nodeCount} {t('panels.nodes')} · {canvas.edgeCount}{' '}
                              {t('panels.edges')}
                            </span>
                            <span className="block text-[11px] text-muted-foreground">
                              {new Date(canvas.updatedAt).toLocaleString(getLocale())}
                            </span>
                          </>
                        )}
                      </span>
                    </button>

                    <div className="flex items-center gap-1">
                      {isArchived ? (
                        <>
                          <button
                            type="button"
                            aria-label={`${t('history.restoreCanvas')} ${canvas.name}`}
                            onClick={() => void handleRestore(canvas.id)}
                            className="rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                          >
                            <RotateCcw className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            aria-label={`${t('history.deletePermanently')} ${canvas.name}`}
                            onClick={() => void handlePermanentDelete(canvas)}
                            className="rounded p-1 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </>
                      ) : isEditing ? (
                        <button
                          type="button"
                          aria-label={t('action.confirm')}
                          onClick={() => void commitRename()}
                          className="rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                        >
                          <Check className="h-3.5 w-3.5" />
                        </button>
                      ) : (
                        <button
                          type="button"
                          aria-label={t('panels.renameCanvas')}
                          onClick={() => startEditing(canvas)}
                          className="rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                      )}

                      {!isArchived ? (
                        <button
                          type="button"
                          aria-label={`${t('history.archiveCanvas')} ${canvas.name}`}
                          onClick={() => void handleArchive(canvas)}
                          className="rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                        >
                          <Archive className="h-3.5 w-3.5" />
                        </button>
                      ) : null}
                      {!isArchived ? (
                        <button
                          type="button"
                          aria-label={`${t('history.deletePermanently')} ${canvas.name}`}
                          onClick={() => void handlePermanentDelete(canvas)}
                          className="rounded p-1 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      ) : null}
                    </div>
                  </div>
                </div>
              </div>
            );
          }}
        />
      </div>
      {ConfirmDialog}
    </div>
  );
}
