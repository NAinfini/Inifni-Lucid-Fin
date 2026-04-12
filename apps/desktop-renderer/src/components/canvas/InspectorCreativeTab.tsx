import { memo, type ChangeEventHandler, type ReactNode } from 'react';
import { ChevronDown, Clapperboard, LayoutGrid } from 'lucide-react';
import { cn } from '../../lib/utils.js';
import { CommitSlider } from '../ui/CommitSlider.js';
import type {
  AudioNodeData,
  BackdropNodeData,
  CanvasNodeType,
  ImageNodeData,
  PresetTrackSet,
  ShotTemplate,
  VideoNodeData,
} from '@lucid-fin/contracts';

type Translate = (key: string) => string;
type LocalizeTemplateName = (id: string, name: string) => string;
type LocalizeTemplateDescription = (id: string, description: string) => string;

interface BackdropControls {
  data: BackdropNodeData;
  swatches: string[];
  onColorChange: (color: string) => void;
  onColorInputChange: (color: string) => void;
  onOpacityChange: (opacity: number) => void;
  onBorderStyleChange: (borderStyle: 'dashed' | 'solid' | 'dotted') => void;
  onTitleSizeChange: (titleSize: 'sm' | 'md' | 'lg') => void;
  onLockChildrenChange: (lockChildren: boolean) => void;
  onAutoArrange: () => void;
}

interface InspectorCreativeTabProps {
  t: Translate;
  selectedNodeType: CanvasNodeType;
  generationData?: ImageNodeData | VideoNodeData | AudioNodeData;
  audioType?: string;
  textContent?: string;
  onContentChange: ChangeEventHandler<HTMLTextAreaElement>;
  onPromptChange: ChangeEventHandler<HTMLTextAreaElement>;
  templateDropdownOpen: boolean;
  onToggleTemplateDropdown: () => void;
  builtInTemplates: ShotTemplate[];
  customTemplates: ShotTemplate[];
  hiddenTemplateIds: string[];
  onApplyTemplate: (template: ShotTemplate) => void;
  localizeShotTemplateName: LocalizeTemplateName;
  localizeShotTemplateDescription: LocalizeTemplateDescription;
  trackGrid: ReactNode;
  backdropControls?: BackdropControls;
  textCharCount?: number;
  textWordCount?: number;
  charsLabel?: string;
  wordsLabel?: string;
  /** Suggested templates shown when prompt is empty and no presets applied */
  suggestedTemplates?: ShotTemplate[];
}

function getNonEmptyTrackCategories(trackSet: PresetTrackSet): string[] {
  return Object.entries(trackSet)
    .filter(([, track]) => track.entries.length > 0)
    .map(([category]) => category)
    .sort();
}

function matchesTemplateTracks(trackSet: PresetTrackSet, template: ShotTemplate): boolean {
  const nodeCategories = getNonEmptyTrackCategories(trackSet);
  const templateCategories = Object.entries(template.tracks)
    .filter(([, track]) => track && track.entries.length > 0)
    .map(([category]) => category)
    .sort();

  if (nodeCategories.length !== templateCategories.length) return false;
  if (nodeCategories.some((category, index) => category !== templateCategories[index])) return false;

  return templateCategories.every((category) => {
    const nodeTrack = trackSet[category as keyof PresetTrackSet];
    const templateTrack = template.tracks[category as keyof ShotTemplate['tracks']];
    if (!templateTrack) return false;
    if ((nodeTrack.intensity ?? null) !== (templateTrack.intensity ?? null)) return false;
    if (nodeTrack.entries.length !== templateTrack.entries.length) return false;

    return nodeTrack.entries.every((entry, index) => {
      const templateEntry = templateTrack.entries[index];
      if (!templateEntry) return false;
      return (
        entry.presetId === templateEntry.presetId &&
        (entry.intensity ?? null) === (templateEntry.intensity ?? null) &&
        (entry.direction ?? null) === (templateEntry.direction ?? null) &&
        (entry.durationMs ?? null) === (templateEntry.durationMs ?? null) &&
        JSON.stringify(entry.params ?? {}) === JSON.stringify(templateEntry.params ?? {})
      );
    });
  });
}

