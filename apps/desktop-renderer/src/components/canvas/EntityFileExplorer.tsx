import React, { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  ArrowUpDown,
  ClipboardPaste,
  Copy,
  FolderPlus,
  Plus,
  Scissors,
  Search,
  Trash2,
} from 'lucide-react';
import type { Folder } from '@lucid-fin/contracts';
import { cn } from '../../lib/utils.js';
import { t } from '../../i18n.js';
import { SkeletonList } from '../ui/Skeleton.js';
import { FolderBreadcrumb } from './folders/FolderBreadcrumb.js';
import { FolderTile } from './folders/FolderTile.js';
import { TileContextMenu } from './folders/TileContextMenu.js';

export interface EntityFileExplorerItem {
  id: string;
  name: string;
  folderId?: string | null;
}

export type SortField = 'name' | 'date';
export type SortOrder = 'asc' | 'desc';

export interface EntityFileExplorerProps<T extends EntityFileExplorerItem> {
  /** Full entity collection (the explorer filters by folder + search itself). */
  items: T[];
  /** Folder list (not filtered — the explorer finds children of currentFolderId). */
  folders: Folder[];
  currentFolderId: string | null;
  /** Called when the user clicks a folder tile, up-folder tile, or breadcrumb. */
  onNavigateFolder: (folderId: string | null) => void;
  /** Called when the user creates a new folder in the current folder. */
  onCreateFolder: (parentId: string | null, name: string) => Promise<unknown>;
  onRenameFolder: (id: string, name: string) => Promise<unknown>;
  onDeleteFolder: (id: string) => Promise<unknown>;
  /** Fires when an item is dropped onto a folder tile. */
  onMoveItemsToFolder: (ids: string[], folderId: string | null) => void;
  /** Fires when the user clicks the "New item" toolbar button. */
  onCreateItem: () => void;
  /** Fires when user presses Enter on a tile or double-clicks it. */
  onOpenItem: (item: T) => void;
  /** Fires when user invokes delete (Del key or context menu / toolbar). */
  onDeleteItems: (ids: string[]) => void;
  /** Optional duplicate handler — drives the "copy" clipboard + Ctrl+D. */
  onDuplicateItems?: (ids: string[]) => void;
  /** Render a thumbnail for an item tile (panel-specific — each entity kind
   * looks up a different field). The returned element is placed inside an
   * aspect-square container. */
  renderThumbnail: (item: T) => ReactNode;
  /** Optional per-item subtitle (type/role/etc.). Rendered under the name. */
  renderSubtitle?: (item: T) => ReactNode;
  /** Optional badge (e.g. "used in 3 nodes"). Rendered on the tile. */
  renderBadge?: (item: T) => ReactNode;
  /** Clipboard integration. If omitted, Ctrl+C/X/V are disabled. */
  clipboard?: {
    hasClipboard: boolean;
    isCut: boolean;
    copy: (items: T[]) => void;
    cut: (items: T[]) => void;
    paste: () => { mode: 'copy' | 'cut'; items: T[] } | null;
    /** Cut ids (to render dimmed). Derived from clipboard state by caller. */
    cutIds?: Set<string>;
  };
  /** Called when the user pastes. Receives a snapshot of the payload. The
   * panel decides whether cut → move or copy → duplicate. */
  onPaste?: (payload: { mode: 'copy' | 'cut'; items: T[] }) => void;
  /** Panel header content (title + icon). */
  header?: ReactNode;
  /** Extra toolbar buttons rendered alongside New/Search. */
  toolbarExtras?: ReactNode;
  /** Localized label for "New item" button. */
  newItemLabel: string;
  /** Currently selected item (highlighted). Drawer state lives in caller. */
  activeItemId?: string | null;
  /** Loading state for items list. */
  loading?: boolean;
  /** When false, hide the search + sort row above the action toolbar. */
  showSearchControls?: boolean;
  /** DnD MIME key for drag-to-folder. Defaults to the entity-id key used by FolderTree. */
  dndMime?: string;
  /** Empty-state label when no items in the current folder. */
  emptyLabel: string;
  /** When true, grid collapses to a single column (narrow "preview pane"
   *  layout used when the detail drawer is open beside the explorer). */
  compact?: boolean;
}

const DEFAULT_DND_MIME = 'application/lucid-entity-id';
const DEFAULT_SORT_FIELD: SortField = 'name';
const DEFAULT_SORT_ORDER: SortOrder = 'asc';

