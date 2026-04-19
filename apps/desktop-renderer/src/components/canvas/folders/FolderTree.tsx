import { useMemo, useState } from 'react';
import type { Folder } from '@lucid-fin/contracts';
import { ChevronRight, Folder as FolderIcon, FolderOpen, Plus, Pencil, Trash2 } from 'lucide-react';
import { cn } from '../../../lib/utils.js';

export interface FolderTreeProps {
  folders: Folder[];
  currentFolderId: string | null;
  onSelect: (id: string | null) => void;
  onCreate: (parentId: string | null, name: string) => Promise<unknown> | unknown;
  onRename: (id: string, name: string) => Promise<unknown> | unknown;
  onDelete: (id: string) => Promise<unknown> | unknown;
  /** Optional item drop target — fires when an entity item is dropped on a folder. */
  onDropItem?: (folderId: string | null, payload: string) => void;
  /** Drag data-transfer key used for item drops. Callers set the same key on the item. */
  dropItemKey?: string;
  labels?: {
    rootLabel?: string;
    newFolderPlaceholder?: string;
    createFolder?: string;
    rename?: string;
    delete?: string;
  };
}

interface TreeNode {
  folder: Folder;
  children: TreeNode[];
}

function buildTree(folders: Folder[]): TreeNode[] {
  const byParent = new Map<string | null, Folder[]>();
  for (const f of folders) {
    const bucket = byParent.get(f.parentId) ?? [];
    bucket.push(f);
    byParent.set(f.parentId, bucket);
  }
  for (const list of byParent.values()) {
    list.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
  }
  const attach = (parentId: string | null): TreeNode[] =>
    (byParent.get(parentId) ?? []).map((folder) => ({
      folder,
      children: attach(folder.id),
    }));
  return attach(null);
}

