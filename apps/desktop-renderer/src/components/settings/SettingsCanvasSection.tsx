import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  Canvas,
  CanvasAspectRatio,
  CanvasSettings,
} from '@lucid-fin/contracts';
import { useSelector } from 'react-redux';
import { Palette, Image as ImageIcon, Layers } from 'lucide-react';
import type { RootState } from '../../store/index.js';
import { getAPI } from '../../utils/api.js';
import { t } from '../../i18n.js';
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
 *
 * Three distinct resolutions live on a canvas:
 *  - publishImageResolution: default size for image-node outputs. Each
 *    preset pins an aspect ratio, so picking a preset updates both W×H
 *    and canvas aspectRatio atomically.
 *  - publishVideoResolution: default size for video-node outputs. Kept
 *    separate because video providers cap at 1080p (only Veo does 4K),
 *    while image providers support up to 4K routinely.
 *  - refResolution: default size for ref-image generation (entity ref
 *    sheets). Independent of publishing; defaults to "provider default"
 *    (unset) so each provider's native size kicks in.
 */

// Image-publishing presets. Each preset pins an aspect ratio → updates
// both publishImageResolution and aspectRatio atomically.
const PUBLISH_IMAGE_PRESETS: Array<{ id: string; width: number; height: number; aspect: CanvasAspectRatio }> = [
  { id: '4k',              width: 3840, height: 2160, aspect: '16:9' },
  { id: '2k',              width: 2560, height: 1440, aspect: '16:9' },
  { id: '1080p',           width: 1920, height: 1080, aspect: '16:9' },
  { id: '720p',            width: 1280, height: 720,  aspect: '16:9' },
  { id: 'vertical-1080p',  width: 1080, height: 1920, aspect: '9:16' },
  { id: 'vertical-720p',   width: 720,  height: 1280, aspect: '9:16' },
];
type PublishImagePresetId = (typeof PUBLISH_IMAGE_PRESETS)[number]['id'] | 'provider-default' | 'custom';

// Video-publishing presets. Dropped 4K because only Veo supports it —
// everywhere else it would force a clamp-down.
const PUBLISH_VIDEO_PRESETS: Array<{ id: string; width: number; height: number; aspect: CanvasAspectRatio }> = [
  { id: '1080p',           width: 1920, height: 1080, aspect: '16:9' },
  { id: '720p',            width: 1280, height: 720,  aspect: '16:9' },
  { id: 'vertical-1080p',  width: 1080, height: 1920, aspect: '9:16' },
  { id: 'vertical-720p',   width: 720,  height: 1280, aspect: '9:16' },
];
type PublishVideoPresetId = (typeof PUBLISH_VIDEO_PRESETS)[number]['id'] | 'provider-default' | 'custom';

// Ref-image presets: sizes accepted natively by every mainstream image
// provider we ship (OpenAI gpt-image-1, Imagen 4, Flux 1.1 Pro/Ultra,
// Ideogram V3, Recraft V3, Gemini Nano Banana). 1792-series is excluded
// because it exceeds Flux 1.1 Pro's 1440 cap. "provider-default" is a
// sentinel — selecting it clears refResolution so per-provider / per-entity
// factory defaults apply downstream.
const REF_PRESETS: Array<{ id: string; width: number; height: number }> = [
  { id: 'ref-1024-square',    width: 1024, height: 1024 },
  { id: 'ref-1344-landscape', width: 1344, height: 768  },
  { id: 'ref-768-vertical',   width: 768,  height: 1344 },
  { id: 'ref-2048-square',    width: 2048, height: 2048 },
];
type RefPresetId = (typeof REF_PRESETS)[number]['id'] | 'provider-default' | 'custom';

const DEFAULT_PUBLISH_IMAGE_PRESET: PublishImagePresetId = 'provider-default';
const DEFAULT_PUBLISH_VIDEO_PRESET: PublishVideoPresetId = 'provider-default';
const DEFAULT_ASPECT_RATIO = '';  // empty sentinel — means "canvas has no aspect override"
const DEFAULT_REF_PRESET: RefPresetId = 'provider-default';

