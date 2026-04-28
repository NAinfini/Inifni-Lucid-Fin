import { memo } from 'react';
import type { NodeProps } from '@xyflow/react';
import { getProviderDisplayName } from '../../../utils/provider-names.js';
import { t, getLocale } from '../../../i18n.js';
import { Volume2, Sparkles, Lock, Unlock } from 'lucide-react';
import { NodeStatusBadge } from '../NodeStatusBadge.js';
import { NodeContextMenu } from '../NodeContextMenu.js';
import { WaveformPlayer } from '../../audio/WaveformPlayer.js';
import { useAssetUrl } from '../../../hooks/useAssetUrl.js';
import { useNodeVisibility } from '../../../hooks/useNodeVisibility.js';
import { cn } from '../../../lib/utils.js';
import type { NodeStatus } from '@lucid-fin/contracts';
import { NodeBorderHandles } from './node-border-handles.js';
import { NodeResizeControls } from './node-resize-controls.js';
import { useNodeCallbacks } from '../node-callbacks-context.js';
import { useCanvasLodFromContext } from '../use-canvas-lod.js';

export interface AudioNodeFlowData {
  nodeId: string;
  title: string;
  status: NodeStatus;
  bypassed: boolean;
  locked: boolean;
  colorTag?: string;
  assetHash?: string;
  audioType: 'voice' | 'music' | 'sfx';
  duration?: number;
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
}

const AUDIO_TYPE_LABELS: Record<string, string> = {
  voice: 'Voice',
  music: 'Music',
  sfx: 'SFX',
};

