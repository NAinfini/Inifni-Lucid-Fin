import { type ReactNode } from 'react';
import { Search, Plus, Save, Trash2 } from 'lucide-react';

export interface EntityManagerShellProps {
  icon: ReactNode;
  title: string;
  search: string;
  onSearchChange: (value: string) => void;
  searchPlaceholder?: string;
  /** Extra controls in the header area (e.g. type filter dropdown) */
  headerExtras?: ReactNode;

  onCreate: () => void;
  createLabel: string;
  onSave?: () => void;
  canSave?: boolean;
  saveLabel?: string;
  onDelete?: () => void;
  deleteLabel?: string;
  hasSelection: boolean;

  /** List items to render in the left sidebar */
  listContent: ReactNode;

  /** Detail form content for the right panel */
  detailContent: ReactNode;
  /** Shown when nothing is selected */
  emptyDetailMessage?: string;
  /** Error message displayed above the detail content */
  error?: string | null;

  /** Confirm discard dialog */
  confirmOpen: boolean;
  onConfirmDiscard: () => void;
  onConfirmCancel: () => void;
  confirmTitle?: string;
  confirmMessage?: string;
}

export function EntityManagerShell({
  icon,
  title,
  search,
  onSearchChange,
  searchPlaceholder,
  headerExtras,
  onCreate,
  createLabel,
  onSave,
  canSave,
  saveLabel,
  onDelete,
  deleteLabel,
  hasSelection,
  listContent,
  detailContent,
  emptyDetailMessage,
  error,
  confirmOpen,
  onConfirmDiscard,
  onConfirmCancel,
  confirmTitle = 'Unsaved Changes',
  confirmMessage = 'You have unsaved changes. Discard them?',
}: EntityManagerShellProps) {
  return (
    <div className="h-full border-r border-border/60 bg-card flex flex-col">
      {/* Header: title + search + extras */}
      <div className="px-3 py-2 border-b border-border/60 space-y-1.5">
        <div className="flex items-center justify-between">
          <div className="text-xs font-semibold flex items-center gap-1">
            {icon}
            {title}
          </div>
        </div>
        <div className="relative">
          <Search className="w-3.5 h-3.5 absolute left-2 top-2 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder={searchPlaceholder}
            className="w-full rounded bg-muted pl-7 pr-2 py-1.5 text-xs outline-none focus:ring-1 focus:ring-ring"
          />
        </div>
        {headerExtras}
      </div>

      {/* Two-column layout */}
      <div className="grid grid-cols-[40%_60%] h-full min-h-0">
        {/* Left: action bar + list */}
        <div className="border-r min-h-0 overflow-auto">
          <div className="p-1.5 border-b border-border/60 flex items-center gap-1">
            <button
              onClick={onCreate}
              className="flex-1 text-[11px] rounded-md border border-border/60 px-2 py-1 hover:bg-muted/80 flex items-center justify-center gap-1 transition-colors"
            >
              <Plus className="w-3 h-3" aria-hidden="true" />
              {createLabel}
            </button>
            {hasSelection && (
              <>
                {onSave && (
                  <button
                    onClick={onSave}
                    disabled={!canSave}
                    className="inline-flex items-center gap-0.5 rounded-md border border-border/60 px-1.5 py-1 text-[11px] hover:bg-muted/80 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    title={saveLabel}
                  >
                    <Save className="w-3 h-3" aria-hidden="true" />
                  </button>
                )}
                {onDelete && (
                  <button
                    onClick={onDelete}
                    className="inline-flex items-center gap-0.5 rounded-md border border-border/60 px-1.5 py-1 text-[11px] hover:bg-destructive/20 transition-colors"
                    title={deleteLabel}
                  >
                    <Trash2 className="w-3 h-3" aria-hidden="true" />
                  </button>
                )}
              </>
            )}
          </div>
          {listContent}
        </div>

        {/* Right: detail */}
        <div className="min-h-0 overflow-auto p-3 space-y-2">
          {error && (
            <div className="text-xs text-destructive bg-destructive/10 rounded p-2">{error}</div>
          )}
          {hasSelection ? detailContent : (
            <div className="flex items-center justify-center h-full text-xs text-muted-foreground">
              {emptyDetailMessage ?? 'Select an item to edit'}
            </div>
          )}
        </div>
      </div>

      {/* Confirm discard dialog */}
      {confirmOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-card rounded-lg border border-border shadow-xl p-4 max-w-sm mx-4">
            <h3 className="text-sm font-semibold mb-2">{confirmTitle}</h3>
            <p className="text-xs text-muted-foreground mb-4">{confirmMessage}</p>
            <div className="flex justify-end gap-2">
              <button
                onClick={onConfirmCancel}
                className="px-3 py-1.5 text-xs rounded border border-border hover:bg-muted transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={onConfirmDiscard}
                className="px-3 py-1.5 text-xs rounded bg-destructive text-destructive-foreground hover:bg-destructive/90 transition-colors"
              >
                Discard
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
