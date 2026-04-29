import React from 'react';
import { Copy, Download, Pencil, Trash2 } from 'lucide-react';
import { t } from '../../../i18n.js';

export interface AssetContextMenuProps {
  x: number;
  y: number;
  selectedCount: number;
  onCopyHash: () => void;
  onExport: () => void;
  onBatchRename: () => void;
  onDelete: () => void;
}

export function AssetContextMenu({
  x,
  y,
  selectedCount,
  onCopyHash,
  onExport,
  onBatchRename,
  onDelete,
}: AssetContextMenuProps) {
  return (
    <div
      className="fixed z-50 min-w-[160px] rounded-md border border-border/60 bg-popover py-1 shadow-lg"
      style={{ left: x, top: y }}
      onClick={(e) => e.stopPropagation()}
    >
      {selectedCount === 1 && (
        <button
          type="button"
          onClick={onCopyHash}
          className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-foreground hover:bg-muted"
        >
          <Copy className="h-3.5 w-3.5" />
          {t('assetBrowser.copyHash')}
        </button>
      )}
      <button
        type="button"
        onClick={onExport}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-foreground hover:bg-muted"
      >
        <Download className="h-3.5 w-3.5" />
        {t('assetBrowser.exportSelected')} ({selectedCount})
      </button>
      <button
        type="button"
        onClick={onBatchRename}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-foreground hover:bg-muted"
      >
        <Pencil className="h-3.5 w-3.5" />
        {t('assetBrowser.batchRename')} ({selectedCount})
      </button>
      <button
        type="button"
        onClick={onDelete}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-destructive hover:bg-muted"
      >
        <Trash2 className="h-3.5 w-3.5" />
        {t('action.delete')} ({selectedCount})
      </button>
    </div>
  );
}
