import { useState } from 'react';
import { ChevronDown, ChevronUp, Dice5, Loader2, Lock, Unlock } from 'lucide-react';
import { cn } from '../../lib/utils.js';

type Translate = (key: string) => string;

interface ProviderOption {
  id: string;
  name: string;
}

export interface InspectorGenerationBarProps {
  t: Translate;
  providerOptions: ProviderOption[];
  activeProviderId?: string;
  providerLoading: boolean;
  onProviderChange: (e: React.ChangeEvent<HTMLSelectElement>) => void;
  variantOptions: number[];
  activeVariantCount: number;
  onVariantCountChange: (count: number) => void;
  isGenerating: boolean;
  hasVariants: boolean;
  estimatedCost?: string;
  onGenerate: () => void | Promise<void>;
  onCancel: () => void | Promise<void>;
  // Seed controls
  seedValue?: number;
  seedLocked?: boolean;
  onSeedChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onRandomizeSeed?: () => void;
  onToggleSeedLock?: () => void;
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
}: InspectorGenerationBarProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="shrink-0 border-t border-border/60 bg-card">
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

      {/* Expanded: variants, seed, cost */}
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

          {/* Cost */}
          {estimatedCost && (
            <div className="text-[10px] text-muted-foreground text-right">{estimatedCost}</div>
          )}
        </div>
      )}
    </div>
  );
}
