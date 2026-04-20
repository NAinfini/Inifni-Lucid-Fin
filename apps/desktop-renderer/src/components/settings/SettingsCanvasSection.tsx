import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  Canvas,
  CanvasAspectRatio,
  CanvasSettings,
} from '@lucid-fin/contracts';
import { useSelector } from 'react-redux';
import type { RootState } from '../../store/index.js';
import { getAPI } from '../../utils/api.js';
import { t } from '../../i18n.js';
import { Button } from '../ui/Button.js';
import { Input } from '../ui/Input.js';
import { Textarea } from '../ui/Textarea.js';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../ui/Select.js';

/**
 * Canvas-scoped settings, surfaced inside the program Settings page.
 * Requires an active canvas; otherwise renders a disabled notice.
 * Uses the same canvas.load / canvas.save IPC as the former Dialog.
 */

const ASPECT_RATIOS: Array<CanvasAspectRatio> = ['16:9', '9:16', '1:1', '2.39:1'];

interface DraftState {
  stylePlate: string;
  negativePrompt: string;
  defaultWidth: string;
  defaultHeight: string;
  aspectRatio: string;
  llmProviderId: string;
  imageProviderId: string;
  videoProviderId: string;
  audioProviderId: string;
}

function settingsToDraft(settings: CanvasSettings | undefined): DraftState {
  return {
    stylePlate: settings?.stylePlate ?? '',
    negativePrompt: settings?.negativePrompt ?? '',
    defaultWidth:  settings?.defaultResolution ? String(settings.defaultResolution.width)  : '',
    defaultHeight: settings?.defaultResolution ? String(settings.defaultResolution.height) : '',
    aspectRatio: settings?.aspectRatio ?? '',
    llmProviderId: settings?.llmProviderId ?? '',
    imageProviderId: settings?.imageProviderId ?? '',
    videoProviderId: settings?.videoProviderId ?? '',
    audioProviderId: settings?.audioProviderId ?? '',
  };
}

function draftToSettings(draft: DraftState): CanvasSettings {
  const out: CanvasSettings = {};
  if (draft.stylePlate.trim()) out.stylePlate = draft.stylePlate.trim();
  if (draft.negativePrompt.trim()) out.negativePrompt = draft.negativePrompt.trim();
  const w = Number.parseInt(draft.defaultWidth, 10);
  const h = Number.parseInt(draft.defaultHeight, 10);
  if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) {
    out.defaultResolution = { width: w, height: h };
  }
  if (draft.aspectRatio) out.aspectRatio = draft.aspectRatio as CanvasAspectRatio;
  if (draft.llmProviderId.trim()) out.llmProviderId = draft.llmProviderId.trim();
  if (draft.imageProviderId.trim()) out.imageProviderId = draft.imageProviderId.trim();
  if (draft.videoProviderId.trim()) out.videoProviderId = draft.videoProviderId.trim();
  if (draft.audioProviderId.trim()) out.audioProviderId = draft.audioProviderId.trim();
  return out;
}

