import type { ChangeEventHandler, ReactNode } from 'react';
import { Dice5, Trash2, Upload } from 'lucide-react';
import { cn } from '../../lib/utils.js';
import type { CanvasNode } from '@lucid-fin/contracts';

type Translate = (key: string) => string;

interface SelectOption {
  value: string;
  label: string;
}

interface ProviderOption {
  id: string;
  name: string;
}

interface ResolutionGroupOption {
  label: string;
  options: SelectOption[];
}

interface VideoFramesSection {
  firstOptions: SelectOption[];
  lastOptions: SelectOption[];
  selectedFirstId?: string;
  selectedLastId?: string;
  firstPreview?: ReactNode;
  lastPreview?: ReactNode;
  onFirstChange: (value: string | undefined) => void;
  onLastChange: (value: string | undefined) => void;
}

interface UploadSection {
  hasAsset: boolean;
  onUpload: () => void | Promise<void>;
  onClear: () => void;
}

interface GenerationSection {
  providerOptions: ProviderOption[];
  activeProviderId?: string;
  providerLoading: boolean;
  onProviderChange: ChangeEventHandler<HTMLSelectElement>;
  variantOptions: readonly number[];
  activeVariantCount: number;
  onVariantCountChange: (count: number) => void;
  resolutionGroups?: ResolutionGroupOption[];
  resolutionValue?: string | null;
  customResolutionValue: string;
  widthValue?: number;
  heightValue?: number;
  onResolutionChange?: ChangeEventHandler<HTMLSelectElement>;
  onWidthChange?: ChangeEventHandler<HTMLInputElement>;
  onHeightChange?: ChangeEventHandler<HTMLInputElement>;
  durationOptions?: readonly number[];
  durationValue?: string | null;
  onDurationChange?: ChangeEventHandler<HTMLSelectElement>;
  durationInputValue?: number;
  onDurationInputChange?: ChangeEventHandler<HTMLInputElement>;
  fpsOptions?: readonly number[];
  fpsValue?: number;
  onFpsChange?: ChangeEventHandler<HTMLSelectElement>;
  seedValue?: number;
  seedLocked: boolean;
  onSeedChange: ChangeEventHandler<HTMLInputElement>;
  onRandomizeSeed: () => void;
  onToggleSeedLock: () => void;
  estimatedCost?: string;
  variantGrid?: ReactNode;
  isGenerating: boolean;
  hasVariants: boolean;
  onGenerate: () => void | Promise<void>;
  onCancel: () => void | Promise<void>;
}

interface InspectorTechnicalTabProps {
  t: Translate;
  selectedNode: CanvasNode;
  videoFramesSection?: VideoFramesSection;
  uploadSection?: UploadSection;
  generationSection?: GenerationSection;
  metadataCreatedAt: string;
  metadataUpdatedAt: string;
  generationTimeMs?: number;
}

