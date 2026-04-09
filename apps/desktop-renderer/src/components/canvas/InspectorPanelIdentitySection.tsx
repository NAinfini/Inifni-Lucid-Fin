import type { ChangeEventHandler } from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '../../lib/utils.js';
import type { CanvasNode } from '@lucid-fin/contracts';

interface InspectorPanelIdentitySectionProps {
  node: CanvasNode;
  icon: LucideIcon;
  iconColorClass: string;
  titleLabel: string;
  titlePlaceholder: string;
  typeLabel: string;
  statusLabel: string;
  positionLabel: string;
  sizeLabel: string;
  connectionsLabel: string;
  connectionCount: number;
  generationTimeLabel?: string;
  nodeTypeLabel: string;
  nodeStatusLabel: string;
  onTitleChange: ChangeEventHandler<HTMLInputElement>;
}

export function InspectorPanelIdentitySection({
  node,
  icon: Icon,
  iconColorClass,
  titleLabel,
  titlePlaceholder,
  typeLabel,
  statusLabel,
  positionLabel,
  sizeLabel,
  connectionsLabel,
  connectionCount,
  generationTimeLabel,
  nodeTypeLabel,
  nodeStatusLabel,
  onTitleChange,
}: InspectorPanelIdentitySectionProps) {
  return (
    <div className="space-y-3 border-b border-border/60 px-3 py-3">
      <div className="space-y-1">
        <label className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          {titleLabel}
        </label>
        <input
          className="w-full rounded-md bg-muted px-2.5 py-1.5 text-xs outline-none focus:ring-1 focus:ring-ring"
          value={node.title}
          onChange={onTitleChange}
          placeholder={titlePlaceholder}
        />
      </div>

      <div className="flex items-center gap-3">
        <div className="space-y-1">
          <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            {typeLabel}
          </div>
          <div
            className={cn(
              'inline-flex items-center gap-1 rounded-md bg-muted px-2 py-0.5 text-[11px] font-medium',
              iconColorClass,
            )}
          >
            <Icon className="h-3 w-3" />
            {nodeTypeLabel}
          </div>
        </div>
        <div className="space-y-1">
          <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            {statusLabel}
          </div>
          <div className="text-xs capitalize">{nodeStatusLabel}</div>
        </div>
      </div>

      <div className="space-y-1">
        <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          {positionLabel}
        </div>
        <div className="flex gap-3 text-xs text-muted-foreground">
          <span>X: {Math.round(node.position.x)}</span>
          <span>Y: {Math.round(node.position.y)}</span>
        </div>
      </div>

      {node.width != null && node.height != null && (
        <div className="space-y-1">
          <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            {sizeLabel}
          </div>
          <div className="text-xs text-muted-foreground">
            {Math.round(node.width)} &times; {Math.round(node.height)}
          </div>
        </div>
      )}

      <div className="space-y-1">
        <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          {connectionsLabel}
        </div>
        <div className="text-xs text-muted-foreground">{connectionCount}</div>
      </div>

      {generationTimeLabel && (
        <div className="text-[11px] text-muted-foreground">{generationTimeLabel}</div>
      )}
    </div>
  );
}
