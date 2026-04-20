import React from 'react';
import {
  ArrowUpDown,
  CheckSquare,
  LayoutGrid,
  List,
  RefreshCw,
  Search,
  Sparkles,
  Upload,
} from 'lucide-react';
import type { Asset } from '../../../store/slices/assets.js';
import { t } from '../../../i18n.js';
import { cn } from '../../../lib/utils.js';

const FILTERS: Array<{ value: Asset['type'] | 'all'; label: string }> = [
  { value: 'all', label: 'asset.all' },
  { value: 'image', label: 'asset.image' },
  { value: 'video', label: 'asset.video' },
  { value: 'audio', label: 'asset.audio' },
];

export interface AssetToolbarProps {
  /** Current filter type from Redux */
  filterType: Asset['type'] | 'all';
  onFilterChange: (filter: Asset['type'] | 'all') => void;
  /** Local (debounced) search value */
  localSearch: string;
  onSearchChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  /** Sort field */
  sortBy: 'date' | 'name' | 'size';
  onSortCycle: () => void;
  /** Sort direction */
  sortOrder: 'asc' | 'desc';
  onSortOrderToggle: () => void;
  /** View mode */
  viewMode: 'grid' | 'list';
  onViewModeChange: (mode: 'grid' | 'list') => void;
  /** Import handler */
  onImport: () => void;
  /** Select mode toggle */
  selectMode: boolean;
  onSelectModeToggle: () => void;
  /** Semantic search */
  semanticMode: boolean;
  onSemanticToggle: () => void;
  /** Re-index */
  onReindex: () => void;
  semanticIndexing: boolean;
}

export function AssetToolbar({
  filterType,
  onFilterChange,
  localSearch,
  onSearchChange,
  sortBy,
  onSortCycle,
  sortOrder,
  onSortOrderToggle,
  viewMode,
  onViewModeChange,
  onImport,
  selectMode,
  onSelectModeToggle,
  semanticMode,
  onSemanticToggle,
  onReindex,
  semanticIndexing,
}: AssetToolbarProps) {
  return (
    <div className="border-b border-border/60 px-3 py-2 space-y-2">
      {/* Row 1: search + semantic toggle + reindex + view toggle */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          {semanticMode ? (
            <Sparkles className="absolute left-2 top-2 h-3.5 w-3.5 text-primary" />
          ) : (
            <Search className="absolute left-2 top-2 h-3.5 w-3.5 text-muted-foreground" />
          )}
          <input
            value={localSearch}
            onChange={onSearchChange}
            placeholder={semanticMode ? t('assetBrowser.semantic.toggle') + '...' : t('assetBrowser.searchPlaceholder')}
            className={cn(
              'w-full rounded-md border bg-background py-1.5 pl-7 pr-2 text-xs outline-none focus:ring-1 focus:ring-ring',
              semanticMode ? 'border-primary/60' : 'border-border/60',
            )}
          />
        </div>
        {/* Semantic search toggle */}
        <button
          type="button"
          onClick={onSemanticToggle}
          title={t('assetBrowser.semantic.toggle')}
          className={cn(
            'flex items-center justify-center rounded-md border px-2 py-1.5 transition-colors',
            semanticMode
              ? 'border-primary bg-primary/10 text-primary'
              : 'border-border/60 text-muted-foreground hover:bg-muted/80 hover:text-foreground',
          )}
        >
          <Sparkles className="h-3.5 w-3.5" />
        </button>
        {/* Re-index button */}
        <button
          type="button"
          onClick={onReindex}
          disabled={semanticIndexing}
          title={t('assetBrowser.semantic.reindex')}
          className="flex items-center justify-center rounded-md border border-border/60 px-2 py-1.5 text-muted-foreground transition-colors hover:bg-muted/80 hover:text-foreground disabled:opacity-50"
        >
          <RefreshCw className={cn('h-3.5 w-3.5', semanticIndexing && 'animate-spin')} />
        </button>
        {/* View toggle */}
        <div className="flex items-center rounded-md border border-border/60 overflow-hidden">
          <button
            type="button"
            onClick={() => onViewModeChange('grid')}
            title={t('assetBrowser.viewGrid')}
            className={cn(
              'flex items-center justify-center px-2 py-1.5 text-[11px] transition-colors',
              viewMode === 'grid'
                ? 'bg-primary/10 text-primary'
                : 'text-muted-foreground hover:bg-muted/80 hover:text-foreground',
            )}
          >
            <LayoutGrid className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => onViewModeChange('list')}
            title={t('assetBrowser.viewList')}
            className={cn(
              'flex items-center justify-center px-2 py-1.5 text-[11px] transition-colors border-l border-border/60',
              viewMode === 'list'
                ? 'bg-primary/10 text-primary'
                : 'text-muted-foreground hover:bg-muted/80 hover:text-foreground',
            )}
          >
            <List className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Row 2: type filter pills */}
      <div className="flex flex-wrap gap-1.5">
        {FILTERS.map((filter) => (
          <button
            key={filter.value}
            type="button"
            onClick={() => onFilterChange(filter.value)}
            className={cn(
              'rounded-full border px-2 py-0.5 text-[11px] transition-colors',
              filterType === filter.value
                ? 'border-primary bg-primary/10 text-primary'
                : 'border-border/60 text-muted-foreground hover:bg-muted/80 hover:text-foreground',
            )}
          >
            {t(filter.label)}
          </button>
        ))}
      </div>

      {/* Row 3: import + select mode + sort */}
      <div className="flex flex-wrap gap-1.5">
        <button
          type="button"
          onClick={onImport}
          className="inline-flex items-center gap-1 rounded-full border border-border/60 px-2 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-muted/80 hover:text-foreground"
        >
          <Upload className="h-3 w-3" />
          {t('assetBrowser.import')}
        </button>
        <button
          type="button"
          onClick={onSelectModeToggle}
          className={cn(
            'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] transition-colors',
            selectMode ? 'border-primary bg-primary/10 text-primary' : 'border-border/60 text-muted-foreground hover:bg-muted/80 hover:text-foreground',
          )}
        >
          <CheckSquare className="h-3 w-3" />
          {selectMode ? t('assetBrowser.cancelSelect') : t('assetBrowser.export')}
        </button>
        <button
          type="button"
          onClick={onSortCycle}
          className="inline-flex items-center gap-1 rounded-full border border-border/60 px-2 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-muted/80 hover:text-foreground"
        >
          <ArrowUpDown className="h-3 w-3" />
          {sortBy === 'date'
            ? t('assetBrowser.sortBy.date')
            : sortBy === 'name'
              ? t('assetBrowser.sortBy.name')
              : t('assetBrowser.sortBy.size')}
        </button>
        <button
          type="button"
          onClick={onSortOrderToggle}
          className="inline-flex items-center gap-1 rounded-full border border-border/60 px-1.5 py-0.5 text-[10px] text-muted-foreground transition-colors hover:bg-muted/80 hover:text-foreground"
        >
          {sortOrder === 'asc' ? '↑' : '↓'}
        </button>
      </div>
    </div>
  );
}
