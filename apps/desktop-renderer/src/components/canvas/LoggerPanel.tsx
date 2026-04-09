import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, ChevronRight, Copy, ScrollText, Trash2, X } from 'lucide-react';
import { useDispatch, useSelector } from 'react-redux';
import type { AppDispatch, RootState } from '../../store/index.js';
import { clearLogs, type LogLevel } from '../../store/slices/logger.js';
import { setRightPanel } from '../../store/slices/ui.js';
import { cn } from '../../lib/utils.js';
import { useI18n } from '../../hooks/use-i18n.js';

type FilterLevel = 'all' | LogLevel;

const LEVEL_STYLES: Record<LogLevel, string> = {
  debug: 'text-gray-400 bg-gray-500/10',
  info: 'text-blue-400 bg-blue-500/10',
  warn: 'text-amber-400 bg-amber-500/10',
  error: 'text-red-400 bg-red-500/10',
};

const TOGGLE_LEVELS: Array<{ value: LogLevel; label: string; activeClass: string }> = [
  { value: 'debug', label: 'logger.filterDebug', activeClass: 'border-gray-400 bg-gray-500/15 text-gray-300' },
  { value: 'info', label: 'logger.filterInfo', activeClass: 'border-blue-400 bg-blue-500/15 text-blue-400' },
  { value: 'warn', label: 'logger.filterWarn', activeClass: 'border-amber-400 bg-amber-500/15 text-amber-400' },
  { value: 'error', label: 'logger.filterError', activeClass: 'border-red-400 bg-red-500/15 text-red-400' },
];

function formatTimestamp(timestamp: number): string {
  return new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(new Date(timestamp));
}

export function LoggerPanel() {
  const dispatch = useDispatch<AppDispatch>();
  const { t } = useI18n();
  const entries = useSelector((state: RootState) => state.logger.entries);
  const [enabledLevels, setEnabledLevels] = useState<Set<LogLevel>>(new Set(['info', 'warn', 'error']));
  const [expandedIds, setExpandedIds] = useState<string[]>([]);
  const listRef = useRef<HTMLDivElement | null>(null);

  const [copiedId, setCopiedId] = useState<string | null>(null);

  const filteredEntries = entries.filter((entry) => enabledLevels.has(entry.level));

  const toggleLevel = (level: LogLevel) => {
    setEnabledLevels((prev) => {
      const next = new Set(prev);
      if (next.has(level)) next.delete(level);
      else next.add(level);
      return next;
    });
  };

  const handleCopyEntry = useCallback((entry: typeof entries[0], e?: React.MouseEvent) => {
    e?.stopPropagation();
    const text = `[${formatTimestamp(entry.timestamp)}] [${entry.level.toUpperCase()}] [${entry.category}] ${entry.message}${entry.detail ? '\n' + entry.detail : ''}`;
    void navigator.clipboard.writeText(text).then(() => {
      setCopiedId(entry.id);
      setTimeout(() => setCopiedId(null), 1500);
    });
  }, []);

  const handleCopyAll = useCallback(() => {
    const text = filteredEntries.map((e) =>
      `[${formatTimestamp(e.timestamp)}] [${e.level.toUpperCase()}] [${e.category}] ${e.message}${e.detail ? '\n' + e.detail : ''}`
    ).join('\n');
    void navigator.clipboard.writeText(text);
  }, [filteredEntries]);

  useEffect(() => {
    const node = listRef.current;
    if (!node) return;
    node.scrollTop = node.scrollHeight;
  }, [filteredEntries]);

  return (
    <div className="h-full bg-card border-l border-border/60 flex flex-col">
      <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-border/60">
        <div className="flex items-center gap-2">
          <ScrollText className="w-3.5 h-3.5 text-muted-foreground" />
          <span className="text-xs font-medium">{t('logger.title')}</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={handleCopyAll}
            className="inline-flex h-6 items-center gap-1 rounded-md border border-border/60 px-1.5 text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            title="Copy all"
          >
            <Copy className="h-3 w-3" />
          </button>
          <button
            type="button"
            onClick={() => {
              dispatch(clearLogs());
              setExpandedIds([]);
            }}
            className="inline-flex h-6 items-center gap-1 rounded-md border border-border/60 px-1.5 text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <Trash2 className="h-3 w-3" />
            {t('logger.clear')}
          </button>
          <button
            type="button"
            aria-label={t('commander.close')}
            onClick={() => dispatch(setRightPanel(null))}
            className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-border/60 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <div className="border-b border-border/60 px-2.5 py-1.5">
        <div className="flex flex-wrap gap-1">
          {TOGGLE_LEVELS.map((item) => {
            const active = enabledLevels.has(item.value);
            return (
              <button
                key={item.value}
                type="button"
                onClick={() => toggleLevel(item.value)}
                className={cn(
                  'rounded-md border px-2 py-0.5 text-[10px] font-medium transition-colors',
                  active
                    ? item.activeClass
                    : 'border-border/60 text-muted-foreground/40 hover:text-muted-foreground',
                )}
              >
                {t(item.label)}
              </button>
            );
          })}
        </div>
      </div>

      <div ref={listRef} className="flex-1 overflow-y-auto px-2.5 py-2 space-y-1.5">
        {filteredEntries.map((entry) => {
          const expandable = Boolean(entry.detail);
          const expanded = expandedIds.includes(entry.id);
          return (
            <div
              key={entry.id}
              className={cn(
                'w-full rounded-md border border-border/60 bg-muted/40 p-2 text-left',
                expandable && 'transition-colors hover:bg-muted/60',
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <div
                  data-testid={`logger-entry-meta-${entry.id}`}
                  className="flex min-w-0 flex-wrap items-center gap-1.5 text-[11px]"
                >
                  <span className="shrink-0 font-mono text-muted-foreground">
                    [{formatTimestamp(entry.timestamp)}]
                  </span>
                  <span
                    className={cn(
                      'shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase',
                      LEVEL_STYLES[entry.level],
                    )}
                  >
                    {entry.level}
                  </span>
                  <span className="shrink-0 text-muted-foreground">{entry.category}</span>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    onClick={(e) => handleCopyEntry(entry, e)}
                    className="shrink-0 rounded-md p-0.5 text-muted-foreground hover:text-foreground"
                    title="Copy"
                  >
                    {copiedId === entry.id ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
                  </button>
                  {expandable ? (
                    <button
                      type="button"
                      aria-expanded={expanded}
                      onClick={() =>
                        setExpandedIds((current) =>
                          current.includes(entry.id)
                            ? current.filter((id) => id !== entry.id)
                            : [...current, entry.id],
                        )
                      }
                      className="shrink-0 rounded-md p-0.5 text-muted-foreground hover:text-foreground"
                      title={expanded ? t('logger.hideDetails') : t('logger.showDetails')}
                    >
                      {expanded ? (
                        <ChevronDown className="h-3 w-3" />
                      ) : (
                        <ChevronRight className="h-3 w-3" />
                      )}
                    </button>
                  ) : null}
                </div>
              </div>
              <div data-testid={`logger-entry-body-${entry.id}`} className="mt-1.5 min-w-0">
                <p className="whitespace-pre-wrap break-words text-xs leading-4 text-foreground">
                  {entry.message}
                </p>
              </div>
              {expandable && expanded ? (
                <pre className={cn(
                  'mt-1.5 overflow-x-auto rounded-md border border-border/60 bg-background/70 px-2.5 py-1.5 font-mono text-[11px] text-muted-foreground whitespace-pre-wrap',
                  entry.level === 'error' && 'text-red-300/80',
                )}>
                  {entry.detail}
                </pre>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