function AudioNodeComponent({ data, selected }: NodeProps) {
  const d = data as unknown as AudioNodeFlowData;
  const cb = useNodeCallbacks();
  const lod = useCanvasLodFromContext();
  const activeHash = d.assetHash ?? d.variants[d.selectedVariantIndex];
  const { url: activeUrl } = useAssetUrl(lod !== 'minimal' ? activeHash : undefined, 'audio', 'mp3');
  const { ref: visibilityRef, isVisible } = useNodeVisibility<HTMLDivElement>();

  const isGenerating = d.generationStatus === 'generating';

  return (
    <NodeContextMenu
      nodeId={d.nodeId}
      nodeType="audio"
      locked={d.locked}
      colorTag={d.colorTag}
    >
      <div ref={visibilityRef} className="relative min-w-[200px]">
        <NodeBorderHandles colorClassName="!bg-green-500" />
        {lod === 'full' && (
          <NodeResizeControls
            minWidth={200}
            minHeight={120}
            isVisible={selected}
            className="!h-2.5 !w-2.5 !border-background !bg-green-400"
          />
        )}
        <div
          className={cn(
            'relative rounded-md border bg-card shadow-sm min-w-[200px]',
            'transition-shadow',
            selected ? 'border-green-400 ring-2 ring-green-400/40' : 'border-green-500/30',
            d.bypassed && 'opacity-40',
          )}
          style={d.colorTag ? { boxShadow: `0 0 0 2px ${d.colorTag}` } : undefined}
        >
          <NodeStatusBadge status={d.status} />
          {typeof d.estimatedCost === 'number' && (
            <div className="absolute right-1 top-1 z-20 rounded bg-green-500/10 px-1.5 py-0.5 text-[10px] font-medium text-green-300">
              {new Intl.NumberFormat(getLocale(), { style: 'currency', currency: 'USD', minimumFractionDigits: 2 }).format(d.estimatedCost)}
            </div>
          )}

          <div className="flex items-center gap-1.5 border-b border-green-500/20 px-3 py-2">
            <Volume2 className="h-3.5 w-3.5 shrink-0 text-green-400" />
            <span className="flex-1 truncate text-xs font-medium">
              {d.title || t('node.audioNode')}
            </span>
            {lod === 'full' && d.providerId && <span className="text-[9px] text-muted-foreground/70">{getProviderDisplayName(d.providerId)}</span>}
            <span className="rounded bg-green-500/10 px-1.5 text-[10px] text-green-400">
              {AUDIO_TYPE_LABELS[d.audioType] ?? d.audioType}
            </span>
          </div>

          {/* LOD: minimal = green-tinted placeholder only, no media content */}
          {lod === 'minimal' ? (
            <div className="flex min-h-[50px] items-center justify-center bg-green-500/5">
              <Volume2 className="h-6 w-6 text-green-400/30" />
            </div>
          ) : (
            <>
              {isGenerating && (
                <div className="pointer-events-none absolute inset-0 z-10 animate-pulse rounded-lg border-2 border-green-500 bg-green-500/5" />
              )}

              <div className="flex min-h-[50px] items-center justify-center px-3 py-3">
                {activeUrl && isVisible ? (
                  <WaveformPlayer
                    audioUrl={activeUrl}
                    height={32}
                    waveColor="hsl(142 71% 45% / 0.6)"
                    progressColor="hsl(142 71% 45%)"
                  />
                ) : activeUrl || activeHash ? (
                  <div className="flex h-8 w-full items-center justify-center rounded bg-green-500/10 text-xs text-muted-foreground">
                    {isVisible ? t('node.loading') : <Volume2 className="h-4 w-4 text-green-400/40" />}
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-1 text-muted-foreground">
                    <Volume2 className="h-6 w-6 opacity-30" />
                    <span className="text-[10px]">{t('node.noAudio')}</span>
                  </div>
                )}
              </div>

              {/* LOD: medium skips duration, progress, variants, seed/generate buttons */}
              {lod === 'full' && (
                <>
                  {d.duration != null && (
                    <div className="px-3 pb-1 text-[10px] text-muted-foreground">{t('node.duration')}: {d.duration.toFixed(1)}s</div>
                  )}

                  {d.generationStatus === 'failed' && d.error && (
                    <div className="px-3 pb-1">
                      <span className="block truncate text-[10px] text-destructive">{d.error}</span>
                    </div>
                  )}

                  {isGenerating && typeof d.progress === 'number' && (
                    <div className="px-3 pb-1">
                      <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
                        <div className="h-full bg-green-500 transition-[width] duration-200" style={{ width: `${d.progress}%` }} />
                      </div>
                      <span className="text-[10px] text-muted-foreground">{d.progress}%</span>
                    </div>
                  )}

                  {d.variants.length > 1 && (
                    <div className="border-t border-green-500/10 px-3 py-1.5">
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
                              onClick={() => cb.onSelectVariant(d.nodeId, index)}
                            />
                          ))}
                        </div>
                      </div>
                    </div>
                  )}

                  <div className="flex items-center gap-1 border-t border-green-500/20 px-3 py-1.5 nopan nodrag">
                    <button
                      className="flex items-center gap-1 rounded bg-green-500/10 px-2 py-0.5 text-[10px] text-green-400 transition-colors hover:bg-green-500/20"
                      aria-label={t('node.generate')}
                      onClick={() => cb.onGenerate(d.nodeId)}
                      onContextMenu={(e) => e.preventDefault()}
                      disabled={isGenerating}
                    >
                      <Sparkles className="h-3 w-3" />
                      {t('node.generate')}
                    </button>
                    <span className="ml-auto inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                      {t('node.seed')} {typeof d.seed === 'number' ? d.seed : '-'}
                      <button
                        className="text-green-400 hover:text-green-300"
                        onClick={() => cb.onToggleSeedLock(d.nodeId)}
                        onContextMenu={(e) => e.preventDefault()}
                        aria-label={d.seedLocked ? 'Unlock seed' : 'Lock seed'}
                      >
                        {d.seedLocked ? <Lock className="h-3 w-3" /> : <Unlock className="h-3 w-3" />}
                      </button>
                    </span>
                  </div>
                </>
              )}
            </>
          )}

        </div>
      </div>
    </NodeContextMenu>
  );
}

const VariantThumb = memo(function VariantThumb({
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
  const { url } = useAssetUrl(hash, 'audio', 'mp3');

  return (
    <button
      className={cn(
        'relative h-10 w-10 shrink-0 overflow-hidden rounded border-2 bg-muted/70',
        selected ? 'border-green-500 ring-1 ring-green-500/40' : 'border-transparent hover:border-green-400/50',
      )}
      onClick={onClick}
      onContextMenu={(e) => e.preventDefault()}
      aria-label={`Select variant ${index + 1}`}
    >
      {url ? (
        <div className="flex h-full w-full items-center justify-center bg-green-500/10">
          <Volume2 className="h-4 w-4 text-green-300" />
        </div>
      ) : (
        <span className="flex h-full w-full items-center justify-center bg-muted text-[9px] text-muted-foreground">
          V{index + 1}
        </span>
      )}
      <span className="pointer-events-none absolute bottom-0.5 right-0.5 rounded bg-background/85 px-1 py-0.5 text-[8px] font-semibold uppercase leading-none text-foreground shadow-sm">
        v{index + 1}
      </span>
    </button>
  );
});

export const AudioNode = memo(AudioNodeComponent);
