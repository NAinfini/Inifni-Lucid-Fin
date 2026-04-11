import { memo, useCallback, useEffect, useRef, useState } from 'react';
import type { NodeProps } from '@xyflow/react';
import { getProviderDisplayName } from '../../../utils/provider-names.js';
import { t } from '../../../i18n.js';
import { Video, Loader2, Sparkles, RefreshCw, Play, Lock, Unlock } from 'lucide-react';
import { NodeStatusBadge } from '../NodeStatusBadge.js';
import { NodeContextMenu } from '../NodeContextMenu.js';
import { useAssetUrl } from '../../../hooks/useAssetUrl.js';
import { cn } from '../../../lib/utils.js';
import type { NodeStatus } from '@lucid-fin/contracts';
import { NodeBorderHandles } from './node-border-handles.js';
import { NodeResizeControls } from './node-resize-controls.js';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '../../ui/Dialog.js';

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

/* ------------------------------------------------------------------ */
/*  Video Player Modal                                                 */
/* ------------------------------------------------------------------ */

function VideoPlayerModal({
  open,
  onOpenChange,
  videoUrl,
  title,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  videoUrl: string | null;
  title: string;
}) {
  const modalVideoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (open && modalVideoRef.current && videoUrl) {
      modalVideoRef.current.currentTime = 0;
      void modalVideoRef.current.play();
    }
  }, [open, videoUrl]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl w-[90vw] p-0 gap-0 overflow-hidden bg-black border-purple-500/30">
        <div className="flex items-center justify-between px-4 py-3 bg-card border-b border-purple-500/20">
          <DialogTitle className="text-sm font-medium truncate">
            {title || t('node.video')}
          </DialogTitle>
          <DialogDescription className="sr-only">
            {t('node.video')}
          </DialogDescription>
        </div>
        <div className="relative w-full min-h-[300px] bg-black flex items-center justify-center">
          {videoUrl ? (
            <video
              ref={modalVideoRef}
              src={videoUrl}
              className="w-full max-h-[75vh] object-contain"
              controls
              autoPlay
              preload="auto"
            />
          ) : (
            <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
              {t('node.loading')}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/*  Video Node                                                         */
/* ------------------------------------------------------------------ */

function VideoNodeComponent({ data, selected }: NodeProps) {
  const d = data as unknown as VideoNodeFlowData;
  const activeHash = d.assetHash ?? d.variants[d.selectedVariantIndex];
  const hasVideo = Boolean(activeHash);
  const isGenerating = d.generationStatus === 'generating';

  const { url: videoUrl } = useAssetUrl(activeHash, 'video', 'mp4');

  const previewRef = useRef<HTMLVideoElement>(null);
  const [hovering, setHovering] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);

  const handleMouseEnter = useCallback(() => {
    if (modalOpen) return;
    setHovering(true);
    const vid = previewRef.current;
    if (vid && videoUrl) {
      vid.currentTime = 0;
      void vid.play();
    }
  }, [modalOpen, videoUrl]);

  const handleMouseLeave = useCallback(() => {
    setHovering(false);
    const vid = previewRef.current;
    if (vid) {
      vid.pause();
      vid.currentTime = 0;
    }
  }, []);

  const handleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setHovering(false);
    const vid = previewRef.current;
    if (vid) {
      vid.pause();
      vid.currentTime = 0;
    }
    setModalOpen(true);
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
      <div className="relative h-full min-h-[140px] min-w-[200px] w-full">
        <NodeBorderHandles colorClassName="!bg-purple-500" />
        <NodeResizeControls
          minWidth={200}
          minHeight={140}
          isVisible={selected}
          className="!h-2.5 !w-2.5 !border-background !bg-purple-400"
        />
        <div
          className={cn(
            'relative flex h-full min-h-[140px] min-w-[200px] w-full flex-col overflow-hidden rounded-md border bg-card shadow-sm',
            'transition-shadow',
            selected ? 'border-purple-400 ring-2 ring-purple-400/40' : 'border-purple-500/30',
            d.bypassed && 'opacity-40',
          )}
          style={d.colorTag ? { boxShadow: `0 0 0 2px ${d.colorTag}` } : undefined}
        >
          <NodeStatusBadge status={d.status} />
          {d.generationStatus === 'generating' && (
            <div className="pointer-events-none absolute inset-0 z-10 rounded-lg border-2 border-purple-500 bg-purple-500/5" style={{
              animation: 'border-glow-purple 2s ease-in-out infinite',
            }} />
          )}

          <div className="flex items-center gap-1.5 border-b border-purple-500/20 px-3 py-2">
            <Video className="h-3.5 w-3.5 shrink-0 text-purple-400" />
            <span className="flex-1 truncate text-xs font-medium">
              {d.title || t('node.videoNode')}
            </span>
            {d.providerId && <span className="text-[9px] text-muted-foreground/70">{getProviderDisplayName(d.providerId)}</span>}
            {d.duration != null && (
              <span className="rounded bg-purple-500/10 px-1.5 text-[10px] text-purple-400">
                {d.duration.toFixed(1)}s
              </span>
            )}
          </div>

          {/* --- Media viewport --- */}
          <div
            data-testid="video-media-viewport"
            className="flex min-h-[80px] min-w-0 flex-1 items-center justify-center overflow-hidden px-3 py-3"
            draggable={hasVideo && Boolean(activeHash)}
            onDragStart={hasVideo && activeHash ? (e) => {
              e.dataTransfer.setData(
                'application/x-lucid-node-asset',
                JSON.stringify({ hash: activeHash, name: d.title || 'video', type: 'video' }),
              );
              e.dataTransfer.effectAllowed = 'copy';
            } : undefined}
          >
            {hasVideo ? (
              <div
                className="relative flex h-full w-full items-center justify-center overflow-hidden rounded bg-muted cursor-pointer"
                onMouseEnter={handleMouseEnter}
                onMouseLeave={handleMouseLeave}
                onClick={handleClick}
              >
                {/* Video element: paused at frame 0 when idle, plays on hover */}
                {videoUrl ? (
                  <video
                    data-testid="video-media-element"
                    ref={previewRef}
                    src={videoUrl}
                    className="h-full w-full object-contain"
                    muted
                    loop
                    playsInline
                    preload="metadata"
                  />
                ) : (
                  <span className="text-xs text-muted-foreground">{t('node.loading')}</span>
                )}

                {/* Play badge — visible when NOT hovering */}
                {!hovering && (
                  <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-black/50 backdrop-blur-sm">
                      <Play className="h-5 w-5 text-white" fill="white" />
                    </div>
                  </div>
                )}
              </div>
            ) : isGenerating ? (
              <div className="flex flex-col items-center gap-1.5 text-purple-400">
                <Loader2 className="h-6 w-6 animate-spin" />
                <span className="text-[10px]">{t('node.generating')}</span>
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
            <div className="px-3 pb-1 overflow-hidden">
              <span className="block text-[10px] text-destructive line-clamp-2">{d.error}</span>
            </div>
          )}

          {(d.firstFrameHash || d.lastFrameHash) && (
            <FrameRow firstHash={d.firstFrameHash} lastHash={d.lastFrameHash} />
          )}

          {d.variants.length > 1 && (
            <div className="border-t border-purple-500/10 px-3 py-1.5">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[9px] text-muted-foreground">{d.selectedVariantIndex + 1}/{d.variants.length}</span>
              </div>
              <div className="overflow-x-auto">
                <div className="flex min-w-max items-center gap-1">
                  {d.variants.map((hash, index) => (
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
            </div>
          )}

          <div className="flex items-center gap-1 border-t border-purple-500/20 px-3 py-1.5 nopan nodrag">
            {hasVideo ? (
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
            ) : (
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
        </div>

        {/* Video player modal */}
        {hasVideo && (
          <VideoPlayerModal
            open={modalOpen}
            onOpenChange={setModalOpen}
            videoUrl={videoUrl}
            title={d.title || t('node.videoNode')}
          />
        )}
      </div>
    </NodeContextMenu>
  );
}

/* ------------------------------------------------------------------ */
/*  Supporting components                                              */
/* ------------------------------------------------------------------ */

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
