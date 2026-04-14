import { useCallback } from 'react';
import { setNodeAdvancedParams } from '../../../../store/slices/canvas.js';
import { LazyDetails } from '../../LazyDetails.js';
import { CommitSlider } from '../../../ui/CommitSlider.js';
import type { InspectorSectionProps } from '../inspector-registry.js';
import type { ImageNodeData, VideoNodeData, AudioNodeData } from '@lucid-fin/contracts';

/**
 * Advanced Generation Params section (L17) -- renders for image/video nodes.
 * Controls negative prompt, steps, cfg scale, scheduler, and img2img strength.
 */
export function AdvancedParamsSection({ node, dispatch, t }: InspectorSectionProps) {
  const generationData = node.data as ImageNodeData | VideoNodeData | AudioNodeData;

  const handleNegativePromptChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      dispatch(
        setNodeAdvancedParams({
          id: node.id,
          negativePrompt: e.target.value,
        }),
      );
    },
    [dispatch, node.id],
  );

  const handleStepsChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      dispatch(
        setNodeAdvancedParams({
          id: node.id,
          steps: e.target.value ? Number(e.target.value) : undefined,
        }),
      );
    },
    [dispatch, node.id],
  );

  const handleCfgScaleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      dispatch(
        setNodeAdvancedParams({
          id: node.id,
          cfgScale: e.target.value ? Number(e.target.value) : undefined,
        }),
      );
    },
    [dispatch, node.id],
  );

  const handleSchedulerChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      dispatch(
        setNodeAdvancedParams({
          id: node.id,
          scheduler: e.target.value || undefined,
        }),
      );
    },
    [dispatch, node.id],
  );

  const handleImg2ImgStrengthCommit = useCallback(
    (v: number) => {
      dispatch(
        setNodeAdvancedParams({
          id: node.id,
          img2imgStrength: v / 100,
        }),
      );
    },
    [dispatch, node.id],
  );

  return (
    <div className="px-3 py-2 border-b border-border/60">
      <LazyDetails
        className="group"
        summary={
          <summary className="flex cursor-pointer items-center gap-1 text-[11px] font-medium text-muted-foreground uppercase tracking-wider select-none">
            <span className="transition-transform group-open:rotate-90">&#9654;</span>
            {t('inspector.advancedParams')}
          </summary>
        }
      >
        <div className="mt-1.5 space-y-1.5">
          <div>
            <label className="text-[10px] text-muted-foreground">
              {t('inspector.negativePrompt')}
            </label>
            <textarea
              className="w-full rounded-md border border-border/60 bg-muted px-2 py-1 text-[11px] outline-none focus:ring-1 focus:ring-ring min-h-[40px] resize-y"
              placeholder={t('inspector.negativePromptPlaceholder')}
              value={(generationData as { negativePrompt?: string })?.negativePrompt ?? ''}
              onChange={handleNegativePromptChange}
            />
          </div>
          <div className="grid grid-cols-3 gap-1.5">
            <div>
              <label className="text-[10px] text-muted-foreground">
                {t('inspector.steps')}
              </label>
              <input
                type="number"
                min={1}
                max={150}
                className="w-full rounded-md border border-border/60 bg-muted px-1.5 py-0.5 text-[10px] outline-none"
                value={(generationData as { steps?: number })?.steps ?? ''}
                onChange={handleStepsChange}
              />
            </div>
            <div>
              <label className="text-[10px] text-muted-foreground">
                {t('inspector.cfgScale')}
              </label>
              <input
                type="number"
                min={1}
                max={30}
                step={0.5}
                className="w-full rounded-md border border-border/60 bg-muted px-1.5 py-0.5 text-[10px] outline-none"
                value={(generationData as { cfgScale?: number })?.cfgScale ?? ''}
                onChange={handleCfgScaleChange}
              />
            </div>
            <div>
              <label className="text-[10px] text-muted-foreground">
                {t('inspector.scheduler')}
              </label>
              <input
                type="text"
                className="w-full rounded-md border border-border/60 bg-muted px-1.5 py-0.5 text-[10px] outline-none"
                placeholder="euler_a"
                value={(generationData as { scheduler?: string })?.scheduler ?? ''}
                onChange={handleSchedulerChange}
              />
            </div>
          </div>
          {/* Image-to-image strength */}
          {(generationData as { sourceImageHash?: string })?.sourceImageHash && (
            <div>
              <label className="text-[10px] text-muted-foreground">
                {t('inspector.img2imgStrength')}
              </label>
              <div className="flex items-center gap-2">
                <CommitSlider
                  min={0}
                  max={100}
                  value={Math.round(
                    ((generationData as { img2imgStrength?: number })?.img2imgStrength ?? 0.75) *
                      100,
                  )}
                  onCommit={handleImg2ImgStrengthCommit}
                  className="flex-1 h-1.5 accent-primary"
                />
                <span className="text-[10px] text-muted-foreground w-8 text-right">
                  {Math.round(
                    ((generationData as { img2imgStrength?: number })?.img2imgStrength ?? 0.75) *
                      100,
                  )}
                  %
                </span>
              </div>
            </div>
          )}
        </div>
      </LazyDetails>
    </div>
  );
}
