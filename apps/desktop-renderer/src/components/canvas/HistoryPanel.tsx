import { useDispatch, useSelector } from 'react-redux';
import { History, Plus, Trash2, MessageSquare } from 'lucide-react';
import type { RootState } from '../../store/index.js';
import { useI18n } from '../../hooks/use-i18n.js';
import { newSession, loadSession, deleteSession } from '../../store/slices/commander.js';
import { cn } from '../../lib/utils.js';

function formatDate(ts: number) {
  const d = new Date(ts);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  if (isToday) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function HistoryPanel() {
  const { t } = useI18n();
  const dispatch = useDispatch();
  const sessions = useSelector((state: RootState) => state.commander.sessions);
  const activeSessionId = useSelector((state: RootState) => state.commander.activeSessionId);
  const isStreaming = useSelector((state: RootState) => state.commander.streaming);

  return (
    <div className="h-full bg-card border-l border-border/60 flex flex-col">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border/60">
        <div className="flex items-center gap-2">
          <History className="w-3.5 h-3.5 text-muted-foreground" />
          <span className="text-xs font-medium">{t('history.title')}</span>
        </div>
        <button
          type="button"
          onClick={() => dispatch(newSession())}
          disabled={isStreaming}
          className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30"
          title={t('history.newSession')}
        >
          <Plus className="w-3 h-3" />
          {t('history.newSession')}
        </button>
      </div>

      {sessions.length === 0 ? (
        <div className="flex-1 flex items-center justify-center text-xs text-muted-foreground px-3 text-center">
          {t('history.empty')}
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto px-2 py-2 space-y-1">
          {sessions.map((session) => (
            <div
              key={session.id}
              className={cn(
                'group flex items-start gap-2 rounded-md px-2.5 py-2 cursor-pointer transition-colors hover:bg-muted/60',
                activeSessionId === session.id && 'bg-primary/10 border border-primary/20',
              )}
              onClick={() => {
                if (!isStreaming && activeSessionId !== session.id) {
                  dispatch(loadSession(session.id));
                }
              }}
            >
              <MessageSquare className="w-3.5 h-3.5 mt-0.5 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <div className="text-xs font-medium truncate">{session.title}</div>
                <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                  <span>{formatDate(session.updatedAt)}</span>
                  <span>{session.messages.length} {t('history.messages')}</span>
                </div>
              </div>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  dispatch(deleteSession(session.id));
                }}
                className="hidden group-hover:flex shrink-0 items-center justify-center rounded p-0.5 text-muted-foreground hover:text-destructive"
                title={t('history.delete')}
              >
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
