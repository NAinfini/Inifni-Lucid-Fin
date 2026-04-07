import { memo, useState } from 'react';
import { Handle, Position, NodeResizer, type NodeProps } from '@xyflow/react';
import { cn } from '../../../lib/utils.js';
import { t } from '../../../i18n.js';
import { Image, Loader2, Sparkles, RefreshCw, Lock, Unlock, Upload } from 'lucide-react';
import { NodeStatusBadge } from '../NodeStatusBadge.js';
import { NodeContextMenu } from '../NodeContextMenu.js';
import { CanvasNodeTooltip } from '../CanvasNodeTooltip.js';
import { useAssetUrl } from '../../../hooks/useAssetUrl.js';
import type { NodeStatus } from '@lucid-fin/contracts';

export interface ImageNodeFlowData {
  nodeId: string;
  title: string;
  status: NodeStatus;
  bypassed: boolean;
  locked: boolean;
  colorTag?: string;
  assetHash?: string;
  generationStatus: 'empty' | 'generating' | 'done' | 'failed';
  variants: string[];
  selectedVariantIndex: number;
  seed?: number;
  seedLocked: boolean;
  estimatedCost?: number;
  providerId?: string;
  variantCount?: number;
  progress?: number;
  error?: string;
  presetSummary?: string;
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
  onGenerate?: (id: string) => void;
  onUpload?: (id: string) => void;
  onSelectVariant?: (id: string, index: number) => void;
  onToggleSeedLock?: (id: string) => void;
}

