import { memo, useCallback, useRef, useState } from 'react';
import { Handle, Position, NodeResizer, type NodeProps } from '@xyflow/react';
import { cn } from '../../../lib/utils.js';
import { t } from '../../../i18n.js';
import { Video, Sparkles, RefreshCw, Play, Pause, Lock, Unlock } from 'lucide-react';
import { NodeStatusBadge } from '../NodeStatusBadge.js';
import { NodeContextMenu } from '../NodeContextMenu.js';
import { CanvasNodeTooltip } from '../CanvasNodeTooltip.js';
import { useAssetUrl } from '../../../hooks/useAssetUrl.js';
import type { NodeStatus } from '@lucid-fin/contracts';

export interface VideoNodeFlowData {
  nodeId: string;
  title: string;
  status: NodeStatus;
  bypassed: boolean;
  locked: boolean;
  colorTag?: string;
  assetHash?: string;
  generationStatus: 'empty' | 'generating' | 'done' | 'failed';
  duration?: number;
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
  onSelectVariant?: (id: string, index: number) => void;
  onToggleSeedLock?: (id: string) => void;
  firstFrameHash?: string;
  lastFrameHash?: string;
}

function VideoNodeComponent({ data, selected }: NodeProps) {
  const d = data as unknown as VideoNodeFlowData;
  const activeHash = d.assetHash ?? d.variants[d.selectedVariantIndex];
  const hasVideo = Boolean(activeHash);
  const isGenerating = d.generationStatus === 'generating';
  const { url: activeUrl } = useAssetUrl(activeHash, 'video', 'mp4');
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);

  const togglePlay = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    const vid = videoRef.current;
    if (!vid) return;
    if (vid.paused) { void vid.play(); setPlaying(true); }
    else { vid.pause(); setPlaying(false); }
  }, []);

  const handleScrub = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const vid = videoRef.current;
    if (!vid || !vid.duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    vid.currentTime = ratio * vid.duration;
  }, []);

  return (
    <NodeContextMenu
      nodeId={d.nodeId}
      nodeType="video"
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
        title={d.title || t('node.videoNode')}
        subtitle={t('node.video')}
        items={[
          { label: t('node.status'), value: d.generationStatus },
          { label: t('node.variants'), value: d.variants.length || d.variantCount || 0 },
          { label: t('node.seed'), value: d.seed ?? '-' },
          { label: t('node.cost'), value: typeof d.estimatedCost === 'number' ? `$${d.estimatedCost.toFixed(2)}` : '-' },
        ]}
      >
        <div
          className={cn(
            'relative rounded-lg border-2 bg-card shadow-md min-w-[200px]',
            'transition-shadow',
            selected ? 'border-purple-400 ring-[3px] ring-purple-400/50' : 'border-purple-500/40',
            d.bypassed && 'opacity-40',
          )}
          style={d.colorTag ? { boxShadow: `0 0 0 2px ${d.colorTag}` } : undefined}
        >
          <NodeResizer
            minWidth={200}
            minHeight={140}
            isVisible={selected}
            lineClassName="!border-purple-400/60"
            handleClassName="!h-2.5 !w-2.5 !border-background !bg-purple-400"
          />
          <NodeStatusBadge status={d.status} />
          {d.generationStatus === 'generating' && (
            <div className="pointer-events-none absolute inset-0 z-10 animate-pulse rounded-lg border-2 border-purple-500 bg-purple-500/5" />
          )}

          <div className="flex items-center gap-1.5 border-b border-purple-500/20 px-3 py-2">
            <Video className="h-3.5 w-3.5 shrink-0 text-purple-400" />
            <span className="flex-1 truncate text-xs font-medium">
              {d.title || t('node.videoNode')}
            </span>
            {d.duration != null && (
              <span className="rounded bg-purple-500/10 px-1.5 text-[10px] text-purple-400">
                {d.duration.toFixed(1)}s
              </span>
            )}
          </div>

          <div className="flex min-h-[80px] max-h-[240px] items-center justify-center px-3 py-3 overflow-hidden">
            {hasVideo ? (
              <div
                className="relative flex aspect-video max-w-full max-h-full items-center justify-center overflow-hidden rounded bg-muted"
                onMouseMove={handleScrub}
              >
                {activeUrl ? (
                  <video
                    ref={videoRef}
                    src={activeUrl}
                    className="max-w-full max-h-full object-contain"
                    muted
                    preload="metadata"
                    onEnded={() => setPlaying(false)}
                  />
                ) : (
                  <span className="text-xs text-muted-foreground">{t('node.loading')}</span>
                )}
                <button
                  className="absolute inset-0 flex items-center justify-center rounded bg-black/30 opacity-0 transition-opacity hover:opacity-100"
                  aria-label={playing ? t('node.pause') : t('node.play')}
                  onClick={togglePlay}
                  onContextMenu={(e) => e.preventDefault()}
                >
                  {playing
                    ? <Pause className="h-8 w-8 text-white" fill="white" />
                    : <Play className="h-8 w-8 text-white" fill="white" />}
                </button>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-1 text-muted-foreground">
                <Video className="h-8 w-8 opacity-30" />
                <span className="text-[10px]">{t('node.noVideoGenerated')}</span>
              </div>
            )}
          </div>

          {d.generationStatus === 'generating' && typeof d.progress === 'number' && (
            <div className="px-3 pb-1">
              <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
                <div className="h-full bg-purple-500 transition-all" style={{ width: `${d.progress}%` }} />
              </div>
              <span className="text-[10px] text-muted-foreground">{d.progress}%</span>
            </div>
          )}

          {d.generationStatus === 'failed' && d.error && (
            <div className="px-3 pb-1">
              <span className="block truncate text-[10px] text-destructive">{d.error}</span>
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
                    onClick={() => d.onSelectVariant?.(d.nodeId, index)}
                  />
                ))}
              </div>
            </div>
          )}

          {(d.firstFrameHash || d.lastFrameHash) && (
            <FrameRow firstHash={d.firstFrameHash} lastHash={d.lastFrameHash} />
          )}

          <div className="flex items-center gap-1 border-t border-purple-500/20 px-3 py-1.5">
            <button
              className="flex items-center gap-1 rounded bg-purple-500/10 px-2 py-0.5 text-[10px] text-purple-400 transition-colors hover:bg-purple-500/20"
              aria-label={t('node.generate')}
              onClick={() => d.onGenerate?.(d.nodeId)}
              onContextMenu={(e) => e.preventDefault()}
              disabled={isGenerating}
            >
              <Sparkles className="h-3 w-3" />
              {t('node.generate')}
            </button>
            {hasVideo && (
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
                className="text-purple-400 hover:text-purple-300"
                onClick={() => d.onToggleSeedLock?.(d.nodeId)}
                onContextMenu={(e) => e.preventDefault()}
                aria-label={d.seedLocked ? 'Unlock seed' : 'Lock seed'}
              >
                {d.seedLocked ? <Lock className="h-3 w-3" /> : <Unlock className="h-3 w-3" />}
              </button>
            </span>
          </div>
          {d.presetSummary && (
            <div className="truncate border-t border-purple-500/10 px-3 pb-1.5 text-[10px] text-muted-foreground">
              {d.presetSummary}
            </div>
          )}

          <Handle
            type="source"
            position={Position.Top}
            id="top"
            className="!h-2.5 !w-2.5 !border-2 !border-background !bg-purple-500"
          />
          <Handle
            type="source"
            position={Position.Right}
            id="right"
            className="!h-2.5 !w-2.5 !border-2 !border-background !bg-purple-500"
          />
          <Handle
            type="source"
            position={Position.Bottom}
            id="bottom"
            className="!h-2.5 !w-2.5 !border-2 !border-background !bg-purple-500"
          />
          <Handle
            type="source"
            position={Position.Left}
            id="left"
            className="!h-2.5 !w-2.5 !border-2 !border-background !bg-purple-500"
          />
        </div>
      </CanvasNodeTooltip>
    </NodeContextMenu>
  );
}

