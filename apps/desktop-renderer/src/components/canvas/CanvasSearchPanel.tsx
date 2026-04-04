import { ChevronDown, ChevronUp, Search, X } from 'lucide-react';
import { useCallback, useState, useEffect } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import type { CanvasNodeType, NodeStatus } from '@lucid-fin/contracts';
import { t } from '../../i18n.js';
import type { RootState } from '../../store/index.js';
import {
  clearCanvasSearch,
  setCanvasSearchQuery,
  setSearchPanelOpen,
  toggleCanvasStatusFilter,
  toggleCanvasTypeFilter,
} from '../../store/slices/ui.js';
import { cn } from '../../lib/utils.js';

const NODE_FILTERS: CanvasNodeType[] = ['text', 'image', 'video', 'audio', 'backdrop'];
const STATUS_FILTERS: NodeStatus[] = ['idle', 'generating', 'done', 'failed'];

interface CanvasSearchPanelProps {
  matchCount: number;
  totalCount: number;
  matchedNodeIds: string[];
  onNavigateToNode?: (nodeId: string) => void;
}

export function CanvasSearchPanel({
  matchCount,
  totalCount,
  matchedNodeIds,
  onNavigateToNode,
}: CanvasSearchPanelProps) {
  const dispatch = useDispatch();
  const { canvasSearchQuery, canvasStatusFilters, canvasTypeFilters } = useSelector(
    (state: RootState) => state.ui,
  );
  const [currentIndex, setCurrentIndex] = useState(-1);

  // Reset index when matches change
  useEffect(() => {
    setCurrentIndex(-1);
  }, [matchedNodeIds]);

  const navigateTo = useCallback(
    (index: number) => {
      if (matchedNodeIds.length === 0) return;
      const wrappedIndex = ((index % matchedNodeIds.length) + matchedNodeIds.length) % matchedNodeIds.length;
      setCurrentIndex(wrappedIndex);
      const nodeId = matchedNodeIds[wrappedIndex];
      if (nodeId) onNavigateToNode?.(nodeId);
    },
    [matchedNodeIds, onNavigateToNode],
  );

  return (
    <div className="absolute left-4 top-4 z-30 w-80 rounded-2xl border border-border/80 bg-card/95 p-4 shadow-2xl backdrop-blur">
      <div className="flex items-center gap-2">
        <div className="flex h-9 flex-1 items-center gap-2 rounded-xl border border-border bg-background px-3">
          <Search className="h-4 w-4 text-muted-foreground" />
          <input
            autoFocus
            value={canvasSearchQuery}
            onChange={(event) => dispatch(setCanvasSearchQuery(event.target.value))}
            placeholder={t('canvas.searchPlaceholder')}
            className="h-full w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                navigateTo(e.shiftKey ? currentIndex - 1 : currentIndex + 1);
              }
            }}
          />
        </div>
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            onClick={() => navigateTo(currentIndex - 1)}
            disabled={matchedNodeIds.length === 0}
            aria-label={t('search.previousMatch')}
            className="inline-flex h-9 w-7 items-center justify-center rounded-l-xl border border-border bg-background text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40"
          >
            <ChevronUp className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => navigateTo(currentIndex + 1)}
            disabled={matchedNodeIds.length === 0}
            aria-label={t('search.nextMatch')}
            className="inline-flex h-9 w-7 items-center justify-center rounded-r-xl border border-l-0 border-border bg-background text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40"
          >
            <ChevronDown className="h-4 w-4" />
          </button>
        </div>
        <button
          type="button"
          onClick={() => dispatch(setSearchPanelOpen(false))}
          aria-label={t('canvas.closeSearch')}
          className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-border bg-background text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="mt-3 flex items-center justify-between text-[11px] text-muted-foreground">
        <span>{t('canvas.searchResults')}</span>
        <span>
          {matchedNodeIds.length > 0 && currentIndex >= 0
            ? `${currentIndex + 1}/`
            : ''}
          {matchCount}/{totalCount}
        </span>
      </div>

      <div className="mt-4 space-y-3">
        <div>
          <div className="mb-2 text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
            {t('canvas.filterByType')}
          </div>
          <div className="flex flex-wrap gap-2">
            {NODE_FILTERS.map((filter) => {
              const active = canvasTypeFilters.includes(filter);
              return (
                <button
                  key={filter}
                  type="button"
                  onClick={() => dispatch(toggleCanvasTypeFilter(filter))}
                  className={cn(
                    'rounded-full border px-3 py-1.5 text-xs transition-colors',
                    active
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-border text-muted-foreground hover:border-primary/40 hover:text-foreground',
                  )}
                >
                  {t(`canvas.nodeType.${filter}`)}
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <div className="mb-2 text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
            {t('canvas.filterByStatus')}
          </div>
          <div className="flex flex-wrap gap-2">
            {STATUS_FILTERS.map((filter) => {
              const active = canvasStatusFilters.includes(filter);
              return (
                <button
                  key={filter}
                  type="button"
                  onClick={() => dispatch(toggleCanvasStatusFilter(filter))}
                  className={cn(
                    'rounded-full border px-3 py-1.5 text-xs transition-colors',
                    active
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-border text-muted-foreground hover:border-primary/40 hover:text-foreground',
                  )}
                >
                  {t(`canvas.status.${filter}`)}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div className="mt-4 flex justify-end">
        <button
          type="button"
          onClick={() => dispatch(clearCanvasSearch())}
          className="rounded-full border border-border px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
        >
          {t('canvas.clearFilters')}
        </button>
      </div>
    </div>
  );
}
