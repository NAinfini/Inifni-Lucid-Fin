import { memo, useCallback, useState } from 'react';
import type { NodeProps } from '@xyflow/react';
import { ChevronDown, ChevronRight, LayoutTemplate } from 'lucide-react';
import { cn } from '../../../lib/utils.js';
import { t } from '../../../i18n.js';
import { NodeContextMenu } from '../NodeContextMenu.js';
import { NodeResizeControls } from './node-resize-controls.js';

const DEFAULT_COLOR = '#334155';
const DEFAULT_OPACITY = 0.14;
const COLLAPSED_HEIGHT = 44;

const TITLE_SIZE_CLASSES: Record<string, string> = {
  sm: 'text-xs',
  md: 'text-sm',
  lg: 'text-base',
};

function hexWithAlpha(hex: string, opacity: number): string {
  const alpha = Math.round(Math.max(0, Math.min(1, opacity)) * 255)
    .toString(16)
    .padStart(2, '0');
  if (/^#[\da-f]{3}$/i.test(hex)) {
    const [r, g, b] = hex.slice(1);
    return `#${r}${r}${g}${g}${b}${b}${alpha}`;
  }
  if (/^#[\da-f]{6}$/i.test(hex)) return `${hex}${alpha}`;
  return hex;
}

export interface BackdropNodeFlowData {
  nodeId: string;
  title: string;
  color?: string;
  opacity?: number;
  collapsed?: boolean;
  locked?: boolean;
  bypassed?: boolean;
  colorTag?: string;
  width?: number;
  height?: number;
  borderStyle?: 'dashed' | 'solid' | 'dotted';
  titleSize?: 'sm' | 'md' | 'lg';
  childCount?: number;
  onTitleChange?: (id: string, title: string) => void;
  onToggleCollapse?: (id: string) => void;
  onOpacityChange?: (id: string, opacity: number) => void;
  onDelete?: (id: string) => void;
  onDuplicate?: (id: string) => void;
  onDisconnect?: (id: string) => void;
  onRename?: (id: string) => void;
  onCut?: (id: string) => void;
  onCopy?: (id: string) => void;
  onPaste?: (id: string) => void;
  onLock?: (id: string) => void;
  onColorTag?: (id: string, color: string | undefined) => void;
}

function BackdropNodeComponent({ data, selected }: NodeProps) {
  const d = data as unknown as BackdropNodeFlowData;
  const [editing, setEditing] = useState(false);
  const [titleDraft, setTitleDraft] = useState(d.title);

  const color = d.color ?? DEFAULT_COLOR;
  const opacity = d.opacity ?? DEFAULT_OPACITY;
  const collapsed = d.collapsed ?? false;
  const borderStyle = d.borderStyle ?? 'dashed';
  const titleSize = d.titleSize ?? 'md';

  const commitTitle = useCallback(() => {
    setEditing(false);
    if (titleDraft !== d.title) {
      d.onTitleChange?.(d.nodeId, titleDraft);
    }
  }, [d, titleDraft]);

  const borderClass =
    borderStyle === 'solid'
      ? 'border-solid'
      : borderStyle === 'dotted'
        ? 'border-dotted'
        : 'border-dashed';

  return (
    <NodeContextMenu
      nodeId={d.nodeId}
      nodeType="backdrop"
      locked={d.locked ?? false}
      colorTag={d.colorTag}
      onRename={d.onRename ?? (() => {})}
      onDelete={d.onDelete ?? (() => {})}
      onDuplicate={d.onDuplicate ?? (() => {})}
      onCut={d.onCut ?? (() => {})}
      onCopy={d.onCopy ?? (() => {})}
      onPaste={d.onPaste ?? (() => {})}
      onDisconnect={d.onDisconnect ?? (() => {})}
      onLock={d.onLock ?? (() => {})}
      onGenerate={() => {}}
      onColorTag={d.onColorTag ?? (() => {})}
    >
      <div
        className={cn(
          'rounded-2xl border shadow-inner transition-[height] duration-150',
          borderClass,
          selected ? 'border-blue-400 ring-2 ring-blue-400/30' : 'border-slate-500/30',
        )}
        style={{
          width: d.width ?? 420,
          height: collapsed ? COLLAPSED_HEIGHT : (d.height ?? 240),
          backgroundColor: hexWithAlpha(color, opacity),
          borderColor: color,
          ...(d.colorTag ? { boxShadow: `0 0 0 2px ${d.colorTag}` } : undefined),
        }}
      >
        <NodeResizeControls
          minWidth={280}
          minHeight={180}
          isVisible={selected && !collapsed}
          className="!h-3 !w-3 !border-background !bg-primary"
        />
        <div className={cn('flex h-full flex-col', collapsed ? 'justify-center px-3 py-1' : 'justify-between p-4')}>
          <div className="flex items-center gap-2 text-slate-200/90">
            <button
              type="button"
              className="nodrag inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-slate-300 transition-colors hover:bg-slate-700/50 hover:text-slate-100"
              aria-label={collapsed ? t('node.expandBackdrop') : t('node.collapseBackdrop')}
              onClick={(e) => { e.stopPropagation(); if (!d.locked) d.onToggleCollapse?.(d.nodeId); }}
              onContextMenu={(e) => e.preventDefault()}
              disabled={d.locked}
            >
              {collapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            </button>
            <LayoutTemplate className="h-4 w-4 shrink-0" />
            {editing ? (
              <input
                value={titleDraft}
                onChange={(event) => setTitleDraft(event.target.value)}
                onBlur={commitTitle}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') commitTitle();
                  if (event.key === 'Escape') {
                    setTitleDraft(d.title);
                    setEditing(false);
                  }
                }}
                className={cn(
                  'nodrag w-full border-b border-primary/60 bg-transparent font-medium outline-none',
                  TITLE_SIZE_CLASSES[titleSize],
                )}
                autoFocus
              />
            ) : (
              <button
                type="button"
                onDoubleClick={() => {
                  if (d.locked) return;
                  setTitleDraft(d.title);
                  setEditing(true);
                }}
                onContextMenu={(e) => e.preventDefault()}
                className={cn(
                  'flex-1 truncate text-left font-semibold tracking-wide text-slate-100',
                  TITLE_SIZE_CLASSES[titleSize],
                )}
              >
                {d.title || t('node.backdrop')}
              </button>
            )}
            {typeof d.childCount === 'number' && d.childCount > 0 && (
              <span className="shrink-0 rounded bg-slate-700/50 px-1.5 py-0.5 text-[10px] text-slate-400">
                {d.childCount} {t('inspector.backdrop.childCount')}
              </span>
            )}
          </div>

          {!collapsed && (
            <div className="mt-auto">
              <div className="rounded-2xl border border-dashed border-slate-300/20 px-3 py-2 text-[11px] text-slate-200/70">
                {t('node.backdropHelpText')}
              </div>
            </div>
          )}
        </div>
      </div>
    </NodeContextMenu>
  );
}

export const BackdropNode = memo(BackdropNodeComponent);
