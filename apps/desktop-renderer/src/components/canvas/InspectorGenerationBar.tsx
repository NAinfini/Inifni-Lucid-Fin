import { useState, type ChangeEventHandler, type ReactNode } from 'react';
import { ChevronDown, ChevronUp, Dice5, Loader2, Lock, Trash2, Unlock, Upload } from 'lucide-react';
import { cn } from '../../lib/utils.js';

type Translate = (key: string) => string;

interface ProviderOption {
  id: string;
  name: string;
}

interface SelectOption {
  value: string;
  label: string;
}

interface ResolutionGroupOption {
  label: string;
  options: SelectOption[];
}

export interface InspectorGenerationBarProps {
  t: Translate;
  providerOptions: ProviderOption[];
  activeProviderId?: string;
  providerLoading: boolean;
  onProviderChange: ChangeEventHandler<HTMLSelectElement>;
  variantOptions: readonly number[];
  activeVariantCount: number;
  onVariantCountChange: (count: number) => void;
  isGenerating: boolean;
  hasVariants: boolean;
  estimatedCost?: string;
  onGenerate: () => void | Promise<void>;
  onCancel: () => void | Promise<void>;
  // Seed
  seedValue?: number;
  seedLocked?: boolean;
  onSeedChange?: ChangeEventHandler<HTMLInputElement>;
  onRandomizeSeed?: () => void;
  onToggleSeedLock?: () => void;
  // Resolution
  nodeType?: string;
  resolutionGroups?: ResolutionGroupOption[];
  resolutionValue?: string | null;
  customResolutionValue?: string;
  widthValue?: number;
  heightValue?: number;
  onResolutionChange?: ChangeEventHandler<HTMLSelectElement>;
  onWidthChange?: ChangeEventHandler<HTMLInputElement>;
  onHeightChange?: ChangeEventHandler<HTMLInputElement>;
  // Duration / FPS (video)
  durationOptions?: readonly number[];
  durationValue?: string | null;
  onDurationChange?: ChangeEventHandler<HTMLSelectElement>;
  durationInputValue?: number;
  onDurationInputChange?: ChangeEventHandler<HTMLInputElement>;
  fpsOptions?: readonly number[];
  fpsValue?: number;
  onFpsChange?: ChangeEventHandler<HTMLSelectElement>;
  // Audio toggle (all video providers)
  showAudioToggle?: boolean;
  audioEnabled?: boolean;
  onAudioChange?: (enabled: boolean) => void;
  audioLabel?: string;
  audioWarning?: string;
  // Lip sync toggle (video nodes)
  showLipSyncToggle?: boolean;
  lipSyncEnabled?: boolean;
  onLipSyncChange?: (enabled: boolean) => void;
  lipSyncLabel?: string;
  // Quality selector (all video providers)
  showQualitySelector?: boolean;
  qualityOptions?: Array<{ value: string; label: string }>;
  qualityValue?: string;
  onQualityChange?: ChangeEventHandler<HTMLSelectElement>;
  qualityLabel?: string;
  // Variant gallery
  variantGrid?: ReactNode;
  variantLabel?: string;
  // Upload
  uploadHasAsset?: boolean;
  onUpload?: () => void | Promise<void>;
  onClear?: () => void;
  /** Warning message shown when no provider has an API key configured */
  noKeyWarning?: string;
  onNoKeyAction?: () => void;
  noKeyActionLabel?: string;
}