export function InspectorTechnicalTab({
  t,
  selectedNode,
  videoFramesSection,
  uploadSection,
  generationSection,
  metadataCreatedAt,
  metadataUpdatedAt,
  generationTimeMs,
}: InspectorTechnicalTabProps) {
  return (
    <>
      {selectedNode.type === 'video' && videoFramesSection ? (
        <div className="px-3 py-3 border-b border-border/60 space-y-3">
          <div className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
            {t('inspector.frames')}
          </div>

          <div className="space-y-1.5">
            <div className="text-[11px] text-muted-foreground">{t('inspector.firstFrame')}</div>
            {videoFramesSection.firstOptions.length === 0 ? (
              <div className="text-[11px] text-muted-foreground italic">{t('inspector.noConnectedImages')}</div>
            ) : (
              <div className="flex items-center gap-2">
                {videoFramesSection.firstPreview}
                {videoFramesSection.firstOptions.length > 1 ? (
                  <select
                    value={videoFramesSection.selectedFirstId ?? ''}
                    onChange={(event) => videoFramesSection.onFirstChange(event.target.value || undefined)}
                    className="flex-1 text-[11px] rounded-md border border-border/60 bg-background px-1.5 py-0.5 outline-none"
                  >
                    <option value="">{t('inspector.select')}</option>
                    {videoFramesSection.firstOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                ) : null}
              </div>
            )}
          </div>

          <div className="space-y-1.5">
            <div className="text-[11px] text-muted-foreground">{t('inspector.lastFrame')}</div>
            {videoFramesSection.lastOptions.length === 0 ? (
              <div className="text-[11px] text-muted-foreground italic">{t('inspector.noConnectedImages')}</div>
            ) : (
              <div className="flex items-center gap-2">
                {videoFramesSection.lastPreview}
                {videoFramesSection.lastOptions.length > 1 ? (
                  <select
                    value={videoFramesSection.selectedLastId ?? ''}
                    onChange={(event) => videoFramesSection.onLastChange(event.target.value || undefined)}
                    className="flex-1 text-[11px] rounded-md border border-border/60 bg-background px-1.5 py-0.5 outline-none"
                  >
                    <option value="">{t('inspector.select')}</option>
                    {videoFramesSection.lastOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                ) : null}
              </div>
            )}
          </div>
        </div>
      ) : null}

      {(selectedNode.type === 'image' || selectedNode.type === 'video') && uploadSection ? (
        <div className="px-3 py-3 border-b border-border/60 space-y-1.5">
          <div className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
            {t('inspector.media')}
          </div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              className="flex items-center gap-1 rounded-md border border-border/60 px-2.5 py-1 text-[11px] hover:bg-muted"
              onClick={() => void uploadSection.onUpload()}
            >
              <Upload className="w-3 h-3" />
              {uploadSection.hasAsset ? t('inspector.replace') : t('inspector.upload')}
            </button>
            {uploadSection.hasAsset ? (
              <button
                type="button"
                className="flex items-center gap-1 rounded-md border border-destructive/50 px-2.5 py-1 text-[11px] text-destructive hover:bg-destructive/10"
                onClick={uploadSection.onClear}
              >
                <Trash2 className="w-3 h-3" />
                {t('inspector.clear')}
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      {generationSection ? (
        <div className="px-3 py-3 border-b border-border/60 space-y-3">
          <div className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
            {t('inspector.generationLabel')}
          </div>

          <div className="space-y-1">
            <label className="text-[11px] text-muted-foreground">{t('generation.provider')}</label>
            <select
              value={generationSection.activeProviderId ?? ''}
              onChange={generationSection.onProviderChange}
              onMouseDown={(event) => event.stopPropagation()}
              onPointerDown={(event) => event.stopPropagation()}
              className="w-full bg-muted px-2.5 py-1.5 rounded-md text-xs"
              disabled={generationSection.providerLoading}
            >
              {generationSection.activeProviderId ? null : (
                <option value="">{t('inspector.selectProvider')}</option>
              )}
              {generationSection.providerOptions.map((provider) => (
                <option key={provider.id} value={provider.id}>
                  {provider.name}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1">
            <label className="text-[11px] text-muted-foreground">{t('generation.variantCount')}</label>
            <div className="flex items-center gap-1">
              {generationSection.variantOptions.map((count) => (
                <button
                  key={count}
                  className={cn(
                    'flex-1 py-1 rounded-md text-[11px] border font-medium',
                    generationSection.activeVariantCount === count
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-border/60 hover:bg-muted',
                  )}
                  onClick={() => generationSection.onVariantCountChange(count)}
                >
                  {count}
                </button>
              ))}
            </div>
          </div>

          {generationSection.resolutionGroups && generationSection.onResolutionChange ? (
            <div className="space-y-1">
              <label className="text-[11px] text-muted-foreground">{t('export.resolution')}</label>
              <select
                value={generationSection.resolutionValue ?? generationSection.customResolutionValue}
                onChange={generationSection.onResolutionChange}
                className="w-full bg-muted px-2.5 py-1.5 rounded-md text-xs"
              >
                {generationSection.resolutionGroups.map((group) => (
                  <optgroup key={group.label} label={group.label}>
                    {group.options.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </optgroup>
                ))}
                <option value={generationSection.customResolutionValue}>Custom</option>
              </select>
              {generationSection.resolutionValue === generationSection.customResolutionValue &&
              generationSection.onWidthChange &&
              generationSection.onHeightChange ? (
                <div className="grid grid-cols-2 gap-1.5">
                  <input
                    type="number"
                    min={1}
                    className="w-full bg-muted px-2.5 py-1.5 rounded-md text-xs"
                    value={generationSection.widthValue ?? ''}
                    onChange={generationSection.onWidthChange}
                    placeholder="W"
                  />
                  <input
                    type="number"
                    min={1}
                    className="w-full bg-muted px-2.5 py-1.5 rounded-md text-xs"
                    value={generationSection.heightValue ?? ''}
                    onChange={generationSection.onHeightChange}
                    placeholder="H"
                  />
                </div>
              ) : null}
            </div>
          ) : null}

          {selectedNode.type === 'video' && generationSection.durationOptions && generationSection.onDurationChange ? (
            <div className="space-y-1">
              <label className="text-[11px] text-muted-foreground">{t('node.duration')}</label>
              <select
                value={generationSection.durationValue ?? generationSection.customResolutionValue}
                onChange={generationSection.onDurationChange}
                className="w-full bg-muted px-2.5 py-1.5 rounded-md text-xs"
              >
                {generationSection.durationOptions.map((duration) => (
                  <option key={duration} value={duration}>
                    {duration}s
                  </option>
                ))}
                <option value={generationSection.customResolutionValue}>Custom</option>
              </select>
              {generationSection.durationValue === generationSection.customResolutionValue &&
              generationSection.onDurationInputChange ? (
                <input
                  type="number"
                  min={1}
                  max={60}
                  className="w-full bg-muted px-2.5 py-1.5 rounded-md text-xs"
                  value={generationSection.durationInputValue ?? ''}
                  onChange={generationSection.onDurationInputChange}
                />
              ) : null}
            </div>
          ) : null}

          {selectedNode.type === 'video' && generationSection.fpsOptions && generationSection.onFpsChange ? (
            <div className="space-y-1">
              <label className="text-[11px] text-muted-foreground">{t('export.fps')}</label>
              <select
                value={String(generationSection.fpsValue ?? generationSection.fpsOptions[0])}
                onChange={generationSection.onFpsChange}
                className="w-full bg-muted px-2.5 py-1.5 rounded-md text-xs"
              >
                {generationSection.fpsOptions.map((fps) => (
                  <option key={fps} value={fps}>
                    {fps}fps
                  </option>
                ))}
              </select>
            </div>
          ) : null}

          <div className="space-y-1">
            <label className="text-[11px] text-muted-foreground">{t('generation.seed')}</label>
            <div className="flex items-center gap-1">
              <input
                type="number"
                className="flex-1 bg-muted px-2.5 py-1 rounded-md text-xs"
                value={generationSection.seedValue ?? ''}
                onChange={generationSection.onSeedChange}
              />
              <button
                type="button"
                className="px-2 py-1 rounded-md border border-border/60 text-xs hover:bg-muted"
                onClick={generationSection.onRandomizeSeed}
                aria-label="Randomize seed"
                title="Randomize seed"
              >
                <Dice5 className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                className={cn(
                  'px-2.5 py-1 rounded-md border text-[11px] font-medium',
                  generationSection.seedLocked
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border/60 hover:bg-muted',
                )}
                onClick={generationSection.onToggleSeedLock}
              >
                {generationSection.seedLocked ? t('inspector.locked') : t('inspector.lock')}
              </button>
            </div>
          </div>

          {generationSection.estimatedCost ? (
            <div className="text-xs text-muted-foreground">{generationSection.estimatedCost}</div>
          ) : null}

          {generationSection.variantGrid ? (
            <div className="space-y-1">
              <label className="text-[11px] text-muted-foreground">{t('generation.variants')}</label>
              <div className="grid grid-cols-4 gap-1">{generationSection.variantGrid}</div>
            </div>
          ) : null}

          <div className="flex items-center gap-1.5">
            <button
              className="flex-1 py-1.5 rounded-md bg-primary text-primary-foreground text-xs font-medium disabled:opacity-50"
              onClick={() => void generationSection.onGenerate()}
              disabled={generationSection.isGenerating}
            >
              {generationSection.hasVariants ? t('generation.regenerate') : t('generation.generate')}
            </button>
            <button
              className="px-2.5 py-1.5 rounded-md border border-border/60 text-xs hover:bg-muted disabled:opacity-50"
              onClick={() => void generationSection.onCancel()}
              disabled={!generationSection.isGenerating}
            >
              {t('generation.cancel')}
            </button>
          </div>
        </div>
      ) : null}

      <div className="px-3 py-3">
        <div className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-1.5">
          {t('inspector.metadata')}
        </div>
        <div className="text-[11px] text-muted-foreground space-y-0.5">
          <div>{t('inspector.id')}: {selectedNode.id.slice(0, 8)}...</div>
          <div>{t('inspector.created')}: {metadataCreatedAt}</div>
          <div>{t('inspector.updated')}: {metadataUpdatedAt}</div>
          {generationTimeMs != null && (
            <div>
              {t('inspector.generatedIn').replace(
                '{time}',
                `${(generationTimeMs / 1000).toFixed(1)}s`,
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