export const InspectorCreativeTab = memo(function InspectorCreativeTab({
  t,
  selectedNodeType,
  generationData,
  audioType,
  textContent,
  onContentChange,
  onPromptChange,
  templateDropdownOpen,
  onToggleTemplateDropdown,
  builtInTemplates,
  customTemplates,
  hiddenTemplateIds,
  onApplyTemplate,
  localizeShotTemplateName,
  localizeShotTemplateDescription,
  trackGrid,
  backdropControls,
  textCharCount,
  textWordCount,
  charsLabel,
  wordsLabel,
  suggestedTemplates,
}: InspectorCreativeTabProps) {
  const visibleBuiltInTemplates = builtInTemplates.filter((template) => !hiddenTemplateIds.includes(template.id));
  const visibleCustomTemplates = customTemplates.filter((template) => !hiddenTemplateIds.includes(template.id));
  const currentTrackTemplate =
    generationData &&
    'presetTracks' in generationData &&
    generationData.presetTracks &&
    !('appliedShotTemplateId' in generationData && generationData.appliedShotTemplateId)
      ? [...builtInTemplates, ...customTemplates].find((template) =>
          matchesTemplateTracks(generationData.presetTracks as PresetTrackSet, template),
        )
      : undefined;
  const currentTemplateLabel =
    generationData && ('appliedShotTemplateName' in generationData || 'appliedShotTemplateId' in generationData)
      ? (() => {
          const templateId =
            'appliedShotTemplateId' in generationData ? generationData.appliedShotTemplateId : undefined;
          const templateName =
            'appliedShotTemplateName' in generationData ? generationData.appliedShotTemplateName : undefined;
          if (!templateId && !templateName) return undefined;
          const builtInTemplate = templateId
            ? builtInTemplates.find((template) => template.id === templateId)
            : undefined;
          if (builtInTemplate) {
            return localizeShotTemplateName(builtInTemplate.id, builtInTemplate.name);
          }
          if (templateName) return templateName;
          if (currentTrackTemplate?.builtIn) {
            return localizeShotTemplateName(currentTrackTemplate.id, currentTrackTemplate.name);
          }
          return currentTrackTemplate?.name;
        })()
      : currentTrackTemplate?.builtIn
        ? localizeShotTemplateName(currentTrackTemplate.id, currentTrackTemplate.name)
        : currentTrackTemplate?.name;

  return (
    <>
      {selectedNodeType === 'text' && (
        <div className="px-3 py-3 border-b border-border/60">
          <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
            {t('inspector.content')}
          </label>
          <textarea
            className="mt-1.5 w-full bg-muted px-2.5 py-1.5 rounded-md text-xs outline-none focus:ring-1 focus:ring-ring min-h-[120px] resize-y"
            value={textContent ?? ''}
            onChange={onContentChange}
            placeholder={t('inspector.contentPlaceholder')}
          />
          {textCharCount != null && textWordCount != null && charsLabel && wordsLabel && (
            <div className="mt-1 flex gap-3 text-[10px] text-muted-foreground">
              <span>{charsLabel}</span>
              <span>{wordsLabel}</span>
            </div>
          )}
        </div>
      )}

      {generationData && (
        <div className="px-3 py-3 border-b border-border/60">
          <div className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-1.5">
            {t('inspector.prompt')}
          </div>
          <textarea
            className="w-full bg-muted px-2.5 py-1.5 rounded-md text-xs outline-none focus:ring-1 focus:ring-ring min-h-[100px] resize-y"
            value={generationData.prompt ?? ''}
            onChange={onPromptChange}
            placeholder={t('inspector.promptPlaceholder')}
          />
          {/* Suggested templates — shown when prompt is empty */}
          {!generationData.prompt && suggestedTemplates && suggestedTemplates.length > 0 && (
            <div className="mt-1.5 space-y-1">
              <span className="text-[10px] text-muted-foreground">
                {t('inspector.suggestedTemplates')}
              </span>
              <div className="flex flex-wrap gap-1">
                {suggestedTemplates.slice(0, 6).map((tpl) => (
                  <button
                    key={tpl.id}
                    type="button"
                    className="rounded-full border border-border/60 bg-muted/40 px-2 py-0.5 text-[10px] text-muted-foreground hover:bg-primary/10 hover:text-primary hover:border-primary/40 transition-colors"
                    onClick={() => onApplyTemplate(tpl)}
                    title={localizeShotTemplateDescription(tpl.id, tpl.description)}
                  >
                    {localizeShotTemplateName(tpl.id, tpl.name)}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {selectedNodeType !== 'text' && selectedNodeType !== 'audio' && trackGrid ? (
        <div className="px-3 py-3 border-b border-border/60 space-y-2.5">
          <div className="flex items-center gap-1 text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
            <Clapperboard className="w-3 h-3" />
            {t('shotTemplate.title')}
          </div>
          <div className="relative">
            <button
              type="button"
              className="w-full flex items-center justify-between gap-2 rounded-md border border-border/60 bg-muted/30 px-2.5 py-1.5 text-xs hover:bg-muted/50 transition-colors"
              onClick={onToggleTemplateDropdown}
            >
              <span className={cn('text-[11px]', currentTemplateLabel ? 'text-foreground' : 'text-muted-foreground')}>
                {currentTemplateLabel ?? t('shotTemplate.selectTemplate')}
              </span>
              <ChevronDown className="w-3 h-3 text-muted-foreground" />
            </button>
            {templateDropdownOpen && (
              <div className="absolute z-50 mt-1 w-full rounded-md border border-border/60 bg-popover shadow-lg overflow-hidden">
                {visibleBuiltInTemplates.length > 0 && (
                  <div>
                    <div className="px-2 py-1 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider bg-muted/40">
                      {t('shotTemplate.builtIn')}
                    </div>
                    {visibleBuiltInTemplates.map((template) => (
                      <button
                        key={template.id}
                        className="w-full text-left px-2 py-1 hover:bg-muted/50 transition-colors"
                        onClick={() => onApplyTemplate(template)}
                      >
                        <div className="text-[11px] font-medium">
                          {localizeShotTemplateName(template.id, template.name)}
                        </div>
                        <div className="text-[10px] text-muted-foreground truncate">
                          {localizeShotTemplateDescription(template.id, template.description)}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
                {visibleCustomTemplates.length > 0 && (
                  <div>
                    <div className="px-2 py-1 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider bg-muted/40 border-t border-border/50">
                      {t('shotTemplate.custom')}
                    </div>
                    {visibleCustomTemplates.map((template) => (
                      <button
                        key={template.id}
                        className="w-full text-left px-2 py-1 hover:bg-muted/50 transition-colors"
                        onClick={() => onApplyTemplate(template)}
                      >
                        <div className="text-[11px] font-medium">{template.name}</div>
                        {template.description ? (
                          <div className="text-[10px] text-muted-foreground truncate">{template.description}</div>
                        ) : null}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="pt-0.5">
            <div className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
              {t('inspector.presetTracks')}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-1.5">{trackGrid}</div>
        </div>
      ) : null}

      {selectedNodeType === 'audio' && (
        <div className="px-3 py-3 border-b border-border/60">
          <div className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-1">
            {t('inspector.audioType')}
          </div>
          <span className="text-xs capitalize">{audioType ?? 'voice'}</span>
        </div>
      )}

      {selectedNodeType === 'backdrop' && backdropControls ? (
        <>
          <div className="px-3 py-3 border-b border-border/60 space-y-3">
            <div className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
              {t('inspector.backdrop.appearance')}
            </div>

            <div className="space-y-1.5">
              <label className="text-[11px] text-muted-foreground">{t('inspector.backdrop.color')}</label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={backdropControls.data.color ?? '#334155'}
                  onChange={(event) => backdropControls.onColorChange(event.target.value)}
                  className="h-6 w-6 shrink-0 cursor-pointer rounded-md border border-border/60 bg-transparent p-0"
                />
                <input
                  type="text"
                  value={backdropControls.data.color ?? '#334155'}
                  onChange={(event) => backdropControls.onColorInputChange(event.target.value)}
                  className="w-18 bg-muted px-1.5 py-0.5 rounded-md text-[11px] font-mono"
                  placeholder="#334155"
                />
              </div>
              <div className="flex items-center gap-1">
                {backdropControls.swatches.map((swatch) => (
                  <button
                    key={swatch}
                    type="button"
                    className={cn(
                      'h-5 w-5 rounded-full border transition-transform hover:scale-110',
                      backdropControls.data.color === swatch
                        ? 'border-primary ring-1 ring-primary'
                        : 'border-border/50',
                    )}
                    style={{ backgroundColor: swatch }}
                    onClick={() => backdropControls.onColorChange(swatch)}
                  />
                ))}
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-[11px] text-muted-foreground">{t('inspector.backdrop.opacity')}</label>
              <div className="flex items-center gap-2">
                <CommitSlider
                  min={5}
                  max={100}
                  step={5}
                  value={Math.round((backdropControls.data.opacity ?? 0.14) * 100)}
                  onCommit={(v) => backdropControls.onOpacityChange(v / 100)}
                  className="flex-1 h-1.5 accent-primary"
                />
                <span className="text-[11px] text-muted-foreground w-8 text-right">
                  {Math.round((backdropControls.data.opacity ?? 0.14) * 100)}%
                </span>
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-[11px] text-muted-foreground">{t('inspector.backdrop.borderStyle')}</label>
              <div className="flex items-center gap-1">
                {(['dashed', 'solid', 'dotted'] as const).map((style) => (
                  <button
                    key={style}
                    className={cn(
                      'flex-1 py-1 rounded-md text-[11px] border font-medium',
                      (backdropControls.data.borderStyle ?? 'dashed') === style
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-border/60 hover:bg-muted',
                    )}
                    onClick={() => backdropControls.onBorderStyleChange(style)}
                  >
                    {t(`inspector.backdrop.${style}`)}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-[11px] text-muted-foreground">{t('inspector.backdrop.titleSize')}</label>
              <div className="flex items-center gap-1">
                {(['sm', 'md', 'lg'] as const).map((size) => (
                  <button
                    key={size}
                    className={cn(
                      'flex-1 py-1 rounded-md text-[11px] border font-medium',
                      (backdropControls.data.titleSize ?? 'md') === size
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-border/60 hover:bg-muted',
                    )}
                    onClick={() => backdropControls.onTitleSizeChange(size)}
                  >
                    {size === 'sm' ? 'S' : size === 'md' ? 'M' : 'L'}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="px-3 py-3 border-b border-border/60 space-y-3">
            <div className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
              {t('inspector.backdrop.behavior')}
            </div>

            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={backdropControls.data.lockChildren ?? false}
                onChange={(event) => backdropControls.onLockChildrenChange(event.target.checked)}
              />
              <span className="text-[11px]">{t('inspector.backdrop.lockChildren')}</span>
            </label>

            <button
              type="button"
              className="flex items-center gap-1 rounded-md border border-border/60 px-2.5 py-1 text-[11px] hover:bg-muted"
              onClick={backdropControls.onAutoArrange}
            >
              <LayoutGrid className="w-3 h-3" />
              {t('inspector.backdrop.autoArrange')}
            </button>

            <div className="text-[10px] text-muted-foreground/70 italic">Collapse hides child nodes</div>
          </div>
        </>
      ) : null}
    </>
  );
});
