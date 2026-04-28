import { memo } from 'react';
import type { NodeProps } from '@xyflow/react';
import { cn } from '../../../lib/utils.js';
import { t } from '../../../i18n.js';
import { FileText } from 'lucide-react';
import { NodeStatusBadge } from '../NodeStatusBadge.js';
import { NodeContextMenu } from '../NodeContextMenu.js';
import type { NodeStatus } from '@lucid-fin/contracts';
import { NodeBorderHandles } from './node-border-handles.js';
import { NodeResizeControls } from './node-resize-controls.js';
import { useCanvasLodFromContext } from '../use-canvas-lod.js';

export interface TextNodeFlowData {
  nodeId: string;
  title: string;
  content: string;
  status: NodeStatus;
  bypassed: boolean;
  locked: boolean;
  colorTag?: string;
}

function TextNodeComponent({ data, selected }: NodeProps) {
  const d = data as unknown as TextNodeFlowData;
  const lod = useCanvasLodFromContext();
  return (
    <NodeContextMenu
      nodeId={d.nodeId}
      nodeType="text"
      locked={d.locked}
      colorTag={d.colorTag}
    >
      <div className="relative h-full min-h-[120px] min-w-[200px] w-full">
        <NodeBorderHandles colorClassName="!bg-primary" />
        {lod === 'full' && (
          <NodeResizeControls
            minWidth={200}
            minHeight={120}
            isVisible={selected}
            className="!h-2.5 !w-2.5 !border-background !bg-primary"
          />
        )}
        <div
          className={cn(
            'relative flex flex-col rounded-md border bg-card shadow-sm h-full w-full min-w-[200px] min-h-[120px]',
            'transition-shadow',
            selected ? 'border-primary ring-2 ring-primary/40' : 'border-border',
            d.bypassed && 'opacity-40',
          )}
          style={d.colorTag ? { boxShadow: `0 0 0 2px ${d.colorTag}` } : undefined}
        >
          <NodeStatusBadge status={d.status} />

          <div className="flex items-center gap-1.5 border-b px-3 py-2">
            <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <span className="flex-1 truncate text-xs font-medium">
              {d.title || t('node.textNode')}
            </span>
          </div>

          {lod !== 'minimal' && (
            <div className="flex-1 overflow-auto px-3 py-2 text-xs text-muted-foreground">
              {d.content || t('node.emptyText')}
            </div>
          )}
        </div>
      </div>
    </NodeContextMenu>
  );
}

export const TextNode = memo(TextNodeComponent);