export function FolderTree({
  folders,
  currentFolderId,
  onSelect,
  onCreate,
  onRename,
  onDelete,
  onDropItem,
  dropItemKey = 'application/lucid-entity-id',
  labels,
}: FolderTreeProps) {
  const tree = useMemo(() => buildTree(folders), [folders]);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [creatingParent, setCreatingParent] = useState<string | null | undefined>(undefined);
  const [draftName, setDraftName] = useState('');
  const [renamingId, setRenamingId] = useState<string | null>(null);

  const toggle = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const startCreate = (parentId: string | null) => {
    setCreatingParent(parentId);
    setDraftName('');
    if (parentId) setExpanded((p) => new Set(p).add(parentId));
  };

  const commitCreate = async () => {
    const name = draftName.trim();
    if (!name) {
      setCreatingParent(undefined);
      return;
    }
    await onCreate(creatingParent ?? null, name);
    setCreatingParent(undefined);
    setDraftName('');
  };

  const commitRename = async (id: string) => {
    const name = draftName.trim();
    if (!name) {
      setRenamingId(null);
      return;
    }
    await onRename(id, name);
    setRenamingId(null);
    setDraftName('');
  };

  const handleItemDrop = (folderId: string | null) => (e: React.DragEvent<HTMLDivElement>) => {
    if (!onDropItem) return;
    const payload = e.dataTransfer.getData(dropItemKey);
    if (!payload) return;
    e.preventDefault();
    onDropItem(folderId, payload);
  };

  const rootActive = currentFolderId === null;

  const renderNode = (node: TreeNode, depth: number) => {
    const { folder } = node;
    const isOpen = expanded.has(folder.id);
    const isActive = currentFolderId === folder.id;
    const isRenaming = renamingId === folder.id;
    const hasChildren = node.children.length > 0;

    return (
      <div key={folder.id}>
        <div
          className={cn(
            'group flex items-center gap-1 rounded px-1 py-0.5 text-[11px] cursor-pointer hover:bg-muted/70 transition-colors',
            isActive && 'bg-primary/15 text-primary',
          )}
          style={{ paddingLeft: 4 + depth * 10 }}
          onClick={() => onSelect(folder.id)}
          onDragOver={onDropItem ? (e) => e.preventDefault() : undefined}
          onDrop={onDropItem ? handleItemDrop(folder.id) : undefined}
        >
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              if (hasChildren) toggle(folder.id);
            }}
            className={cn(
              'w-3 h-3 flex items-center justify-center text-muted-foreground',
              !hasChildren && 'invisible',
            )}
            aria-label={isOpen ? 'collapse' : 'expand'}
          >
            <ChevronRight className={cn('w-3 h-3 transition-transform', isOpen && 'rotate-90')} />
          </button>
          {isOpen ? (
            <FolderOpen className="w-3 h-3 shrink-0 opacity-80" />
          ) : (
            <FolderIcon className="w-3 h-3 shrink-0 opacity-80" />
          )}
          {isRenaming ? (
            <input
              autoFocus
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
              onBlur={() => void commitRename(folder.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void commitRename(folder.id);
                if (e.key === 'Escape') setRenamingId(null);
              }}
              onClick={(e) => e.stopPropagation()}
              className="flex-1 min-w-0 rounded bg-muted px-1 text-[11px] outline-none focus:ring-1 focus:ring-ring"
            />
          ) : (
            <span className="truncate flex-1 min-w-0">{folder.name}</span>
          )}
          {!isRenaming && (
            <div className="hidden group-hover:flex items-center gap-0.5">
              <button
                type="button"
                className="p-0.5 hover:bg-muted rounded"
                title={labels?.createFolder ?? 'New subfolder'}
                onClick={(e) => {
                  e.stopPropagation();
                  startCreate(folder.id);
                }}
              >
                <Plus className="w-2.5 h-2.5" />
              </button>
              <button
                type="button"
                className="p-0.5 hover:bg-muted rounded"
                title={labels?.rename ?? 'Rename'}
                onClick={(e) => {
                  e.stopPropagation();
                  setRenamingId(folder.id);
                  setDraftName(folder.name);
                }}
              >
                <Pencil className="w-2.5 h-2.5" />
              </button>
              <button
                type="button"
                className="p-0.5 hover:bg-destructive/20 rounded"
                title={labels?.delete ?? 'Delete'}
                onClick={(e) => {
                  e.stopPropagation();
                  void onDelete(folder.id);
                }}
              >
                <Trash2 className="w-2.5 h-2.5" />
              </button>
            </div>
          )}
        </div>
        {isOpen && hasChildren && node.children.map((c) => renderNode(c, depth + 1))}
        {creatingParent === folder.id && (
          <div
            className="flex items-center gap-1 px-1 py-0.5"
            style={{ paddingLeft: 4 + (depth + 1) * 10 }}
          >
            <span className="w-3 h-3" />
            <FolderIcon className="w-3 h-3 opacity-60" />
            <input
              autoFocus
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
              onBlur={() => void commitCreate()}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void commitCreate();
                if (e.key === 'Escape') setCreatingParent(undefined);
              }}
              placeholder={labels?.newFolderPlaceholder ?? 'Folder name'}
              className="flex-1 min-w-0 rounded bg-muted px-1 text-[11px] outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="flex flex-col min-h-0">
      <div
        className={cn(
          'group flex items-center gap-1 rounded px-1 py-0.5 text-[11px] cursor-pointer hover:bg-muted/70 transition-colors',
          rootActive && 'bg-primary/15 text-primary',
        )}
        onClick={() => onSelect(null)}
        onDragOver={onDropItem ? (e) => e.preventDefault() : undefined}
        onDrop={onDropItem ? handleItemDrop(null) : undefined}
      >
        <span className="w-3 h-3" />
        <FolderIcon className="w-3 h-3 shrink-0 opacity-80" />
        <span className="truncate flex-1 min-w-0">{labels?.rootLabel ?? 'All'}</span>
        <button
          type="button"
          className="hidden group-hover:inline-flex p-0.5 hover:bg-muted rounded"
          title={labels?.createFolder ?? 'New folder'}
          onClick={(e) => {
            e.stopPropagation();
            startCreate(null);
          }}
        >
          <Plus className="w-2.5 h-2.5" />
        </button>
      </div>
      {creatingParent === null && (
        <div className="flex items-center gap-1 px-1 py-0.5" style={{ paddingLeft: 14 }}>
          <FolderIcon className="w-3 h-3 opacity-60" />
          <input
            autoFocus
            value={draftName}
            onChange={(e) => setDraftName(e.target.value)}
            onBlur={() => void commitCreate()}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void commitCreate();
              if (e.key === 'Escape') setCreatingParent(undefined);
            }}
            placeholder={labels?.newFolderPlaceholder ?? 'Folder name'}
            className="flex-1 min-w-0 rounded bg-muted px-1 text-[11px] outline-none focus:ring-1 focus:ring-ring"
          />
        </div>
      )}
      {tree.map((n) => renderNode(n, 0))}
    </div>
  );
}
