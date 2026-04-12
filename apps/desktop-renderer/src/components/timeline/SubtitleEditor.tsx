import React, { useCallback, useRef } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { Plus, Trash2, Type } from 'lucide-react';
import type { RootState } from '../../store/index.js';
import {
  addSubtitle,
  updateSubtitle,
  removeSubtitle,
  selectClip,
  type SubtitleEntry,
} from '../../store/slices/timeline.js';
import { t } from '../../i18n.js';

export type { SubtitleEntry };

export function SubtitleEditor() {
  const dispatch = useDispatch();
  const { subtitles, selectedClipId } = useSelector((s: RootState) => s.timeline);

  const handleAdd = useCallback(() => {
    const lastEnd = subtitles.length > 0 ? subtitles[subtitles.length - 1].endTime : 0;
    const entry: SubtitleEntry = {
      id: crypto.randomUUID(),
      startTime: lastEnd,
      endTime: lastEnd + 3,
      text: '',
      fontSize: 24,
      color: '#ffffff',
      position: 'bottom',
      bgOpacity: 0.5,
    };
    dispatch(addSubtitle(entry));
    dispatch(selectClip(entry.id));
  }, [dispatch, subtitles]);

  const colorTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const handleUpdate = useCallback(
    (id: string, data: Partial<SubtitleEntry>) => {
      dispatch(updateSubtitle({ id, data }));
    },
    [dispatch],
  );

  /** Debounced color update — color picker fires onChange on every pixel move */
  const handleColorChange = useCallback(
    (id: string, color: string) => {
      clearTimeout(colorTimerRef.current);
      colorTimerRef.current = setTimeout(() => dispatch(updateSubtitle({ id, data: { color } })), 100);
    },
    [dispatch],
  );

  const handleRemove = useCallback(
    (id: string) => {
      dispatch(removeSubtitle(id));
      if (selectedClipId === id) dispatch(selectClip(null));
    },
    [dispatch, selectedClipId],
  );

  const editingId = selectedClipId;

  return (
    <div className="flex flex-col border-t bg-card">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b">
        <Type className="w-3.5 h-3.5 text-primary" />
        <span className="text-xs font-medium">{t('subtitleEditor.title')}</span>
        <div className="flex-1" />
        <button
          onClick={handleAdd}
          className="flex items-center gap-1 px-2 py-1 text-xs rounded bg-secondary hover:bg-muted"
        >
          <Plus className="w-3 h-3" /> {t('subtitleEditor.add')}
        </button>
      </div>

      {/* Entries */}
      <div className="max-h-48 overflow-y-auto">
        {subtitles.length === 0 ? (
          <div className="p-4 text-xs text-muted-foreground text-center">
            {t('subtitleEditor.empty')}
          </div>
        ) : (
          <div className="divide-y">
            {subtitles.map((entry) => (
              <div
                key={entry.id}
                className={`flex items-start gap-2 p-2 ${editingId === entry.id ? 'bg-muted/50' : ''}`}
                onClick={() => dispatch(selectClip(entry.id))}
              >
                {/* Time range */}
                <div className="flex flex-col gap-1 w-28 shrink-0">
                  <div className="flex items-center gap-1 text-[10px]">
                    <span className="text-muted-foreground">{t('subtitleEditor.in')}:</span>
                    <input
                      type="number"
                      step={0.1}
                      min={0}
                      value={entry.startTime}
                      onChange={(e) =>
                        handleUpdate(entry.id, { startTime: Number(e.target.value) })
                      }
                      className="w-16 px-1 py-0.5 text-xs rounded border bg-background"
                    />
                  </div>
                  <div className="flex items-center gap-1 text-[10px]">
                    <span className="text-muted-foreground">{t('subtitleEditor.out')}:</span>
                    <input
                      type="number"
                      step={0.1}
                      min={entry.startTime}
                      value={entry.endTime}
                      onChange={(e) => handleUpdate(entry.id, { endTime: Number(e.target.value) })}
                      className="w-16 px-1 py-0.5 text-xs rounded border bg-background"
                    />
                  </div>
                </div>

                {/* Text input */}
                <textarea
                  value={entry.text}
                  onChange={(e) => handleUpdate(entry.id, { text: e.target.value })}
                  className="flex-1 min-h-[3rem] px-2 py-1 text-xs rounded border bg-background resize-none"
                  placeholder={t('subtitleEditor.textPlaceholder')}
                />

                {/* Style controls (visible when editing) */}
                {editingId === entry.id && (
                  <div className="flex flex-col gap-1 w-24 shrink-0">
                    <select
                      value={entry.position}
                      onChange={(e) =>
                        handleUpdate(entry.id, {
                          position: e.target.value as SubtitleEntry['position'],
                        })
                      }
                      className="px-1 py-0.5 text-[10px] rounded border bg-background"
                    >
                      <option value="top">{t('subtitleEditor.position.top')}</option>
                      <option value="center">{t('subtitleEditor.position.center')}</option>
                      <option value="bottom">{t('subtitleEditor.position.bottom')}</option>
                    </select>
                    <input
                      type="number"
                      min={12}
                      max={72}
                      value={entry.fontSize}
                      onChange={(e) => handleUpdate(entry.id, { fontSize: Number(e.target.value) })}
                      className="px-1 py-0.5 text-[10px] rounded border bg-background"
                    />
                    <input
                      type="color"
                      value={entry.color}
                      onChange={(e) => handleColorChange(entry.id, e.target.value)}
                      className="w-full h-5 rounded border cursor-pointer"
                    />
                  </div>
                )}

                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleRemove(entry.id);
                  }}
                  className="p-1 rounded hover:bg-destructive/10"
                  aria-label={t('subtitleEditor.delete')}
                >
                  <Trash2 className="w-3 h-3 text-destructive" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
