import { useCallback } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { Plus, StickyNote, Trash2 } from 'lucide-react';
import type { RootState } from '../../store/index.js';
import { addCanvasNote, updateCanvasNote, deleteCanvasNote } from '../../store/slices/canvas.js';
import { useI18n } from '../../hooks/use-i18n.js';
import { useDebouncedDispatch } from '../../hooks/useDebouncedDispatch.js';

function NoteTextarea({ noteId, content, dispatch, t }: { noteId: string; content: string; dispatch: ReturnType<typeof useDispatch>; t: (key: string) => string }) {
  const [local, setLocal] = useDebouncedDispatch(
    content,
    useCallback((v: string) => dispatch(updateCanvasNote({ id: noteId, content: v })), [dispatch, noteId]),
    300,
  );
  return (
    <textarea
      className="w-full resize-none bg-transparent text-xs outline-none placeholder:text-muted-foreground/50 leading-relaxed min-h-[72px]"
      placeholder={t('canvasNotes.placeholder')}
      value={local}
      onChange={(e) => setLocal(e.target.value)}
    />
  );
}

export function CanvasNotesPanel() {
  const { t } = useI18n();
  const dispatch = useDispatch();
  const { canvases, activeCanvasId } = useSelector((state: RootState) => state.canvas);
  const activeCanvas = canvases.find((c) => c.id === activeCanvasId);
  const notes = activeCanvas?.notes ?? [];

  return (
    <div className="h-full bg-card border-l border-border/60 flex flex-col">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border/60">
        <div className="flex items-center gap-2">
          <StickyNote className="w-3.5 h-3.5 text-muted-foreground" />
          <span className="text-xs font-medium">{t('canvasNotes.title')}</span>
        </div>
        <button
          type="button"
          onClick={() => dispatch(addCanvasNote({}))}
          className="p-0.5 rounded-md hover:bg-accent transition-colors"
          title={t('canvasNotes.addNote')}
        >
          <Plus className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-2.5 space-y-2">
        {notes.length === 0 ? (
          <div className="text-xs text-muted-foreground/50 text-center py-8">
            {t('canvasNotes.empty')}
          </div>
        ) : (
          notes.map((note) => (
            <div key={note.id} className="bg-background rounded-md border border-border/60 p-2.5 space-y-1.5">
              <NoteTextarea noteId={note.id} content={note.content} dispatch={dispatch} t={t} />
              <div className="flex items-center justify-between">
                <div className="text-[10px] text-muted-foreground">
                  {note.content.length} {t('canvasNotes.chars')}
                </div>
                <button
                  type="button"
                  onClick={() => dispatch(deleteCanvasNote({ id: note.id }))}
                  className="p-0.5 rounded-md hover:bg-destructive/10 hover:text-destructive transition-colors"
                  title={t('canvasNotes.deleteNote')}
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
