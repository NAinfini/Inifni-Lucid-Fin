import { useDispatch, useSelector } from 'react-redux';
import { Plus, StickyNote, Trash2 } from 'lucide-react';
import type { RootState } from '../../store/index.js';
import { addCanvasNote, updateCanvasNote, deleteCanvasNote } from '../../store/slices/canvas.js';
import { useI18n } from '../../hooks/use-i18n.js';

export function CanvasNotesPanel() {
  const { t } = useI18n();
  const dispatch = useDispatch();
  const { canvases, activeCanvasId } = useSelector((state: RootState) => state.canvas);
  const activeCanvas = canvases.find((c) => c.id === activeCanvasId);
  const notes = activeCanvas?.notes ?? [];

  return (
    <div className="h-full bg-card border-l flex flex-col">
      <div className="flex items-center justify-between px-4 py-3 border-b">
        <div className="flex items-center gap-2">
          <StickyNote className="w-4 h-4 text-muted-foreground" />
          <span className="text-sm font-medium">{t('canvasNotes.title')}</span>
        </div>
        <button
          type="button"
          onClick={() => dispatch(addCanvasNote({}))}
          className="p-1 rounded hover:bg-accent transition-colors"
          title={t('canvasNotes.addNote')}
        >
          <Plus className="w-4 h-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {notes.length === 0 ? (
          <div className="text-sm text-muted-foreground/50 text-center py-8">
            {t('canvasNotes.empty')}
          </div>
        ) : (
          notes.map((note) => (
            <div key={note.id} className="bg-background rounded border p-3 space-y-2">
              <textarea
                className="w-full resize-none bg-transparent text-sm outline-none placeholder:text-muted-foreground/50 leading-relaxed min-h-[80px]"
                placeholder={t('canvasNotes.placeholder')}
                value={note.content}
                onChange={(e) => dispatch(updateCanvasNote({ id: note.id, content: e.target.value }))}
              />
              <div className="flex items-center justify-between">
                <div className="text-[10px] text-muted-foreground">
                  {note.content.length} {t('canvasNotes.chars')}
                </div>
                <button
                  type="button"
                  onClick={() => dispatch(deleteCanvasNote({ id: note.id }))}
                  className="p-1 rounded hover:bg-destructive/10 hover:text-destructive transition-colors"
                  title={t('canvasNotes.deleteNote')}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
