import React, { useMemo, useState } from 'react';
import { Check, Layers, Pencil, Plus, Trash2 } from 'lucide-react';
import { useDispatch, useSelector } from 'react-redux';
import type { Canvas } from '@lucid-fin/contracts';
import type { RootState } from '../../store/index.js';
import { addCanvas, removeCanvas, renameCanvas, setActiveCanvas } from '../../store/slices/canvas.js';
import { getAPI } from '../../utils/api.js';
import { cn } from '../../lib/utils.js';
import { t } from '../../i18n.js';

export function CanvasNavigatorPanel() {
  const dispatch = useDispatch();
  const { canvases, activeCanvasId } = useSelector((state: RootState) => state.canvas);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');

  const sortedCanvases = useMemo(
    () => [...canvases].sort((left, right) => right.updatedAt - left.updatedAt),
    [canvases],
  );

  const startEditing = (canvas: Canvas) => {
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

    dispatch(renameCanvas({ id: editingId, name }));
    setEditingId(null);
    await getAPI()?.canvas.rename(editingId, name);
  };

  return (
    <div className="flex h-full flex-col bg-card">
      <div className="border-b px-4 py-3">
        <div className="flex items-center gap-2">
          <Layers className="h-4 w-4 text-primary" />
          <h2 className="text-sm font-semibold">{t('panels.canvasNavigator')}</h2>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">{t('panels.canvasNavigatorHint')}</p>
      </div>

      <div className="border-b px-4 py-3">
        <button
          type="button"
          aria-label={t('panels.createCanvas')}
          onClick={async () => {
            const index = canvases.length + 1;
            const created = await getAPI()?.canvas.create(`Canvas ${index}`);
            if (!created) return;
            dispatch(addCanvas(created));
            dispatch(setActiveCanvas(created.id));
          }}
          className="inline-flex items-center gap-2 rounded-full bg-primary px-3 py-2 text-sm text-primary-foreground transition-opacity hover:opacity-90"
        >
          <Plus className="h-4 w-4" />
          {t('panels.createCanvas')}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-3">
        <div className="space-y-2">
          {sortedCanvases.map((canvas) => {
            const isActive = canvas.id === activeCanvasId;
            const isEditing = canvas.id === editingId;

            return (
              <div
                key={canvas.id}
                className={cn(
                  'rounded-xl border border-border bg-background px-3 py-2',
                  isActive && 'border-primary/50 bg-primary/5',
                )}
              >
                <div className="flex items-start gap-2">
                  <button
                    type="button"
                    aria-label={canvas.name}
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
                          className="w-full rounded border border-border bg-card px-2 py-1 text-sm outline-none focus:ring-1 focus:ring-ring"
                        />
                      ) : (
                        <>
                          <span className="block truncate text-sm font-medium">{canvas.name}</span>
                          <span className="block text-xs text-muted-foreground">
                            {new Date(canvas.updatedAt).toLocaleString()}
                          </span>
                        </>
                      )}
                    </span>
                  </button>

                  <div className="flex items-center gap-1">
                    {isEditing ? (
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

                    <button
                      type="button"
                      aria-label={`${t('action.delete')} ${canvas.name}`}
                      onClick={async () => {
                        if (!window.confirm(t('panels.deleteCanvasConfirm'))) return;
                        dispatch(removeCanvas(canvas.id));
                        await getAPI()?.canvas.delete(canvas.id);
                      }}
                      className="rounded p-1 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
