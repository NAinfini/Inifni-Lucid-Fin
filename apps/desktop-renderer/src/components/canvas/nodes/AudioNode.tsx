import { memo } from 'react';
import { Handle, Position, NodeResizer, type NodeProps } from '@xyflow/react';
import { cn } from '../../../lib/utils.js';
import { t } from '../../../i18n.js';
import { Volume2, Sparkles, Lock, Unlock } from 'lucide-react';
import { NodeStatusBadge } from '../NodeStatusBadge.js';
import { NodeContextMenu } from '../NodeContextMenu.js';
import { CanvasNodeTooltip } from '../CanvasNodeTooltip.js';
import { WaveformPlayer } from '../../audio/WaveformPlayer.js';
import { useAssetUrl } from '../../../hooks/useAssetUrl.js';
import type { NodeStatus } from '@lucid-fin/contracts';

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
}

const AUDIO_TYPE_LABELS: Record<string, string> = {
  voice: 'Voice',
  music: 'Music',
  sfx: 'SFX',
};

function AudioNodeComponent({ data, selected }: NodeProps) {
  const d = data as unknown as AudioNodeFlowData;
  const activeHash = d.assetHash ?? d.variants[d.selectedVariantIndex];
  const { url: activeUrl } = useAssetUrl(activeHash, 'audio', 'mp3');

  const isGenerating = d.generationStatus === 'generating';

  return (
    <NodeContextMenu
      nodeId={d.nodeId}
      nodeType="audio"
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
        title={d.title || t('node.audioNode')}
        subtitle={AUDIO_TYPE_LABELS[d.audioType] ?? d.audioType}
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
            selected ? 'border-green-400 ring-[3px] ring-green-400/50' : 'border-green-500/40',
            d.bypassed && 'opacity-40',
          )}
          style={d.colorTag ? { boxShadow: `0 0 0 2px ${d.colorTag}` } : undefined}
        >
          <NodeResizer
            minWidth={200}
            minHeight={120}
            isVisible={selected}
            lineClassName="!border-green-400/60"
            handleClassName="!h-2.5 !w-2.5 !border-background !bg-green-400"
          />
          <NodeStatusBadge status={d.status} />
          {typeof d.estimatedCost === 'number' && (
            <div className="absolute right-1 top-1 z-20 rounded bg-green-500/10 px-1.5 py-0.5 text-[10px] font-medium text-green-300">
              ${d.estimatedCost.toFixed(2)}
            </div>
          )}

          {isGenerating && (
            <div className="pointer-events-none absolute inset-0 z-10 animate-pulse rounded-lg border-2 border-green-500 bg-green-500/5" />
          )}

          <div className="flex items-center gap-1.5 border-b border-green-500/20 px-3 py-2">
            <Volume2 className="h-3.5 w-3.5 shrink-0 text-green-400" />
            <span className="flex-1 truncate text-xs font-medium">
              {d.title || t('node.audioNode')}
            </span>
            <span className="rounded bg-green-500/10 px-1.5 text-[10px] text-green-400">
              {AUDIO_TYPE_LABELS[d.audioType] ?? d.audioType}
            </span>
          </div>

          <div className="flex min-h-[50px] items-center justify-center px-3 py-3">
            {activeUrl ? (
              <WaveformPlayer
                audioUrl={activeUrl}
                height={32}
                waveColor="hsl(142 71% 45% / 0.6)"
                progressColor="hsl(142 71% 45%)"
              />
            ) : activeHash ? (
              <div className="flex h-8 w-full items-center justify-center rounded bg-green-500/10 text-xs text-muted-foreground">
                {t('node.loading')}
              </div>
            ) : (
              <div className="flex flex-col items-center gap-1 text-muted-foreground">
                <Volume2 className="h-6 w-6 opacity-30" />
                <span className="text-[10px]">{t('node.noAudio')}</span>
              </div>
            )}
          </div>

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
                <div className="h-full bg-green-500 transition-all" style={{ width: `${d.progress}%` }} />
              </div>
              <span className="text-[10px] text-muted-foreground">{d.progress}%</span>
            </div>
          )}

          {d.variants.length > 1 && (
            <div className="overflow-x-auto px-3 pb-2">
              <div className="flex min-w-max items-center gap-1">
                {d.variants.slice(0, 9).map((hash, index) => (
                  <button
                    key={hash}
                    className={cn(
                      'h-7 shrink-0 rounded border-2 px-2 text-[9px]',
                      d.selectedVariantIndex === index
                        ? 'border-green-500 bg-green-500/20 text-green-300 ring-1 ring-green-500/40'
                        : 'border-transparent bg-muted text-muted-foreground hover:border-green-400/50',
                    )}
                    onClick={() => d.onSelectVariant?.(d.nodeId, index)}
                    onContextMenu={(e) => e.preventDefault()}
                    aria-label={`Select variant ${index + 1}`}
                  >
                    V{index + 1}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="flex items-center gap-1 border-t border-green-500/20 px-3 py-1.5">
            <button
              className="flex items-center gap-1 rounded bg-green-500/10 px-2 py-0.5 text-[10px] text-green-400 transition-colors hover:bg-green-500/20"
              aria-label={t('node.generate')}
              onClick={() => d.onGenerate?.(d.nodeId)}
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
                onClick={() => d.onToggleSeedLock?.(d.nodeId)}
                onContextMenu={(e) => e.preventDefault()}
                aria-label={d.seedLocked ? 'Unlock seed' : 'Lock seed'}
              >
                {d.seedLocked ? <Lock className="h-3 w-3" /> : <Unlock className="h-3 w-3" />}
              </button>
            </span>
          </div>

          <Handle
            type="source"
            position={Position.Top}
            id="top"
            className="!h-2.5 !w-2.5 !border-2 !border-background !bg-green-500"
          />
          <Handle
            type="source"
            position={Position.Right}
            id="right"
            className="!h-2.5 !w-2.5 !border-2 !border-background !bg-green-500"
          />
          <Handle
            type="source"
            position={Position.Bottom}
            id="bottom"
            className="!h-2.5 !w-2.5 !border-2 !border-background !bg-green-500"
          />
          <Handle
            type="source"
            position={Position.Left}
            id="left"
            className="!h-2.5 !w-2.5 !border-2 !border-background !bg-green-500"
          />
        </div>
      </CanvasNodeTooltip>
    </NodeContextMenu>
  );
}

export const AudioNode = memo(AudioNodeComponent);
