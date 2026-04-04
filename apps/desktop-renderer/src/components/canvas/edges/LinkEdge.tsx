import { useState, useCallback } from 'react';
import { getBezierPath, BaseEdge, EdgeLabelRenderer, type EdgeProps } from '@xyflow/react';
import * as ContextMenu from '@radix-ui/react-context-menu';
import { ArrowLeftRight, FileText, Image, LayoutTemplate, Trash2, Video, Volume2, X } from 'lucide-react';
import { cn } from '../../../lib/utils.js';
import { t } from '../../../i18n.js';
import type { CanvasNodeType, EdgeStatus } from '@lucid-fin/contracts';

export interface LinkEdgeData {
  label?: string;
  status: EdgeStatus;
  onDelete?: (id: string) => void;
  onSwapDirection?: (id: string) => void;
  onInsertNode?: (id: string, type: CanvasNodeType, position: { x: number; y: number }) => void;
  dependencyRole?: 'upstream' | 'downstream' | 'focus' | null;
  dimmed?: boolean;
}

const EDGE_COLORS: Record<EdgeStatus, string> = {
  idle: '#6b7280', // gray-500
  generating: '#f59e0b', // amber-500
  done: '#22c55e', // green-500
  failed: '#ef4444', // red-500
};

export function LinkEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style = {},
  markerEnd,
  data,
  selected,
}: EdgeProps) {
  const d = (data ?? { status: 'idle' }) as unknown as LinkEdgeData;
  const [hovered, setHovered] = useState(false);

  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  const strokeColor =
    d.dependencyRole === 'upstream'
      ? '#f59e0b'
      : d.dependencyRole === 'downstream'
        ? '#38bdf8'
        : d.dependencyRole === 'focus'
          ? '#a855f7'
          : EDGE_COLORS[d.status] ?? EDGE_COLORS.idle;

  const handleDelete = useCallback(() => {
    d.onDelete?.(id);
  }, [d, id]);

  const handleSwap = useCallback(() => {
    d.onSwapDirection?.(id);
  }, [d, id]);

  const handleInsertNode = useCallback(
    (type: CanvasNodeType) => {
      d.onInsertNode?.(id, type, { x: (sourceX + targetX) / 2, y: (sourceY + targetY) / 2 });
    },
    [d, id, sourceX, sourceY, targetX, targetY],
  );

  const insertActions: Array<{ type: CanvasNodeType; labelKey: string; icon: typeof FileText }> = [
    { type: 'text', labelKey: 'contextMenu.insertText', icon: FileText },
    { type: 'image', labelKey: 'contextMenu.insertImage', icon: Image },
    { type: 'video', labelKey: 'contextMenu.insertVideo', icon: Video },
    { type: 'audio', labelKey: 'contextMenu.insertAudio', icon: Volume2 },
    { type: 'backdrop', labelKey: 'contextMenu.insertFrame', icon: LayoutTemplate },
  ];

  return (
    <>
      <ContextMenu.Root>
        <ContextMenu.Trigger asChild>
          <path
            d={edgePath}
            fill="none"
            stroke="transparent"
            strokeWidth={20}
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
            className="cursor-pointer"
          />
        </ContextMenu.Trigger>
        <ContextMenu.Portal>
          <ContextMenu.Content className="z-50 min-w-[180px] rounded-xl border border-border bg-card p-1 text-popover-foreground shadow-xl">
            <ContextMenu.Sub>
              <ContextMenu.SubTrigger className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-xs outline-none hover:bg-accent hover:text-accent-foreground">
                <LayoutTemplate className="h-3.5 w-3.5" />
                {t('contextMenu.insertNode')}
              </ContextMenu.SubTrigger>
              <ContextMenu.Portal>
                <ContextMenu.SubContent className="z-50 min-w-[170px] rounded-xl border border-border bg-card p-1 shadow-xl">
                  {insertActions.map((action) => {
                    const Icon = action.icon;
                    return (
                      <ContextMenu.Item
                        key={action.type}
                        onSelect={() => handleInsertNode(action.type)}
                        className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-xs outline-none hover:bg-accent hover:text-accent-foreground"
                      >
                        <Icon className="h-3.5 w-3.5" />
                        {t(action.labelKey)}
                      </ContextMenu.Item>
                    );
                  })}
                </ContextMenu.SubContent>
              </ContextMenu.Portal>
            </ContextMenu.Sub>
            <ContextMenu.Item
              onSelect={handleSwap}
              className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-xs outline-none hover:bg-accent hover:text-accent-foreground"
            >
              <ArrowLeftRight className="h-3.5 w-3.5" />
              {t('contextMenu.swapDirection')}
            </ContextMenu.Item>
            <ContextMenu.Separator className="h-px my-1 bg-border" />
            <ContextMenu.Item
              onSelect={handleDelete}
              className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-xs outline-none hover:bg-destructive/20 hover:text-destructive"
            >
              <Trash2 className="h-3.5 w-3.5" />
              {t('contextMenu.deleteEdge')}
            </ContextMenu.Item>
          </ContextMenu.Content>
        </ContextMenu.Portal>
      </ContextMenu.Root>

      <BaseEdge
        path={edgePath}
        markerEnd={markerEnd}
        style={{
          ...style,
          stroke: strokeColor,
          strokeWidth: selected ? 2.5 : 1.5,
          opacity: d.dimmed ? 0.18 : selected ? 1 : 0.72,
        }}
      />

      <EdgeLabelRenderer>
        {(hovered || selected) && (
          <div
            className="absolute flex items-center gap-1 pointer-events-auto z-50"
            style={{
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY - 16}px)`,
            }}
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
          >
            <button
              onClick={handleSwap}
              className={cn(
                'p-0.5 rounded bg-card border border-border hover:bg-muted transition-colors shadow-sm',
                'text-muted-foreground hover:text-foreground',
              )}
              title={t('contextMenu.swapDirection')}
              aria-label={t('contextMenu.swapDirection')}
            >
              <ArrowLeftRight className="w-3 h-3" />
            </button>
            <button
              onClick={handleDelete}
              className={cn(
                'p-0.5 rounded bg-card border border-border hover:bg-destructive/20 transition-colors shadow-sm',
                'text-muted-foreground hover:text-destructive',
              )}
              title={t('contextMenu.deleteEdge')}
              aria-label={t('contextMenu.deleteEdge')}
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        )}

        {/* Label */}
        {d.label && (
          <div
            className="absolute pointer-events-none z-30"
            style={{
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY + 12}px)`,
            }}
          >
            <span className="text-[9px] text-muted-foreground bg-card/90 px-1 py-0.5 rounded border border-border/50">
              {d.label}
            </span>
          </div>
        )}

        {(hovered || selected) && (
          <div
            className="absolute pointer-events-none rounded-lg border border-border/70 bg-card/95 px-2 py-1 text-[10px] shadow-lg z-40"
            style={{
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY + 34}px)`,
            }}
          >
            <div className="font-medium text-foreground">{d.label ?? t('edge.connection')}</div>
            <div className="text-muted-foreground">{t('edge.statusLabel')}: {t('status.' + d.status)}</div>
          </div>
        )}
      </EdgeLabelRenderer>
    </>
  );
}