export function InspectorGenerationBar({
  t,
  providerOptions,
  activeProviderId,
  providerLoading,
  onProviderChange,
  variantOptions,
  activeVariantCount,
  onVariantCountChange,
  isGenerating,
  hasVariants,
  estimatedCost,
  onGenerate,
  onCancel,
  seedValue,
  seedLocked,
  onSeedChange,
  onRandomizeSeed,
  onToggleSeedLock,
  nodeType,
  resolutionGroups,
  resolutionValue,
  customResolutionValue,
  widthValue,
  heightValue,
  onResolutionChange,
  onWidthChange,
  onHeightChange,
  durationOptions,
  durationValue,
  onDurationChange,
  durationInputValue,
  onDurationInputChange,
  fpsOptions,
  fpsValue,
  onFpsChange,
  showAudioToggle,
  audioEnabled,
  onAudioChange,
  audioLabel,
  audioWarning,
  showLipSyncToggle,
  lipSyncEnabled,
  onLipSyncChange,
  lipSyncLabel,
  showQualitySelector,
  qualityOptions,
  qualityValue,
  onQualityChange,
  qualityLabel,
  variantGrid,
  variantLabel,
  uploadHasAsset,
  onUpload,
  onClear,
  noKeyWarning,
  onNoKeyAction,
  noKeyActionLabel,
}: InspectorGenerationBarProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="shrink-0 border-t border-border/60 bg-card">
      {/* No-key warning banner */}
      {noKeyWarning && (
        <div className="flex items-center gap-1.5 bg-amber-500/10 px-3 py-1.5 text-[10px] text-amber-400">
          <span className="flex-1">{noKeyWarning}</span>
          {onNoKeyAction && noKeyActionLabel && (
            <button
              type="button"
              onClick={onNoKeyAction}
              className="shrink-0 rounded px-1.5 py-0.5 font-medium text-amber-300 hover:bg-amber-500/20"
            >
              {noKeyActionLabel}
            </button>
          )}
        </div>
      )}
      {/* Collapsed: provider + generate in one row */}
      <div className="flex items-center gap-1.5 px-3 py-1.5">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="shrink-0 p-0.5 text-muted-foreground hover:text-foreground"
          title={expanded ? 'Collapse' : 'Expand'}
        >
          {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronUp className="h-3 w-3" />}
        </button>
        <select
          className="flex-1 min-w-0 truncate rounded-md border border-border/60 bg-muted px-1.5 py-1 text-[11px] outline-none focus:ring-1 focus:ring-ring"
          value={activeProviderId ?? ''}
          onChange={onProviderChange}
          disabled={providerLoading}
        >
          {providerLoading && <option value="">{t('generation.loadingProviders') || '...'}</option>}
          {providerOptions.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
        <button
          type="button"
          className="flex items-center justify-center gap-1 rounded-md bg-primary px-3 py-1 text-[11px] font-medium text-primary-foreground disabled:opacity-50"
          onClick={() => void onGenerate()}
          disabled={isGenerating}
        >
          {isGenerating && <Loader2 className="h-3 w-3 animate-spin" />}
          {hasVariants ? t('generation.regenerate') : t('generation.generate')}
        </button>
        {!expanded && estimatedCost && !isGenerating && (
          <span className="text-[9px] text-muted-foreground whitespace-nowrap">{estimatedCost}</span>
        )}
        {isGenerating && (
          <button
            type="button"
            className="rounded-md border border-border/60 px-2 py-1 text-[11px] text-muted-foreground hover:bg-muted"
            onClick={() => void onCancel()}
          >
            {t('generation.cancel')}
          </button>
        )}
      </div>

      {/* Expanded: all generation settings */}
      {expanded && (
        <div className="space-y-1.5 border-t border-border/40 px-3 py-1.5">
          {/* Variants */}
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-muted-foreground">{t('generation.variantCount')}</span>
            <div className="flex items-center rounded-md border border-border/60 overflow-hidden">
              {variantOptions.map((count) => (
                <button
                  key={count}
                  type="button"
                  onClick={() => onVariantCountChange(count)}
                  className={cn(
                    'px-2 py-0.5 text-[10px] font-medium transition-colors',
                    activeVariantCount === count
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:bg-muted',
                  )}
                >
                  {count}
                </button>
              ))}
            </div>
          </div>

          {/* Resolution */}
          {resolutionGroups && onResolutionChange && (
            <div className="flex items-center justify-between gap-1.5">
              <span className="text-[10px] text-muted-foreground">{t('export.resolution')}</span>
              <select
                value={resolutionValue ?? customResolutionValue ?? ''}
                onChange={onResolutionChange}
                className="w-32 rounded-md border border-border/60 bg-muted px-1.5 py-0.5 text-[10px] outline-none"
              >
                {resolutionGroups.map((group) => (
                  <optgroup key={group.label} label={group.label}>
                    {group.options.map((opt) => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </optgroup>
                ))}
                <option value={customResolutionValue ?? ''}>Custom</option>
              </select>
            </div>
          )}
          {resolutionValue === customResolutionValue && onWidthChange && onHeightChange && (
            <div className="flex items-center justify-end gap-1">
              <input type="number" min={1} className="w-16 rounded-md border border-border/60 bg-muted px-1.5 py-0.5 text-[10px]" value={widthValue ?? ''} onChange={onWidthChange} placeholder="W" />
              <span className="text-[10px] text-muted-foreground">×</span>
              <input type="number" min={1} className="w-16 rounded-md border border-border/60 bg-muted px-1.5 py-0.5 text-[10px]" value={heightValue ?? ''} onChange={onHeightChange} placeholder="H" />
            </div>
          )}

          {/* Duration (video) */}
          {nodeType === 'video' && durationOptions && onDurationChange && (
            <div className="flex items-center justify-between gap-1.5">
              <span className="text-[10px] text-muted-foreground">{t('node.duration')}</span>
              <select
                value={durationValue ?? customResolutionValue ?? ''}
                onChange={onDurationChange}
                className="w-20 rounded-md border border-border/60 bg-muted px-1.5 py-0.5 text-[10px] outline-none"
              >
                {durationOptions.map((d) => (
                  <option key={d} value={d}>{d}s</option>
                ))}
                <option value={customResolutionValue ?? ''}>Custom</option>
              </select>
            </div>
          )}
          {nodeType === 'video' && durationValue === customResolutionValue && onDurationInputChange && (
            <div className="flex items-center justify-end">
              <input type="number" min={1} max={60} className="w-20 rounded-md border border-border/60 bg-muted px-1.5 py-0.5 text-[10px]" value={durationInputValue ?? ''} onChange={onDurationInputChange} />
            </div>
          )}

          {/* FPS (video) */}
          {nodeType === 'video' && fpsOptions && onFpsChange && (
            <div className="flex items-center justify-between gap-1.5">
              <span className="text-[10px] text-muted-foreground">{t('export.fps')}</span>
              <select
                value={String(fpsValue ?? fpsOptions[0])}
                onChange={onFpsChange}
                className="w-20 rounded-md border border-border/60 bg-muted px-1.5 py-0.5 text-[10px] outline-none"
              >
                {fpsOptions.map((fps) => (
                  <option key={fps} value={fps}>{fps}fps</option>
                ))}
              </select>
            </div>
          )}

          {/* Seed */}
          {seedValue !== undefined && onSeedChange && (
            <div className="flex items-center justify-between gap-1.5">
              <span className="text-[10px] text-muted-foreground">{t('generation.seed')}</span>
              <div className="flex items-center gap-1">
                <input
                  type="number"
                  className="w-24 rounded-md border border-border/60 bg-muted px-1.5 py-0.5 text-[10px] text-right outline-none focus:ring-1 focus:ring-ring"
                  value={seedValue}
                  onChange={onSeedChange}
                />
                {onRandomizeSeed && (
                  <button type="button" onClick={onRandomizeSeed} className="p-0.5 text-muted-foreground hover:text-foreground" title="Randomize">
                    <Dice5 className="h-3 w-3" />
                  </button>
                )}
                {onToggleSeedLock && (
                  <button type="button" onClick={onToggleSeedLock} className="p-0.5 text-muted-foreground hover:text-foreground" title={seedLocked ? t('generation.seedLocked') : t('generation.seedUnlocked')}>
                    {seedLocked ? <Lock className="h-3 w-3" /> : <Unlock className="h-3 w-3" />}
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Upload / Replace */}
          {uploadHasAsset !== undefined && onUpload && (
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                className="flex items-center gap-1 rounded-md border border-border/60 px-2 py-0.5 text-[10px] hover:bg-muted"
                onClick={() => void onUpload()}
              >
                <Upload className="w-3 h-3" />
                {uploadHasAsset ? t('inspector.replace') : t('inspector.upload')}
              </button>
              {uploadHasAsset && onClear && (
                <button
                  type="button"
                  className="flex items-center gap-1 rounded-md border border-destructive/50 px-2 py-0.5 text-[10px] text-destructive hover:bg-destructive/10"
                  onClick={onClear}
                >
                  <Trash2 className="w-3 h-3" />
                  {t('inspector.clear')}
                </button>
              )}
            </div>
          )}

          {/* Audio toggle (all video providers) */}
          {showAudioToggle && onAudioChange && (
            <div className="space-y-0.5">
              <label className="flex items-center gap-1.5 text-[10px] text-muted-foreground cursor-pointer">
                <input
                  type="checkbox"
                  checked={audioEnabled ?? false}
                  onChange={(e) => onAudioChange(e.target.checked)}
                  className="rounded border-border accent-primary"
                />
                {audioLabel ?? 'Audio'}
              </label>
              {audioWarning && (
                <span className="block text-[9px] text-yellow-500">{audioWarning}</span>
              )}
            </div>
          )}

          {/* Lip sync toggle (video nodes) */}
          {showLipSyncToggle && onLipSyncChange && (
            <div className="space-y-0.5">
              <label className="flex items-center gap-1.5 text-[10px] text-muted-foreground cursor-pointer">
                <input
                  type="checkbox"
                  checked={lipSyncEnabled ?? false}
                  onChange={(e) => onLipSyncChange(e.target.checked)}
                  className="rounded border-border accent-primary"
                />
                {lipSyncLabel ?? 'Lip Sync'}
              </label>
            </div>
          )}

          {/* Quality selector (all video providers) */}
          {showQualitySelector && qualityOptions && qualityOptions.length > 0 && onQualityChange && (
            <div className="space-y-1">
              <span className="text-[10px] text-muted-foreground">{qualityLabel ?? 'Quality'}</span>
              <select
                value={qualityValue ?? ''}
                onChange={onQualityChange}
                className="w-full text-[11px] rounded-md border border-border/60 bg-background px-1.5 py-1 outline-none"
              >
                {qualityOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>
          )}

          {/* Variant gallery */}
          {variantGrid && (
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-muted-foreground">{t('generation.variants')}</span>
                {variantLabel && <span className="text-[10px] text-muted-foreground">{variantLabel}</span>}
              </div>
              <div className="max-h-[140px] overflow-auto">
                <div className="grid grid-cols-4 gap-1">{variantGrid}</div>
              </div>
            </div>
          )}

          {/* Cost */}
          {estimatedCost && (
            <div className="text-[10px] text-muted-foreground text-right">{estimatedCost}</div>
          )}
        </div>
      )}
    </div>
  );
}