function detectPublishImagePreset(width: number, height: number): PublishImagePresetId {
  const match = PUBLISH_IMAGE_PRESETS.find((p) => p.width === width && p.height === height);
  return match ? match.id : 'custom';
}

function detectPublishVideoPreset(width: number, height: number): PublishVideoPresetId {
  const match = PUBLISH_VIDEO_PRESETS.find((p) => p.width === width && p.height === height);
  return match ? match.id : 'custom';
}

function detectRefPreset(width: number, height: number): RefPresetId {
  const match = REF_PRESETS.find((p) => p.width === width && p.height === height);
  return match ? match.id : 'custom';
}

interface DraftState {
  stylePlate: string;
  negativePrompt: string;
  publishImagePreset: PublishImagePresetId;
  publishImageWidth: string;
  publishImageHeight: string;
  publishVideoPreset: PublishVideoPresetId;
  publishVideoWidth: string;
  publishVideoHeight: string;
  aspectRatio: string;
  refPreset: RefPresetId;
  refWidth: string;
  refHeight: string;
  llmProviderId: string;
  imageProviderId: string;
  videoProviderId: string;
  audioProviderId: string;
}

function settingsToDraft(settings: CanvasSettings | undefined): DraftState {
  const imgRes = settings?.publishImageResolution;
  const imgPreset: PublishImagePresetId = imgRes
    ? detectPublishImagePreset(imgRes.width, imgRes.height)
    : DEFAULT_PUBLISH_IMAGE_PRESET;
  const vidRes = settings?.publishVideoResolution;
  const vidPreset: PublishVideoPresetId = vidRes
    ? detectPublishVideoPreset(vidRes.width, vidRes.height)
    : DEFAULT_PUBLISH_VIDEO_PRESET;
  const refPreset: RefPresetId = settings?.refResolution
    ? detectRefPreset(settings.refResolution.width, settings.refResolution.height)
    : DEFAULT_REF_PRESET;
  const refW = settings?.refResolution?.width  ?? 0;
  const refH = settings?.refResolution?.height ?? 0;
  return {
    stylePlate: settings?.stylePlate ?? '',
    negativePrompt: settings?.negativePrompt ?? '',
    publishImagePreset: imgPreset,
    publishImageWidth:  imgRes ? String(imgRes.width)  : '',
    publishImageHeight: imgRes ? String(imgRes.height) : '',
    publishVideoPreset: vidPreset,
    publishVideoWidth:  vidRes ? String(vidRes.width)  : '',
    publishVideoHeight: vidRes ? String(vidRes.height) : '',
    aspectRatio: settings?.aspectRatio ?? DEFAULT_ASPECT_RATIO,
    refPreset,
    refWidth: refW > 0 ? String(refW) : '',
    refHeight: refH > 0 ? String(refH) : '',
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
  // provider-default ⇒ omit publishImageResolution. Otherwise parse and emit.
  if (draft.publishImagePreset !== 'provider-default') {
    const imgW = Number.parseInt(draft.publishImageWidth, 10);
    const imgH = Number.parseInt(draft.publishImageHeight, 10);
    if (Number.isFinite(imgW) && Number.isFinite(imgH) && imgW > 0 && imgH > 0) {
      out.publishImageResolution = { width: imgW, height: imgH };
    }
  }
  if (draft.publishVideoPreset !== 'provider-default') {
    const vidW = Number.parseInt(draft.publishVideoWidth, 10);
    const vidH = Number.parseInt(draft.publishVideoHeight, 10);
    if (Number.isFinite(vidW) && Number.isFinite(vidH) && vidW > 0 && vidH > 0) {
      out.publishVideoResolution = { width: vidW, height: vidH };
    }
  }
  // provider-default ⇒ omit refResolution entirely.
  if (draft.refPreset !== 'provider-default') {
    const refW = Number.parseInt(draft.refWidth, 10);
    const refH = Number.parseInt(draft.refHeight, 10);
    if (Number.isFinite(refW) && Number.isFinite(refH) && refW > 0 && refH > 0) {
      out.refResolution = { width: refW, height: refH };
    }
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

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
        void persist();
      }
    };
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
        <div className="space-y-4">
          {/* Style */}
          <SectionCard icon={Palette} title={t('canvas.canvasSettings.sectionStyle')}>
            <div className="space-y-3">
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
            </div>
          </SectionCard>

          {/* Output: Publish image + Publish video + Ref image */}
          <SectionCard icon={ImageIcon} title={t('canvas.canvasSettings.sectionOutput')}>
            <div className="space-y-3">
              <LabeledField
                label={t('canvas.canvasSettings.publishImageResolution')}
                hint={t('canvas.canvasSettings.publishImageResolutionHint')}
              >
                <div className="space-y-2">
                  <PlainSelect
                    value={draft.publishImagePreset}
                    onChange={(v) => {
                      const presetId = v as PublishImagePresetId;
                      if (presetId === 'provider-default') {
                        updateDraft({ publishImagePreset: 'provider-default', publishImageWidth: '', publishImageHeight: '' });
                        return;
                      }
                      if (presetId === 'custom') {
                        updateDraft({ publishImagePreset: 'custom' });
                        return;
                      }
                      const preset = PUBLISH_IMAGE_PRESETS.find((p) => p.id === presetId);
                      if (!preset) return;
                      updateDraft({
                        publishImagePreset: preset.id,
                        publishImageWidth: String(preset.width),
                        publishImageHeight: String(preset.height),
                        aspectRatio: preset.aspect,
                      });
                    }}
                    options={[
                      { id: 'provider-default', name: t('canvas.canvasSettings.publishPreset.providerDefault') },
                      ...PUBLISH_IMAGE_PRESETS.map((p) => ({
                        id: p.id,
                        name: `${t(`canvas.canvasSettings.publishPreset.${p.id}`)} (${p.width}×${p.height} · ${p.aspect})`,
                      })),
                      { id: 'custom', name: t('canvas.canvasSettings.publishPreset.custom') },
                    ]}
                  />
                  {draft.publishImagePreset === 'custom' && (
                    <div className="flex items-center gap-2">
                      <Input
                        type="number"
                        min={1}
                        value={draft.publishImageWidth}
                        onChange={(e) => updateDraft({ publishImageWidth: e.target.value })}
                        placeholder={t('canvas.canvasSettings.widthPlaceholder')}
                      />
                      <span className="text-xs text-muted-foreground">×</span>
                      <Input
                        type="number"
                        min={1}
                        value={draft.publishImageHeight}
                        onChange={(e) => updateDraft({ publishImageHeight: e.target.value })}
                        placeholder={t('canvas.canvasSettings.heightPlaceholder')}
                      />
                    </div>
                  )}
                </div>
              </LabeledField>

              <LabeledField
                label={t('canvas.canvasSettings.publishVideoResolution')}
                hint={t('canvas.canvasSettings.publishVideoResolutionHint')}
              >
                <div className="space-y-2">
                  <PlainSelect
                    value={draft.publishVideoPreset}
                    onChange={(v) => {
                      const presetId = v as PublishVideoPresetId;
                      if (presetId === 'provider-default') {
                        updateDraft({ publishVideoPreset: 'provider-default', publishVideoWidth: '', publishVideoHeight: '' });
                        return;
                      }
                      if (presetId === 'custom') {
                        updateDraft({ publishVideoPreset: 'custom' });
                        return;
                      }
                      const preset = PUBLISH_VIDEO_PRESETS.find((p) => p.id === presetId);
                      if (!preset) return;
                      updateDraft({
                        publishVideoPreset: preset.id,
                        publishVideoWidth: String(preset.width),
                        publishVideoHeight: String(preset.height),
                      });
                    }}
                    options={[
                      { id: 'provider-default', name: t('canvas.canvasSettings.publishPreset.providerDefault') },
                      ...PUBLISH_VIDEO_PRESETS.map((p) => ({
                        id: p.id,
                        name: `${t(`canvas.canvasSettings.publishPreset.${p.id}`)} (${p.width}×${p.height} · ${p.aspect})`,
                      })),
                      { id: 'custom', name: t('canvas.canvasSettings.publishPreset.custom') },
                    ]}
                  />
                  {draft.publishVideoPreset === 'custom' && (
                    <div className="flex items-center gap-2">
                      <Input
                        type="number"
                        min={1}
                        value={draft.publishVideoWidth}
                        onChange={(e) => updateDraft({ publishVideoWidth: e.target.value })}
                        placeholder={t('canvas.canvasSettings.widthPlaceholder')}
                      />
                      <span className="text-xs text-muted-foreground">×</span>
                      <Input
                        type="number"
                        min={1}
                        value={draft.publishVideoHeight}
                        onChange={(e) => updateDraft({ publishVideoHeight: e.target.value })}
                        placeholder={t('canvas.canvasSettings.heightPlaceholder')}
                      />
                    </div>
                  )}
                </div>
              </LabeledField>

              <LabeledField
                label={t('canvas.canvasSettings.refResolution')}
                hint={t('canvas.canvasSettings.refResolutionHint')}
              >
                <div className="space-y-2">
                  <PlainSelect
                    value={draft.refPreset}
                    onChange={(v) => {
                      const presetId = v as RefPresetId;
                      if (presetId === 'provider-default') {
                        updateDraft({ refPreset: 'provider-default', refWidth: '', refHeight: '' });
                        return;
                      }
                      if (presetId === 'custom') {
                        updateDraft({ refPreset: 'custom' });
                        return;
                      }
                      const preset = REF_PRESETS.find((p) => p.id === presetId);
                      if (!preset) return;
                      updateDraft({
                        refPreset: preset.id,
                        refWidth: String(preset.width),
                        refHeight: String(preset.height),
                      });
                    }}
                    options={[
                      { id: 'provider-default', name: t('canvas.canvasSettings.refPreset.providerDefault') },
                      ...REF_PRESETS.map((p) => ({
                        id: p.id,
                        name: `${t(`canvas.canvasSettings.refPreset.${p.id}`)} (${p.width}×${p.height})`,
                      })),
                      { id: 'custom', name: t('canvas.canvasSettings.refPreset.custom') },
                    ]}
                  />
                  {draft.refPreset === 'custom' && (
                    <div className="flex items-center gap-2">
                      <Input
                        type="number"
                        min={1}
                        value={draft.refWidth}
                        onChange={(e) => updateDraft({ refWidth: e.target.value })}
                        placeholder={t('canvas.canvasSettings.widthPlaceholder')}
                      />
                      <span className="text-xs text-muted-foreground">×</span>
                      <Input
                        type="number"
                        min={1}
                        value={draft.refHeight}
                        onChange={(e) => updateDraft({ refHeight: e.target.value })}
                        placeholder={t('canvas.canvasSettings.heightPlaceholder')}
                      />
                    </div>
                  )}
                </div>
              </LabeledField>
            </div>
          </SectionCard>

          {/* Providers */}
          <SectionCard icon={Layers} title={t('canvas.canvasSettings.sectionProviders')}>
            <div className="grid gap-3 sm:grid-cols-2">
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
          </SectionCard>
        </div>
      )}

      {error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {error}
        </div>
      )}
    </div>
  );
}

interface SectionCardProps {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  children: React.ReactNode;
}

function SectionCard({ icon: Icon, title, children }: SectionCardProps) {
  return (
    <div className="rounded-lg border border-border/60 bg-muted/20 p-3">
      <div className="mb-2 flex items-center gap-1.5">
        <Icon className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-xs font-medium">{title}</span>
      </div>
      {children}
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
