import { useSelector } from 'react-redux';
import { History } from 'lucide-react';
import type { RootState } from '../../store/index.js';
import { useI18n } from '../../hooks/use-i18n.js';

function formatTime(ts: number) {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function HistoryPanel() {
  const { t } = useI18n();
  const messages = useSelector((state: RootState) => state.commander.messages);

  const formatRole = (role: 'user' | 'assistant') =>
    role === 'user' ? t('history.you') : t('history.commander');

  return (
    <div className="h-full bg-card border-l border-border/60 flex flex-col">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border/60">
        <History className="w-3.5 h-3.5 text-muted-foreground" />
        <span className="text-xs font-medium">{t('history.title')}</span>
      </div>

      {messages.length === 0 ? (
        <div className="flex-1 flex items-center justify-center text-xs text-muted-foreground px-3 text-center">
          {t('history.empty')}
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto px-3 py-2 space-y-1.5">
          {[...messages].reverse().map((msg) => (
            <div
              key={msg.id}
              className="p-2.5 rounded-md bg-muted/40 border border-border/60 space-y-1"
            >
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-medium text-muted-foreground">
                  {formatRole(msg.role)}
                </span>
                <span className="text-[10px] text-muted-foreground">{formatTime(msg.timestamp)}</span>
              </div>
              <div className="text-xs whitespace-pre-wrap line-clamp-4">{msg.content}</div>
              {msg.toolCalls && msg.toolCalls.length > 0 && (
                <div className="text-[10px] text-muted-foreground">
                  {msg.toolCalls.length} {t('history.toolCalls')}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