/**
 * Shared Windows-Explorer-style grid for entity panels. Folders and items
 * render as tiles in one flow; navigation is click-a-folder-to-enter,
 * breadcrumb-to-jump-back. The caller owns data + folder state — this
 * component only owns selection + rubber-band + sort + search UI.
 */
export function EntityFileExplorer<
  T extends EntityFileExplorerItem & { createdAt?: number; updatedAt?: number },
>(props: EntityFileExplorerProps<T>) {
  const {
    items,
    folders,
    currentFolderId,
    onNavigateFolder,
    onCreateFolder,
    onRenameFolder,
    onDeleteFolder,
    onMoveItemsToFolder,
    onCreateItem,
    onOpenItem,
    onDeleteItems,
    onDuplicateItems,
    renderThumbnail,
    renderSubtitle,
    renderBadge,
    clipboard,
    onPaste,
    header,
    toolbarExtras,
    newItemLabel,
    activeItemId,
    loading,
    showSearchControls = true,
    dndMime = DEFAULT_DND_MIME,
    emptyLabel,
    compact = false,
  } = props;

  const [search, setSearch] = useState('');
  const [sortField, setSortField] = useState<SortField>(DEFAULT_SORT_FIELD);
  const [sortOrder, setSortOrder] = useState<SortOrder>(DEFAULT_SORT_ORDER);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [selectedFolderIds, setSelectedFolderIds] = useState<Set<string>>(new Set());
  const [lastClickedId, setLastClickedId] = useState<string | null>(null);
  const [autoRenameFolderId, setAutoRenameFolderId] = useState<string | null>(null);
  const [itemMenu, setItemMenu] = useState<{ x: number; y: number; item: T } | null>(null);
  const [bgMenu, setBgMenu] = useState<{ x: number; y: number } | null>(null);
  const [marquee, setMarquee] = useState<{ x: number; y: number; w: number; h: number } | null>(
    null,
  );
  const panelRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const tilesRef = useRef<HTMLDivElement>(null);
  const tileBoundsRef = useRef<Array<{ id: string; rect: DOMRect; isFolder: boolean }>>([]);
  // Suppresses the trailing background-click (fires after mouseup) when the
  // user actually completed a marquee drag, so we don't immediately wipe the
  // selection the rubber-band just produced.
  const marqueeCommittedRef = useRef(false);

  // --- Breadcrumb ---
  const breadcrumb = useMemo(() => {
    if (!currentFolderId) return [] as Folder[];
    const byId = new Map(folders.map((f) => [f.id, f] as const));
    const chain: Folder[] = [];
    let cursor: string | null = currentFolderId;
    let guard = 0;
    while (cursor && guard < 64) {
      const node = byId.get(cursor);
      if (!node) break;
      chain.unshift(node);
      cursor = node.parentId;
      guard += 1;
    }
    return chain;
  }, [folders, currentFolderId]);

  const parentFolderId = useMemo(() => {
    if (!currentFolderId) return null;
    const byId = new Map(folders.map((f) => [f.id, f] as const));
    return byId.get(currentFolderId)?.parentId ?? null;
  }, [folders, currentFolderId]);

  // --- Folder children + item children of current folder ---
  const childFolders = useMemo(() => {
    return folders
      .filter((f) => f.parentId === currentFolderId)
      .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
  }, [folders, currentFolderId]);

  const visibleItems = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    let filtered = items.filter((it) => (it.folderId ?? null) === currentFolderId);
    if (keyword) {
      filtered = filtered.filter((it) => it.name.toLowerCase().includes(keyword));
    }
    return [...filtered].sort((a, b) => {
      let cmp: number;
      if (sortField === 'name') cmp = a.name.localeCompare(b.name);
      else {
        const at = a.createdAt ?? 0;
        const bt = b.createdAt ?? 0;
        cmp = at - bt;
      }
      return sortOrder === 'asc' ? cmp : -cmp;
    });
  }, [items, search, sortField, sortOrder, currentFolderId]);

  // --- Selection helpers ---
  const getSelectedItems = useCallback((): T[] => {
    const byId = new Map(items.map((it) => [it.id, it] as const));
    const out: T[] = [];
    for (const id of selectedIds) {
      const it = byId.get(id);
      if (it) out.push(it);
    }
    return out;
  }, [items, selectedIds]);

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
    setSelectedFolderIds(new Set());
    setLastClickedId(null);
  }, []);

  const selectAllVisible = useCallback(() => {
    setSelectedIds(new Set(visibleItems.map((it) => it.id)));
    setSelectedFolderIds(new Set(childFolders.map((f) => f.id)));
  }, [visibleItems, childFolders]);

  const handleTileClick = useCallback(
    (item: T, e: React.MouseEvent) => {
      if (e.shiftKey && lastClickedId) {
        const start = visibleItems.findIndex((it) => it.id === lastClickedId);
        const end = visibleItems.findIndex((it) => it.id === item.id);
        if (start !== -1 && end !== -1) {
          const [lo, hi] = start < end ? [start, end] : [end, start];
          const range = visibleItems.slice(lo, hi + 1).map((it) => it.id);
          setSelectedIds((prev) => {
            const next = new Set(prev);
            for (const id of range) next.add(id);
            return next;
          });
        }
      } else if (e.ctrlKey || e.metaKey) {
        setSelectedIds((prev) => {
          const next = new Set(prev);
          if (next.has(item.id)) next.delete(item.id);
          else next.add(item.id);
          return next;
        });
      } else {
        setSelectedIds(new Set([item.id]));
        setSelectedFolderIds(new Set());
      }
      setLastClickedId(item.id);
    },
    [visibleItems, lastClickedId],
  );

  // Folder-tile click selection: Ctrl/Cmd toggles folder into selection set,
  // plain click (non-renaming, non-up) selects only that folder. Navigation
  // still fires on a clean click — FolderTile handles that internally; we
  // just track selection for Delete / marquee purposes.
  const handleFolderTileClick = useCallback((folderId: string, e: React.MouseEvent) => {
    if (e.ctrlKey || e.metaKey) {
      setSelectedFolderIds((prev) => {
        const next = new Set(prev);
        if (next.has(folderId)) next.delete(folderId);
        else next.add(folderId);
        return next;
      });
      // Also swallow navigation when Ctrl-clicking — treat as select-only.
      e.stopPropagation();
      e.preventDefault();
    } else {
      setSelectedFolderIds(new Set([folderId]));
      setSelectedIds(new Set());
    }
  }, []);

  // --- Keyboard: Ctrl+C/X/V/A/D, Delete, Backspace ---
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!panelRef.current?.contains(document.activeElement)) return;
      const tgt = document.activeElement;
      if (
        tgt instanceof HTMLInputElement ||
        tgt instanceof HTMLTextAreaElement ||
        (tgt as HTMLElement)?.isContentEditable
      )
        return;
      const meta = e.ctrlKey || e.metaKey;
      if (meta && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        selectAllVisible();
      } else if (meta && e.key.toLowerCase() === 'c' && clipboard && selectedIds.size > 0) {
        e.preventDefault();
        clipboard.copy(getSelectedItems());
      } else if (meta && e.key.toLowerCase() === 'x' && clipboard && selectedIds.size > 0) {
        e.preventDefault();
        clipboard.cut(getSelectedItems());
      } else if (meta && e.key.toLowerCase() === 'v' && clipboard && onPaste) {
        e.preventDefault();
        const payload = clipboard.paste();
        if (payload) onPaste(payload);
      } else if (meta && e.key.toLowerCase() === 'd' && onDuplicateItems && selectedIds.size > 0) {
        e.preventDefault();
        onDuplicateItems([...selectedIds]);
      } else if (e.key === 'Delete' && (selectedIds.size > 0 || selectedFolderIds.size > 0)) {
        e.preventDefault();
        if (selectedIds.size > 0) onDeleteItems([...selectedIds]);
        for (const fid of selectedFolderIds) void onDeleteFolder(fid);
        setSelectedFolderIds(new Set());
      } else if (e.key === 'Backspace' && currentFolderId) {
        e.preventDefault();
        onNavigateFolder(parentFolderId);
      } else if (e.key === 'Escape') {
        clearSelection();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [
    clearSelection,
    clipboard,
    currentFolderId,
    getSelectedItems,
    onDeleteFolder,
    onDeleteItems,
    onDuplicateItems,
    onNavigateFolder,
    onPaste,
    parentFolderId,
    selectAllVisible,
    selectedFolderIds,
    selectedIds,
  ]);

  // --- New folder: create immediately with a default name, then auto-rename ---
  const handleCreateFolder = useCallback(async () => {
    const defaultName = t('folders.newFolder') as string;
    const created = await onCreateFolder(currentFolderId, defaultName);
    if (created && typeof created === 'object' && 'id' in created) {
      setAutoRenameFolderId((created as { id: string }).id);
    }
  }, [onCreateFolder, currentFolderId]);

  const handleSortCycle = useCallback(() => {
    setSortField((f) => (f === 'name' ? 'date' : 'name'));
  }, []);

  // --- Paste via toolbar / context (also wired into keyboard above) ---
  const doPaste = useCallback(() => {
    if (!clipboard || !onPaste) return;
    const payload = clipboard.paste();
    if (payload) onPaste(payload);
  }, [clipboard, onPaste]);

  // --- Rubber-band (marquee) selection ---
  // Start a marquee only when the user presses the primary button on empty
  // space inside the scroll container — not on a tile, folder tile, scrollbar,
  // or context menu. While dragging, recompute selection from the intersection
  // of the marquee rect and every tile's bounding box. The base set (existing
  // selection) is preserved when the user holds Ctrl/Cmd, so additive selection
  // works like Windows Explorer.
  const beginMarquee = useCallback(
    (e: React.MouseEvent) => {
      if (e.button !== 0) return;
      // Keyboard handler requires focus to be inside panelRef — claim it on any
      // mousedown inside the grid so shortcuts work without an extra click.
      panelRef.current?.focus();
      const target = e.target as HTMLElement | null;
      if (!target) return;
      // Skip when pressing on a tile / folder tile / explicit no-marquee element.
      if (target.closest('[data-tile-id],[data-folder-id],[data-no-marquee]')) return;
      const scroller = gridRef.current;
      if (!scroller) return;
      const rect = scroller.getBoundingClientRect();
      // Content-space start point (accounts for scroll offset so tile rects
      // computed against the same origin remain correct as the user scrolls).
      const startX = e.clientX - rect.left + scroller.scrollLeft;
      const startY = e.clientY - rect.top + scroller.scrollTop;
      const additive = e.ctrlKey || e.metaKey;
      const baseItems = additive ? new Set(selectedIds) : new Set<string>();
      const baseFolders = additive ? new Set(selectedFolderIds) : new Set<string>();

      // Pre-cache all tile bounding rects once at drag-start to avoid
      // querySelectorAll on every mousemove event.
      const tileRoot = tilesRef.current;
      if (tileRoot) {
        const items = Array.from(tileRoot.querySelectorAll<HTMLElement>('[data-tile-id]'));
        const folders = Array.from(tileRoot.querySelectorAll<HTMLElement>('[data-folder-id]'));
        tileBoundsRef.current = [
          ...items.map((el) => ({
            id: el.dataset.tileId!,
            rect: el.getBoundingClientRect(),
            isFolder: false,
          })),
          ...folders.map((el) => ({
            id: el.dataset.folderId!,
            rect: el.getBoundingClientRect(),
            isFolder: true,
          })),
        ];
      }

      const onMove = (ev: MouseEvent) => {
        const sc = gridRef.current;
        if (!sc) return;
        const r = sc.getBoundingClientRect();
        const curX = ev.clientX - r.left + sc.scrollLeft;
        const curY = ev.clientY - r.top + sc.scrollTop;
        const x = Math.min(startX, curX);
        const y = Math.min(startY, curY);
        const w = Math.abs(curX - startX);
        const h = Math.abs(curY - startY);
        // Only commit a marquee once the pointer has travelled a few pixels —
        // a plain click should still fall through to handleBackgroundClick.
        if (w < 3 && h < 3) return;
        marqueeCommittedRef.current = true;
        setMarquee({ x, y, w, h });

        const nextItems = new Set(baseItems);
        const nextFolders = new Set(baseFolders);
        for (const cached of tileBoundsRef.current) {
          const tr = cached.rect;
          const tx = tr.left - r.left + sc.scrollLeft;
          const ty = tr.top - r.top + sc.scrollTop;
          const overlaps = tx + tr.width >= x && tx <= x + w && ty + tr.height >= y && ty <= y + h;
          if (overlaps) {
            if (cached.isFolder) nextFolders.add(cached.id);
            else nextItems.add(cached.id);
          }
        }
        setSelectedIds(nextItems);
        setSelectedFolderIds(nextFolders);
      };

      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        setMarquee(null);
      };

      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    },
    [selectedFolderIds, selectedIds],
  );

  // --- Ensure single-click selection is cleared when clicking empty area ---
  // Placed AFTER beginMarquee so a zero-distance marquee mousedown/mouseup
  // (i.e. a plain click on background) still clears selection via the
  // existing click handler — we only add rubber-band, not replace click.
  const handleBackgroundClick = useCallback(
    (e: React.MouseEvent) => {
      if (marqueeCommittedRef.current) {
        marqueeCommittedRef.current = false;
        return;
      }
      if (e.target === e.currentTarget) clearSelection();
    },
    [clearSelection],
  );

  return (
    <div ref={panelRef} tabIndex={-1} className="flex h-full flex-col bg-card focus:outline-none">
      {header && (
        <div className={cn('border-b border-border/60', compact ? 'px-2 py-1.5' : 'px-3 py-2')}>
          {header}
        </div>
      )}

      <div
        className={cn(
          'border-b border-border/60',
          compact ? 'px-2 py-1.5 space-y-1' : 'px-3 py-2 space-y-2',
        )}
      >
        {showSearchControls && (
          <div className="flex items-center gap-1">
            <div className="relative flex-1 min-w-0">
              <Search className="absolute left-1.5 top-1.5 h-3 w-3 text-muted-foreground" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t('fileExplorer.searchPlaceholder')}
                className={cn(
                  'w-full rounded-md border border-border/60 bg-background outline-none focus:ring-1 focus:ring-ring',
                  compact ? 'py-1 pl-6 pr-1.5 text-[11px]' : 'py-1.5 pl-7 pr-2 text-xs',
                )}
              />
            </div>
            {!compact && (
              <>
                <button
                  type="button"
                  onClick={handleSortCycle}
                  title={t('fileExplorer.sortBy')}
                  className="inline-flex items-center gap-1 rounded-md border border-border/60 px-2 py-1 text-[11px] text-muted-foreground hover:bg-muted/80 hover:text-foreground"
                >
                  <ArrowUpDown className="h-3 w-3" />
                  {sortField === 'name' ? t('fileExplorer.sortName') : t('fileExplorer.sortDate')}
                </button>
                <button
                  type="button"
                  onClick={() => setSortOrder((o) => (o === 'asc' ? 'desc' : 'asc'))}
                  title={t('fileExplorer.sortOrder')}
                  className="rounded-md border border-border/60 px-1.5 py-1 text-[11px] text-muted-foreground hover:bg-muted/80 hover:text-foreground"
                >
                  {sortOrder === 'asc' ? '↑' : '↓'}
                </button>
              </>
            )}
            {compact && (
              <button
                type="button"
                onClick={handleSortCycle}
                title={`${t('fileExplorer.sortBy')} · ${sortField === 'name' ? t('fileExplorer.sortName') : t('fileExplorer.sortDate')} ${sortOrder === 'asc' ? '↑' : '↓'}`}
                className="inline-flex items-center justify-center rounded-md border border-border/60 p-1 text-muted-foreground hover:bg-muted/80 hover:text-foreground"
                aria-label={t('fileExplorer.sortBy')}
              >
                <ArrowUpDown className="h-3 w-3" />
              </button>
            )}
          </div>
        )}

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onCreateItem}
            className={cn(
              'inline-flex items-center justify-center rounded-md border border-primary/50 bg-primary/10 text-primary hover:bg-primary/20',
              compact ? 'p-1' : 'p-1.5',
            )}
            title={newItemLabel}
            aria-label={newItemLabel}
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => void handleCreateFolder()}
            className={cn(
              'inline-flex items-center justify-center rounded-md border border-border/60 text-muted-foreground hover:bg-muted/80 hover:text-foreground',
              compact ? 'p-1' : 'p-1.5',
            )}
            title={t('folders.createFolder')}
            aria-label={t('folders.createFolder')}
          >
            <FolderPlus className="h-3.5 w-3.5" />
          </button>
          {clipboard && !compact && (
            <>
              <button
                type="button"
                onClick={() => clipboard.copy(getSelectedItems())}
                disabled={selectedIds.size === 0}
                className="inline-flex items-center justify-center rounded-md border border-border/60 p-1.5 text-muted-foreground hover:bg-muted/80 hover:text-foreground disabled:opacity-40"
                title={t('contextMenu.copy')}
                aria-label={t('contextMenu.copy')}
              >
                <Copy className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => clipboard.cut(getSelectedItems())}
                disabled={selectedIds.size === 0}
                className="inline-flex items-center justify-center rounded-md border border-border/60 p-1.5 text-muted-foreground hover:bg-muted/80 hover:text-foreground disabled:opacity-40"
                title={t('contextMenu.cut')}
                aria-label={t('contextMenu.cut')}
              >
                <Scissors className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={doPaste}
                disabled={!clipboard.hasClipboard}
                className="inline-flex items-center justify-center rounded-md border border-border/60 p-1.5 text-muted-foreground hover:bg-muted/80 hover:text-foreground disabled:opacity-40"
                title={t('contextMenu.paste')}
                aria-label={t('contextMenu.paste')}
              >
                <ClipboardPaste className="h-3.5 w-3.5" />
              </button>
            </>
          )}
          {clipboard && compact && clipboard.hasClipboard && (
            <button
              type="button"
              onClick={doPaste}
              className="inline-flex items-center justify-center rounded-md border border-border/60 p-1 text-muted-foreground hover:bg-muted/80 hover:text-foreground"
              title={t('contextMenu.paste')}
              aria-label={t('contextMenu.paste')}
            >
              <ClipboardPaste className="h-3.5 w-3.5" />
            </button>
          )}
          {selectedIds.size > 0 && (
            <button
              type="button"
              onClick={() => onDeleteItems([...selectedIds])}
              className={cn(
                'inline-flex items-center justify-center rounded-md border border-destructive/40 text-destructive hover:bg-destructive/10',
                compact ? 'p-1' : 'p-1.5',
              )}
              title={t('action.delete')}
              aria-label={t('action.delete')}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
          {!compact && toolbarExtras}
        </div>

        <FolderBreadcrumb
          breadcrumb={breadcrumb}
          onNavigate={onNavigateFolder}
          rootLabel={t('folders.all') as string}
        />
      </div>

      {/* Creating-folder inline form removed — folders are created immediately
          with a default name, then put into rename mode via autoRenameFolderId. */}

      <div
        ref={gridRef}
        onClick={handleBackgroundClick}
        onMouseDown={beginMarquee}
        onContextMenu={(e) => {
          if (e.target !== e.currentTarget) return;
          e.preventDefault();
          setBgMenu({ x: e.clientX, y: e.clientY });
        }}
        className={cn('relative flex-1 min-h-0 overflow-y-auto', compact ? 'p-2' : 'p-3')}
      >
        <div
          ref={tilesRef}
          className={cn('grid', compact ? 'grid-cols-1 gap-1' : 'grid-cols-3 gap-2')}
        >
          {currentFolderId !== null && (
            <FolderTile
              label={t('fileExplorer.upFolder') as string}
              variant="up"
              onOpen={() => onNavigateFolder(parentFolderId)}
              onDropItems={(ids) => onMoveItemsToFolder(ids, parentFolderId)}
              dndMime={dndMime}
            />
          )}
          {childFolders.map((folder) => (
            <FolderTile
              key={folder.id}
              folderId={folder.id}
              label={folder.name}
              autoRename={folder.id === autoRenameFolderId}
              selected={selectedFolderIds.has(folder.id)}
              onClickTile={(e) => handleFolderTileClick(folder.id, e)}
              onOpen={() => onNavigateFolder(folder.id)}
              onRename={async (name) => {
                await onRenameFolder(folder.id, name);
                if (folder.id === autoRenameFolderId) setAutoRenameFolderId(null);
              }}
              onDelete={() => onDeleteFolder(folder.id)}
              onDropItems={(ids) => onMoveItemsToFolder(ids, folder.id)}
              dndMime={dndMime}
            />
          ))}
          {loading ? (
            <div className="col-span-full">
              <SkeletonList count={5} />
            </div>
          ) : visibleItems.length === 0 && childFolders.length === 0 ? (
            <div className="col-span-full py-6 text-center text-[11px] text-muted-foreground">
              {emptyLabel}
            </div>
          ) : (
            visibleItems.map((item) => {
              const isSelected = selectedIds.has(item.id);
              const isActive = item.id === activeItemId;
              const isCut = clipboard?.cutIds?.has(item.id) ?? false;
              return (
                <div
                  key={item.id}
                  data-tile-id={item.id}
                  role="button"
                  tabIndex={0}
                  draggable
                  onClick={(e) => handleTileClick(item, e)}
                  onDoubleClick={() => onOpenItem(item)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (!isSelected) setSelectedIds(new Set([item.id]));
                    setItemMenu({ x: e.clientX, y: e.clientY, item });
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onOpenItem(item);
                    }
                  }}
                  onDragStart={(e) => {
                    const ids = isSelected && selectedIds.size > 1 ? [...selectedIds] : [item.id];
                    e.dataTransfer.setData(dndMime, ids.length === 1 ? ids[0]! : ids.join(','));
                    e.dataTransfer.effectAllowed = 'move';
                    if (ids.length > 1) {
                      const ghost = document.createElement('div');
                      ghost.textContent = `${ids.length} ${t('fileExplorer.itemsSelected')}`;
                      ghost.style.cssText =
                        'position:fixed;left:-1000px;top:-1000px;padding:4px 10px;border-radius:6px;font-size:11px;font-weight:500;background:hsl(var(--primary));color:hsl(var(--primary-foreground));white-space:nowrap;pointer-events:none;';
                      document.body.appendChild(ghost);
                      e.dataTransfer.setDragImage(ghost, 0, 0);
                      requestAnimationFrame(() => ghost.remove());
                    }
                  }}
                  className={cn(
                    'group relative flex flex-col rounded-md border bg-background p-1.5 text-left transition-colors focus:outline-none',
                    isActive
                      ? 'border-primary ring-1 ring-primary'
                      : isSelected
                        ? 'border-primary bg-primary/15 ring-1 ring-primary/40'
                        : 'border-border/60 hover:border-primary/40 hover:bg-muted/60',
                    isCut && 'opacity-50',
                  )}
                >
                  <div className="aspect-square w-full overflow-hidden rounded bg-muted flex items-center justify-center">
                    {renderThumbnail(item)}
                  </div>
                  <div className="mt-1 min-w-0">
                    <div className="truncate text-[11px] font-medium">{item.name}</div>
                    {renderSubtitle && (
                      <div className="truncate text-[10px] text-muted-foreground">
                        {renderSubtitle(item)}
                      </div>
                    )}
                    {renderBadge && !compact && <div className="mt-0.5">{renderBadge(item)}</div>}
                  </div>
                </div>
              );
            })
          )}
        </div>
        {marquee && (
          <div
            data-no-marquee
            className="pointer-events-none absolute rounded-sm border-2 border-primary bg-primary/25 shadow-[0_0_0_1px_rgba(255,255,255,0.15)]"
            style={{ left: marquee.x, top: marquee.y, width: marquee.w, height: marquee.h }}
          />
        )}
      </div>

      {itemMenu && (
        <TileContextMenu
          x={itemMenu.x}
          y={itemMenu.y}
          onClose={() => setItemMenu(null)}
          items={[
            {
              label: t('fileExplorer.openAction') as string,
              onSelect: () => onOpenItem(itemMenu.item),
            },
            ...(clipboard
              ? [
                  {
                    label: t('contextMenu.copy') as string,
                    onSelect: () => clipboard.copy(getSelectedItems()),
                  },
                  {
                    label: t('contextMenu.cut') as string,
                    onSelect: () => clipboard.cut(getSelectedItems()),
                  },
                ]
              : []),
            ...(onDuplicateItems
              ? [
                  {
                    label: t('action.duplicate') as string,
                    onSelect: () => onDuplicateItems([...selectedIds]),
                  },
                ]
              : []),
            {
              label: t('action.delete') as string,
              onSelect: () => onDeleteItems([...selectedIds]),
              destructive: true,
            },
          ]}
        />
      )}

      {bgMenu && (
        <TileContextMenu
          x={bgMenu.x}
          y={bgMenu.y}
          onClose={() => setBgMenu(null)}
          items={[
            {
              label: newItemLabel,
              onSelect: onCreateItem,
            },
            {
              label: t('folders.createFolder') as string,
              onSelect: () => void handleCreateFolder(),
            },
            ...(clipboard && clipboard.hasClipboard && onPaste
              ? [
                  {
                    label: t('contextMenu.paste') as string,
                    onSelect: doPaste,
                  },
                ]
              : []),
          ]}
        />
      )}
    </div>
  );
}
