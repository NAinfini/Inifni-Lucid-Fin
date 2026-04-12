import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/Dialog.js';
import { cn } from '../../lib/utils.js';
import { useI18n } from '../../hooks/use-i18n.js';
import { localizePresetName } from '../../i18n.js';
import { InspectorTrackEditor } from './InspectorTrackEditor.js';
import type { PresetCategory, PresetDefinition, PresetTrack } from '@lucid-fin/contracts';

const CATEGORY_ACCENT: Record<string, string> = {
  camera: 'bg-blue-500',
  lens: 'bg-sky-500',
  look: 'bg-purple-500',
  scene: 'bg-amber-500',
  composition: 'bg-violet-500',
  emotion: 'bg-rose-500',
  flow: 'bg-teal-500',
  technical: 'bg-indigo-500',
};

interface InspectorTrackGridCellProps {
  nodeId: string;
  category: PresetCategory;
  presets: PresetDefinition[];
  presetById: Record<string, PresetDefinition>;
  track: PresetTrack;
}

export function InspectorTrackGridCell({
  nodeId,
  category,
  presets,
  presetById,
  track,
}: InspectorTrackGridCellProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const hasEntries = track.entries.length > 0;
  const accent = CATEGORY_ACCENT[category] ?? 'bg-muted-foreground';
  const previewNames = track.entries.slice(0, 2).map((entry) => {
    const preset = presetById[entry.presetId];
    return preset ? localizePresetName(preset.name) : entry.presetId.slice(0, 6);
  });

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          'relative flex flex-col gap-1 overflow-hidden rounded-md border text-left transition-colors hover:bg-muted/40',
          hasEntries ? 'border-primary/30 bg-primary/5' : 'border-border/50 bg-muted/10',
        )}
      >
        <div className={cn('absolute bottom-0 left-0 top-0 w-0.5 rounded-l-md', accent)} />

        <div className="w-full pl-2.5 pr-1.5 pb-1.5 pt-2">
          <div className="mb-1 flex items-center justify-between gap-1">
            <span className="truncate text-[11px] font-semibold leading-none text-foreground">
              {t('presetCategory.' + category)}
            </span>
          </div>

          {hasEntries ? (
            <div className="flex flex-wrap gap-1">
              {previewNames.map((name, index) => (
                <span
                  key={`${name}-${index}`}
                  className="max-w-full truncate rounded-md bg-primary/10 px-1.5 py-0.5 text-[10px] leading-none text-primary"
                >
                  {name}
                </span>
              ))}
              {track.entries.length > 2 ? (
                <span className="rounded-md bg-muted px-1.5 py-0.5 text-[10px] leading-none text-muted-foreground">
                  +{track.entries.length - 2}
                </span>
              ) : null}
            </div>
          ) : (
            <span className="text-[10px] leading-none text-muted-foreground/60">
              {t('inspector.empty')}
            </span>
          )}
        </div>
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[85vh] max-w-lg overflow-auto">
          <DialogHeader>
            <DialogTitle>
              {t('inspector.categoryPresetsTitle').replace(
                '{category}',
                t('presetCategory.' + category),
              )}
            </DialogTitle>
          </DialogHeader>
          <InspectorTrackEditor
            nodeId={nodeId}
            category={category}
            presets={presets}
            presetById={presetById}
            track={track}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}
