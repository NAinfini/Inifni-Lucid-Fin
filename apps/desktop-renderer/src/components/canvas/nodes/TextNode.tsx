import { memo } from 'react';
import { Handle, Position, NodeResizer, type NodeProps } from '@xyflow/react';
import { cn } from '../../../lib/utils.js';
import { t } from '../../../i18n.js';
import { FileText, Sparkles } from 'lucide-react';
import { NodeStatusBadge } from '../NodeStatusBadge.js';
import { NodeContextMenu } from '../NodeContextMenu.js';
import { CanvasNodeTooltip } from '../CanvasNodeTooltip.js';
import type { NodeStatus } from '@lucid-fin/contracts';

export interface TextNodeFlowData {
  nodeId: string;
  title: string;
  content: string;
  status: NodeStatus;
  bypassed: boolean;
  locked: boolean;
  colorTag?: string;
  onTitleChange?: (id: string, title: string) => void;
  onDelete?: (id: string) => void;
  onDuplicate?: (id: string) => void;
  onDisconnect?: (id: string) => void;
  onConnectTo?: (id: string) => void;
  onRename?: (id: string) => void;
  onCut?: (id: string) => void;
  onCopy?: (id: string) => void;
  onPaste?: (id: string) => void;
  onLock?: (id: string) => void;
  onColorTag?: (id: string, color: string | undefined) => void;
}

function TextNodeComponent({ data, selected }: NodeProps) {
  const d = data as unknown as TextNodeFlowData;
  return (
    <NodeContextMenu
      nodeId={d.nodeId}
      nodeType="text"
      locked={d.locked}
      colorTag={d.colorTag}
      onRename={d.onRename ?? (() => {})}
      onDelete={d.onDelete ?? (() => {})}
      onDuplicate={d.onDuplicate ?? (() => {})}
      onCut={d.onCut ?? (() => {})}
      onCopy={d.onCopy ?? (() => {})}
      onPaste={d.onPaste ?? (() => {})}
      onDisconnect={d.onDisconnect ?? (() => {})}
      onConnectTo={d.onConnectTo}
      onLock={d.onLock ?? (() => {})}
      onGenerate={() => {}}
      onColorTag={d.onColorTag ?? (() => {})}
    >
      <CanvasNodeTooltip
        title={d.title || t('node.textNode')}
        subtitle={t('node.text')}
        items={[
          { label: t('node.status'), value: d.status },
          { label: t('node.length'), value: `${d.content?.length ?? 0} ${t('node.chars')}` },
          { label: t('node.mode'), value: d.locked ? t('node.locked') : t('node.editable') },
        ]}
      >
        <div
          className={cn(
            'relative rounded-lg border-2 bg-card shadow-md min-w-[200px]',
            'transition-shadow',
            selected ? 'border-blue-400 ring-[3px] ring-blue-400/50' : 'border-border',
            d.bypassed && 'opacity-40',
          )}
          style={d.colorTag ? { boxShadow: `0 0 0 2px ${d.colorTag}` } : undefined}
        >
          <NodeResizer
            minWidth={200}
            minHeight={120}
            isVisible={selected}
            lineClassName="!border-blue-400/60"
            handleClassName="!h-2.5 !w-2.5 !border-background !bg-blue-400"
          />
          <NodeStatusBadge status={d.status} />

          <div className="flex items-center gap-1.5 border-b px-3 py-2">
            <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <span className="flex-1 truncate text-xs font-medium">
              {d.title || t('node.textNode')}
            </span>
          </div>

          <div className="min-h-[40px] px-3 py-2 text-xs text-muted-foreground line-clamp-4">
            {d.content || t('node.emptyText')}
          </div>

          <div className="flex items-center gap-1 border-t px-3 py-1.5">
            <button
              className="flex items-center gap-1 rounded bg-primary/10 px-2 py-0.5 text-[10px] text-primary transition-colors hover:bg-primary/20"
              aria-label={t('node.generate')}
              onContextMenu={(e) => e.preventDefault()}
            >
              <Sparkles className="h-3 w-3" />
              {t('node.generate')}
            </button>
          </div>

          <Handle
            type="source"
            position={Position.Top}
            id="top"
            className="!h-2.5 !w-2.5 !border-2 !border-background !bg-primary"
          />
          <Handle
            type="source"
            position={Position.Right}
            id="right"
            className="!h-2.5 !w-2.5 !border-2 !border-background !bg-primary"
          />
          <Handle
            type="source"
            position={Position.Bottom}
            id="bottom"
            className="!h-2.5 !w-2.5 !border-2 !border-background !bg-primary"
          />
          <Handle
            type="source"
            position={Position.Left}
            id="left"
            className="!h-2.5 !w-2.5 !border-2 !border-background !bg-primary"
          />
        </div>
      </CanvasNodeTooltip>
    </NodeContextMenu>
  );
}

export const TextNode = memo(TextNodeComponent);