function ImageNodeComponent({ data, selected }: NodeProps) {
  const d = data as unknown as ImageNodeFlowData;
  const activeHash = d.assetHash ?? d.variants[d.selectedVariantIndex];
  const hasThumbnail = Boolean(activeHash);
  const isGenerating = d.generationStatus === 'generating';
  const { url: activeUrl } = useAssetUrl(activeHash, 'image', 'png');
  const [imgError, setImgError] = useState(false);

  return (
    <NodeContextMenu
      nodeId={d.nodeId}
      nodeType="image"
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
      onGenerate={d.onGenerate ?? (() => {})}
      onColorTag={d.onColorTag ?? (() => {})}
    >
      <CanvasNodeTooltip
        title={d.title || t('node.imageNode')}
        subtitle={t('node.image')}
        items={[
          { label: t('node.status'), value: d.generationStatus },
          { label: t('node.variants'), value: d.variants.length || d.variantCount || 0 },
          { label: t('node.seed'), value: d.seed ?? '-' },
          { label: t('node.cost'), value: typeof d.estimatedCost === 'number' ? `$${d.estimatedCost.toFixed(2)}` : '-' },
        ]}
      >
        <div
          className={cn(
            'relative flex flex-col overflow-hidden rounded-lg border-2 bg-card shadow-md min-w-[200px]',
            'transition-shadow',
            selected ? 'border-blue-400 ring-[3px] ring-blue-400/50' : 'border-blue-500/40',
            d.bypassed && 'opacity-40',
          )}
          style={d.colorTag ? { boxShadow: `0 0 0 2px ${d.colorTag}` } : undefined}
        >
          <NodeResizer
            minWidth={200}
            minHeight={140}
            isVisible={selected}
            lineClassName="!border-blue-400/60"
            handleClassName="!h-2.5 !w-2.5 !border-background !bg-blue-400"
          />
          <NodeStatusBadge status={d.status} />
          {d.generationStatus === 'generating' && (
            <div className="pointer-events-none absolute inset-0 z-10 rounded-lg border-2 border-blue-500 bg-blue-500/5" style={{
              animation: 'border-glow 2s ease-in-out infinite',
            }} />
          )}

          <div className="flex items-center gap-1.5 border-b border-blue-500/20 px-3 py-2">
            <Image className="h-3.5 w-3.5 shrink-0 text-blue-400" />
            <span className="flex-1 truncate text-xs font-medium">
              {d.title || t('node.imageNode')}
            </span>
          </div>

          <div className="flex flex-1 items-center justify-center px-3 py-2 overflow-hidden min-h-0">
            {hasThumbnail && !imgError ? (
              activeUrl ? (
                <img
                  src={activeUrl}
                  alt={d.title || t('node.image')}
                  className="w-full h-full rounded object-cover"
                  draggable={false}
                  onError={() => setImgError(true)}
                />
              ) : (
                <div className="flex w-full h-full items-center justify-center rounded bg-muted text-xs text-muted-foreground">
                  {t('node.loading')}
                </div>
              )
            ) : isGenerating ? (
              <div className="flex flex-col items-center gap-1.5 text-blue-400">
                <Loader2 className="h-6 w-6 animate-spin" />
                <span className="text-[10px]">{t('node.generating')}</span>
              </div>
            ) : (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); d.onUpload?.(d.nodeId); }}
                className="flex flex-col items-center gap-1.5 text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
              >
                <Upload className="h-6 w-6 opacity-40" />
                <span className="text-[10px]">{t('node.noImageGenerated')}</span>
              </button>
            )}
          </div>

          {d.generationStatus === 'generating' && typeof d.progress === 'number' && (
            <div className="px-3 pb-1">
              <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
                <div className="h-full bg-blue-500 transition-all" style={{ width: `${d.progress}%` }} />
              </div>
              <span className="text-[10px] text-muted-foreground">{d.progress}%</span>
            </div>
          )}

          {d.generationStatus === 'failed' && d.error && (
            <div className="px-3 pb-1 overflow-hidden">
              <span className="block text-[10px] text-destructive line-clamp-2">{d.error}</span>
            </div>
          )}

          {d.variants.length > 1 && (
            <div className="overflow-x-auto px-3 pb-2">
              <div className="flex min-w-max items-center gap-1">
                {d.variants.slice(0, 9).map((hash, index) => (
                  <VariantThumb
                    key={hash}
                    hash={hash}
                    index={index}
                    selected={d.selectedVariantIndex === index}
                    type="image"
                    onClick={() => d.onSelectVariant?.(d.nodeId, index)}
                  />
                ))}
              </div>
            </div>
          )}

          <div className="flex items-center gap-1 border-t border-blue-500/20 px-3 py-1.5">
            <button
              className="flex items-center gap-1 rounded bg-blue-500/10 px-2 py-0.5 text-[10px] text-blue-400 transition-colors hover:bg-blue-500/20"
              aria-label={t('node.generate')}
              onClick={() => d.onGenerate?.(d.nodeId)}
              onContextMenu={(e) => e.preventDefault()}
              disabled={isGenerating}
            >
              <Sparkles className="h-3 w-3" />
              {t('node.generate')}
            </button>
            {hasThumbnail && (
              <button
                className="flex items-center gap-1 rounded bg-muted px-2 py-0.5 text-[10px] text-muted-foreground transition-colors hover:bg-muted/80"
                aria-label={t('node.regenerate')}
                onClick={() => d.onGenerate?.(d.nodeId)}
                onContextMenu={(e) => e.preventDefault()}
                disabled={isGenerating}
              >
                <RefreshCw className="h-3 w-3" />
                {t('node.regen')}
              </button>
            )}
            <span className="ml-auto inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
              {t('node.seed')} {typeof d.seed === 'number' ? d.seed : '-'}
              <button
                className="text-blue-400 hover:text-blue-300"
                onClick={() => d.onToggleSeedLock?.(d.nodeId)}
                onContextMenu={(e) => e.preventDefault()}
                aria-label={d.seedLocked ? 'Unlock seed' : 'Lock seed'}
              >
                {d.seedLocked ? <Lock className="h-3 w-3" /> : <Unlock className="h-3 w-3" />}
              </button>
            </span>
          </div>
          {d.presetSummary && (
            <div className="truncate border-t border-blue-500/10 px-3 pb-1.5 text-[10px] text-muted-foreground">
              {d.presetSummary}
            </div>
          )}

          <Handle
            type="source"
            position={Position.Top}
            id="top"
            className="!h-2.5 !w-2.5 !border-2 !border-background !bg-blue-500"
          />
          <Handle
            type="source"
            position={Position.Right}
            id="right"
            className="!h-2.5 !w-2.5 !border-2 !border-background !bg-blue-500"
          />
          <Handle
            type="source"
            position={Position.Bottom}
            id="bottom"
            className="!h-2.5 !w-2.5 !border-2 !border-background !bg-blue-500"
          />
          <Handle
            type="source"
            position={Position.Left}
            id="left"
            className="!h-2.5 !w-2.5 !border-2 !border-background !bg-blue-500"
          />
        </div>
      </CanvasNodeTooltip>
    </NodeContextMenu>
  );
}

function VariantThumb({
  hash,
  index,
  selected,
  type,
  onClick,
}: {
  hash: string;
  index: number;
  selected: boolean;
  type: 'image' | 'video';
  onClick: () => void;
}) {
  const { url } = useAssetUrl(hash, type, type === 'image' ? 'png' : 'mp4');
  return (
    <button
      className={cn(
        'h-10 w-10 shrink-0 overflow-hidden rounded border-2',
        selected ? 'border-blue-500 ring-1 ring-blue-500/40' : 'border-transparent hover:border-blue-400/50',
      )}
      onClick={onClick}
      onContextMenu={(e) => e.preventDefault()}
      aria-label={`Select variant ${index + 1}`}
    >
      {url ? (
        <img src={url} alt={`V${index + 1}`} className="h-full w-full object-cover" draggable={false} />
      ) : (
        <span className="flex h-full w-full items-center justify-center bg-muted text-[9px] text-muted-foreground">
          V{index + 1}
        </span>
      )}
    </button>
  );
}

export const ImageNode = memo(ImageNodeComponent);
