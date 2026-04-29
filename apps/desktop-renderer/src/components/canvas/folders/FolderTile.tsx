import React, { useState } from 'react';
import { ArrowLeft, Folder as FolderIcon } from 'lucide-react';
import { cn } from '../../../lib/utils.js';
import { t } from '../../../i18n.js';
import { TileContextMenu } from './TileContextMenu.js';

export interface FolderTileProps {
  label: string;
  /** Explorer-assigned id so marquee / DnD can identify this tile. Omitted for "up" variant. */
  folderId?: string;
  /** "up" tile renders an up-arrow and skips rename/delete. */
  variant?: 'folder' | 'up';
  /** Selected state (rendered with the same highlight as item tiles). */
  selected?: boolean;
  /** Fires on primary-button click BEFORE navigation. Explorer uses this to
   * manage selection; returning stopPropagation/preventDefault from within
   * the handler cancels navigation (e.g. Ctrl-click). */
  onClickTile?: (e: React.MouseEvent) => void;
  onOpen: () => void;
  onRename?: (name: string) => Promise<unknown> | unknown;
  onDelete?: () => Promise<unknown> | unknown;
  /** Called when an entity is dropped onto the tile. Receives the ids parsed
   *  from dndMime — single id or comma-separated list. */
  onDropItems?: (ids: string[]) => void;
  dndMime: string;
  /** If true, tile mounts in rename-edit mode (e.g. newly created folder). */
  autoRename?: boolean;
}

/**
 * Folder tile for EntityFileExplorer — mimics Windows Explorer icon view.
 * Drag-target for moving entities into the folder. Right-click opens a
 * context menu (rename / delete). Double-click or Enter navigates. F2 renames.
 *
 * Click behavior (Windows Explorer parity):
 * - Click the icon / tile background → navigate into folder
 * - Click the name label → enter rename mode (does NOT navigate)
 * - Double-click anywhere → navigate
 */
export function FolderTile({
  label,
  folderId,
  variant = 'folder',
  selected = false,
  onClickTile,
  onOpen,
  onRename,
  onDelete,
  onDropItems,
  dndMime,
  autoRename = false,
}: FolderTileProps) {
  const [isDragOver, setIsDragOver] = useState(false);
  const [renaming, setRenaming] = useState(autoRename);
  const [draft, setDraft] = useState(label);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);

  const isUp = variant === 'up';

  const commitRename = async () => {
    const name = draft.trim();
    setRenaming(false);
    if (name && name !== label && onRename) await onRename(name);
    else setDraft(label);
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    if (isUp || (!onRename && !onDelete)) return;
    e.preventDefault();
    e.stopPropagation();
    setMenu({ x: e.clientX, y: e.clientY });
  };

  return (
    <div
      role="button"
      tabIndex={0}
      data-folder-id={folderId}
      onDoubleClick={onOpen}
      onClick={(e) => {
        if (renaming) return;
        onClickTile?.(e);
        if (e.defaultPrevented) return;
        onOpen();
      }}
      onContextMenu={handleContextMenu}
      onKeyDown={(e) => {
        if (renaming) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen();
        } else if (e.key === 'F2' && onRename) {
          e.preventDefault();
          setRenaming(true);
          setDraft(label);
        }
      }}
      onDragOver={(e) => {
        if (!onDropItems) return;
        if (e.dataTransfer.types.includes(dndMime)) {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
          setIsDragOver(true);
        }
      }}
      onDragLeave={() => setIsDragOver(false)}
      onDrop={(e) => {
        setIsDragOver(false);
        if (!onDropItems) return;
        const raw = e.dataTransfer.getData(dndMime);
        if (!raw) return;
        e.preventDefault();
        const ids = raw
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);
        if (ids.length > 0) onDropItems(ids);
      }}
      className={cn(
        'group relative flex flex-col rounded-md border bg-background p-1.5 text-left transition-colors focus:outline-none cursor-pointer',
        isDragOver
          ? 'border-primary bg-primary/10 ring-1 ring-primary'
          : selected
            ? 'border-primary bg-primary/15 ring-1 ring-primary/40'
            : 'border-border/60 hover:border-primary/40 hover:bg-muted/60',
      )}
    >
      <div className="aspect-square w-full rounded bg-muted/40 flex items-center justify-center text-primary/70">
        {isUp ? <ArrowLeft className="h-8 w-8" /> : <FolderIcon className="h-10 w-10" />}
      </div>
      <div className="mt-1 min-w-0">
        {renaming && onRename ? (
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => void commitRename()}
            onKeyDown={async (e) => {
              e.stopPropagation();
              if (e.key === 'Enter') {
                await commitRename();
              } else if (e.key === 'Escape') {
                setRenaming(false);
                setDraft(label);
              }
            }}
            onClick={(e) => e.stopPropagation()}
            onDoubleClick={(e) => e.stopPropagation()}
            className="w-full rounded bg-background px-1 py-0.5 text-[11px] border border-primary outline-none focus:ring-1 focus:ring-primary"
          />
        ) : (
          <span
            className="block truncate text-[11px] font-medium cursor-text"
            onClick={(e) => {
              // Windows Explorer parity: clicking the name label enters rename
              // mode rather than navigating. Navigation happens from the icon
              // area or via double-click anywhere on the tile.
              if (isUp || !onRename) return;
              e.stopPropagation();
              setRenaming(true);
              setDraft(label);
            }}
          >
            {label}
          </span>
        )}
      </div>
      {menu && (
        <TileContextMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          items={[
            ...(onRename
              ? [
                  {
                    label: t('action.rename') as string,
                    onSelect: () => {
                      setRenaming(true);
                      setDraft(label);
                    },
                  },
                ]
              : []),
            ...(onDelete
              ? [
                  {
                    label: t('action.delete') as string,
                    onSelect: () => {
                      void onDelete();
                    },
                    destructive: true,
                  },
                ]
              : []),
          ]}
        />
      )}
    </div>
  );
}