export function SettingsCanvasSection() {
  const activeCanvasId = useSelector((s: RootState) => s.canvas.activeCanvasId);
  const llmProviders   = useSelector((s: RootState) => s.settings.llm.providers);
  const imageProviders = useSelector((s: RootState) => s.settings.image.providers);
  const videoProviders = useSelector((s: RootState) => s.settings.video.providers);
  const audioProviders = useSelector((s: RootState) => s.settings.audio.providers);

  // Only surface providers that have an API key configured — unconfigured
  // ones can't drive real generation and selecting them just produces a
  // runtime error later. Current canvas selection stays visible even when
  // orphaned so the user can see + re-pick rather than silent blank.
  const llmOptions = useMemo(
    () => llmProviders.filter((p) => p.hasKey).map((p) => ({ id: p.id, name: p.name })),
    [llmProviders],
  );
  const imageOptions = useMemo(
    () => imageProviders.filter((p) => p.hasKey).map((p) => ({ id: p.id, name: p.name })),
    [imageProviders],
  );
  const videoOptions = useMemo(
    () => videoProviders.filter((p) => p.hasKey).map((p) => ({ id: p.id, name: p.name })),
    [videoProviders],
  );
  const audioOptions = useMemo(
    () => audioProviders.filter((p) => p.hasKey).map((p) => ({ id: p.id, name: p.name })),
    [audioProviders],
  );

  const [canvas, setCanvas] = useState<Canvas | null>(null);
  const [draft, setDraft] = useState<DraftState>(() => settingsToDraft(undefined));
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  // Auto-save plumbing: every draft edit schedules a debounced save. A ref
  // holds the latest canvas/draft so the timer callback always reads fresh
  // values instead of closure-captured stale ones.
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestRef = useRef<{ canvas: Canvas | null; draft: DraftState }>({
    canvas: null,
    draft: settingsToDraft(undefined),
  });
  latestRef.current = { canvas, draft };

  useEffect(() => {
    if (!activeCanvasId) {
      setCanvas(null);
      setDraft(settingsToDraft(undefined));
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const api = getAPI();
        if (!api) throw new Error('IPC bridge unavailable');
        const loaded = await api.canvas.load(activeCanvasId);
        if (cancelled) return;
        setCanvas(loaded);
        setDraft(settingsToDraft(loaded.settings));
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [activeCanvasId]);

  const persist = useCallback(async () => {
    const { canvas: liveCanvas, draft: liveDraft } = latestRef.current;
    if (!liveCanvas) return;
    setSaving(true);
    setError(null);
    try {
      const api = getAPI();
      if (!api) throw new Error('IPC bridge unavailable');
      const nextSettings = draftToSettings(liveDraft);
      const next: Canvas = {
        ...liveCanvas,
        settings: Object.keys(nextSettings).length > 0 ? nextSettings : undefined,
        updatedAt: Date.now(),
      };
      await api.canvas.save(next);
      setCanvas(next);
      setSavedAt(Date.now());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }, []);

  const updateDraft = useCallback((patch: Partial<DraftState>) => {
    setDraft((d) => ({ ...d, ...patch }));
    setSavedAt(null);
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      void persist();
    }, 400);
  }, [persist]);

  // Flush any pending debounced save on unmount / canvas switch so edits
  // made just before navigating don't vanish.
  useEffect(() => {
    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
        void persist();
      }
    };
  }, [persist]);

  const handleReset = useCallback(() => {
    setDraft(settingsToDraft(undefined));
    setSavedAt(null);
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      void persist();
    }, 400);
  }, [persist]);

  if (!activeCanvasId) {
    return (
      <div className="rounded-md border border-border/60 bg-muted/30 px-4 py-10 text-center text-sm text-muted-foreground">
        {t('settings.canvas.noActiveCanvas')}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        {canvas?.name && (
          <span>
            {t('settings.canvas.editing')}: <span className="font-medium text-foreground">{canvas.name}</span>
          </span>
        )}
        <span className="ml-auto">
          {saving
            ? t('canvas.canvasSettings.saving')
            : savedAt
              ? t('settings.canvas.saved')
              : ''}
        </span>
      </div>

      {loading ? (
        <div className="py-8 text-center text-sm text-muted-foreground">
          {t('canvas.canvasSettings.loading')}
        </div>
      ) : (
        <div className="grid gap-4">
          <LabeledField
            label={t('canvas.canvasSettings.stylePlate')}
            hint={t('canvas.canvasSettings.stylePlateHint')}
          >
            <Textarea
              rows={3}
              value={draft.stylePlate}
              onChange={(e) => updateDraft({ stylePlate: e.target.value })}
              placeholder={t('canvas.canvasSettings.stylePlatePlaceholder')}
            />
          </LabeledField>

          <LabeledField
            label={t('canvas.canvasSettings.negativePrompt')}
            hint={t('canvas.canvasSettings.negativePromptHint')}
          >
            <Textarea
              rows={2}
              value={draft.negativePrompt}
              onChange={(e) => updateDraft({ negativePrompt: e.target.value })}
              placeholder={t('canvas.canvasSettings.negativePromptPlaceholder')}
            />
          </LabeledField>

          <LabeledField
            label={t('canvas.canvasSettings.defaultResolution')}
            hint={t('canvas.canvasSettings.defaultResolutionHint')}
          >
            <div className="flex items-center gap-2">
              <Input
                type="number"
                min={1}
                value={draft.defaultWidth}
                onChange={(e) => updateDraft({ defaultWidth: e.target.value })}
                placeholder={t('canvas.canvasSettings.defaultResolutionWidth')}
              />
              <span className="text-xs text-muted-foreground">×</span>
              <Input
                type="number"
                min={1}
                value={draft.defaultHeight}
                onChange={(e) => updateDraft({ defaultHeight: e.target.value })}
                placeholder={t('canvas.canvasSettings.defaultResolutionHeight')}
              />
            </div>
          </LabeledField>

          <LabeledField
            label={t('canvas.canvasSettings.aspectRatio')}
            hint={t('canvas.canvasSettings.aspectRatioHint')}
          >
            <PlainSelect
              value={draft.aspectRatio}
              onChange={(v) => updateDraft({ aspectRatio: v })}
              options={ASPECT_RATIOS.map((v) => ({ id: v, name: v }))}
            />
          </LabeledField>

          <LabeledField label={t('canvas.canvasSettings.llmProvider')}>
            <PlainSelect
              value={draft.llmProviderId}
              onChange={(v) => updateDraft({ llmProviderId: v })}
              options={llmOptions}
            />
          </LabeledField>

          <LabeledField label={t('canvas.canvasSettings.imageProvider')}>
            <PlainSelect
              value={draft.imageProviderId}
              onChange={(v) => updateDraft({ imageProviderId: v })}
              options={imageOptions}
            />
          </LabeledField>

          <LabeledField label={t('canvas.canvasSettings.videoProvider')}>
            <PlainSelect
              value={draft.videoProviderId}
              onChange={(v) => updateDraft({ videoProviderId: v })}
              options={videoOptions}
            />
          </LabeledField>

          <LabeledField label={t('canvas.canvasSettings.audioProvider')}>
            <PlainSelect
              value={draft.audioProviderId}
              onChange={(v) => updateDraft({ audioProviderId: v })}
              options={audioOptions}
            />
          </LabeledField>
        </div>
      )}

      {error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {error}
        </div>
      )}

      <div className="flex items-center justify-end pt-2">
        <Button variant="ghost" onClick={handleReset} disabled={saving || loading || !canvas}>
          {t('canvas.canvasSettings.clearAll')}
        </Button>
      </div>
    </div>
  );
}

interface LabeledFieldProps {
  label: string;
  hint?: string;
  children: React.ReactNode;
}

function LabeledField({ label, hint, children }: LabeledFieldProps) {
  return (
    <div className="grid gap-1.5">
      <div className="flex items-baseline justify-between">
        <label className="text-xs font-medium text-foreground">{label}</label>
        {hint && <span className="text-[10px] text-muted-foreground">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

interface PlainSelectProps {
  value: string;
  onChange: (value: string) => void;
  options: Array<{ id: string; name: string }>;
}

function PlainSelect({ value, onChange, options }: PlainSelectProps) {
  return (
    <Select
      value={value || undefined}
      onValueChange={(v) => onChange(v)}
    >
      <SelectTrigger>
        <SelectValue placeholder={t('canvas.canvasSettings.selectPlaceholder')} />
      </SelectTrigger>
      <SelectContent>
        {options.map((opt) => (
          <SelectItem key={opt.id} value={opt.id}>
            {opt.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
