import type { Folder } from '@lucid-fin/contracts';
import { ChevronRight, Home } from 'lucide-react';
import { cn } from '../../../lib/utils.js';

export interface FolderBreadcrumbProps {
  breadcrumb: Folder[];
  onNavigate: (id: string | null) => void;
  rootLabel?: string;
}

export function FolderBreadcrumb({
  breadcrumb,
  onNavigate,
  rootLabel = 'All',
}: FolderBreadcrumbProps) {
  return (
    <nav className="flex items-center gap-0.5 text-[10px] text-muted-foreground min-w-0">
      <button
        type="button"
        onClick={() => onNavigate(null)}
        className={cn(
          'inline-flex items-center gap-1 px-1 py-0.5 rounded hover:bg-muted/70',
          breadcrumb.length === 0 && 'text-foreground font-medium',
        )}
      >
        <Home className="w-2.5 h-2.5" />
        {rootLabel}
      </button>
      {breadcrumb.map((f, i) => {
        const isLast = i === breadcrumb.length - 1;
        return (
          <span key={f.id} className="flex items-center gap-0.5 min-w-0">
            <ChevronRight className="w-2.5 h-2.5 shrink-0" />
            <button
              type="button"
              onClick={() => onNavigate(f.id)}
              className={cn(
                'truncate max-w-[140px] px-1 py-0.5 rounded hover:bg-muted/70',
                isLast && 'text-foreground font-medium',
              )}
              title={f.name}
            >
              {f.name}
            </button>
          </span>
        );
      })}
    </nav>
  );
}