function FrameThumb({ hash, label }: { hash: string | undefined; label: string }) {
  const { url } = useAssetUrl(hash, 'image', 'jpg');
  if (!hash) return null;
  return (
    <div className="flex flex-col items-center gap-0.5">
      <div className="h-8 w-12 overflow-hidden rounded border border-purple-500/30 bg-muted">
        {url ? (
          <img
            src={url}
            alt={label}
            className="h-full w-full object-cover"
            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-[8px] text-muted-foreground">…</div>
        )}
      </div>
      <span className="text-[9px] text-muted-foreground">{label}</span>
    </div>
  );
}

function FrameRow({ firstHash, lastHash }: { firstHash?: string; lastHash?: string }) {
  return (
    <div className="flex items-center justify-between border-t border-purple-500/10 px-3 py-1.5">
      <FrameThumb hash={firstHash} label="First" />
      {firstHash && lastHash && <div className="h-px flex-1 mx-2 bg-purple-500/20" />}
      <FrameThumb hash={lastHash} label="Last" />
    </div>
  );
}

function VariantThumb({
  hash,
  index,
  selected,
  onClick,
}: {
  hash: string;
  index: number;
  selected: boolean;
  onClick: () => void;
}) {
  const { url } = useAssetUrl(hash, 'video', 'mp4');
  return (
    <button
      className={cn(
        'h-10 w-10 shrink-0 overflow-hidden rounded border-2',
        selected ? 'border-purple-500 ring-1 ring-purple-500/40' : 'border-transparent hover:border-purple-400/50',
      )}
      onClick={onClick}
      onContextMenu={(e) => e.preventDefault()}
      aria-label={`Select variant ${index + 1}`}
    >
      {url ? (
        <video src={url} className="h-full w-full object-cover" muted preload="metadata" />
      ) : (
        <span className="flex h-full w-full items-center justify-center bg-muted text-[9px] text-muted-foreground">
          V{index + 1}
        </span>
      )}
    </button>
  );
}

export const VideoNode = memo(VideoNodeComponent);
