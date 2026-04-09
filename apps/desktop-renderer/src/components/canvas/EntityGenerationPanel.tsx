import { useState } from 'react';
import { Loader2, Lock, Unlock, Sparkles } from 'lucide-react';
import { getAPI } from '../../utils/api.js';
import { useI18n } from '../../hooks/use-i18n.js';

interface Props {
  entityType: 'character' | 'equipment' | 'location';
  entityId: string;
  description: string;
  onGenerated: () => void;
}

export function EntityGenerationPanel({ entityType, entityId, description, onGenerated }: Props) {
  const { t } = useI18n();
  const [provider, setProvider] = useState('google-imagen3');
  const [variantCount, setVariantCount] = useState(1);
  const [seed, setSeed] = useState<number | undefined>();
  const [seedLocked, setSeedLocked] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleGenerate = async () => {
    setGenerating(true);
    setError(null);
    try {
      const api = getAPI();
      if (!api?.entity) return;
      await api.entity.generateReferenceImage({
        entityType,
        entityId,
        description,
        provider,
        variantCount,
        seed: seedLocked ? seed : undefined,
      });
      onGenerated();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="border border-border/70 rounded p-2 space-y-2">
      <div className="text-[10px] uppercase text-muted-foreground tracking-wider">
        {t('generation.settings')}
      </div>

      <div className="space-y-1">
        <label className="text-[10px] text-muted-foreground">{t('generation.provider')}</label>
        <select
          value={provider}
          onChange={(e) => setProvider(e.target.value)}
          className="w-full rounded bg-muted px-2 py-1 text-xs"
        >
          <option value="google-imagen3">Google Imagen 3</option>
          <option value="openai-image">OpenAI Image</option>
          <option value="stability-sd3">Stability SD3</option>
        </select>
      </div>

      <div className="space-y-1">
        <label className="text-[10px] text-muted-foreground">{t('generation.variantCount')}</label>
        <input
          type="number"
          min={1}
          max={9}
          value={variantCount}
          onChange={(e) => setVariantCount(Math.max(1, Math.min(9, parseInt(e.target.value) || 1)))}
          className="w-full rounded bg-muted px-2 py-1 text-xs"
        />
      </div>

      <div className="space-y-1">
        <label className="text-[10px] text-muted-foreground">{t('generation.seed')}</label>
        <div className="flex gap-1">
          <input
            type="number"
            value={seed ?? ''}
            onChange={(e) => setSeed(parseInt(e.target.value) || undefined)}
            placeholder={t('entityGeneration.randomSeed')}
            disabled={!seedLocked}
            className="flex-1 rounded bg-muted px-2 py-1 text-xs disabled:opacity-50"
          />
          <button
            type="button"
            onClick={() => setSeedLocked((v) => !v)}
            className="rounded border border-border px-1.5 py-1 hover:bg-muted"
            title={seedLocked ? t('generation.seedLocked') : t('generation.seedUnlocked')}
          >
            {seedLocked ? <Lock className="w-3 h-3" /> : <Unlock className="w-3 h-3" />}
          </button>
        </div>
      </div>

      <button
        type="button"
        onClick={() => void handleGenerate()}
        disabled={generating}
        className="w-full flex items-center justify-center gap-1 rounded border border-border px-2 py-1.5 text-xs hover:bg-muted disabled:opacity-50"
      >
        {generating ? (
          <>
            <Loader2 className="w-3 h-3 animate-spin" />
            {t('generation.generating')}
          </>
        ) : (
          <>
            <Sparkles className="w-3 h-3" />
            {t('entityGeneration.generateReferenceImage')}
          </>
        )}
      </button>

      {error && <div className="text-[11px] text-destructive">{error}</div>}
    </div>
  );
}
