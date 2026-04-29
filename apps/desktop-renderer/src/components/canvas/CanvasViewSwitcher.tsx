import { useDispatch, useSelector } from 'react-redux';
import { Layers, PenSquare, Music, Grid3x3 } from 'lucide-react';
import { cn } from '../../lib/utils.js';
import { useI18n } from '../../hooks/use-i18n.js';
import type { AppDispatch, RootState } from '../../store/index.js';
import { setCanvasViewMode, type CanvasViewMode } from '../../store/slices/ui.js';
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/Tooltip.js';

const VIEW_BUTTONS: Array<{ mode: CanvasViewMode; icon: typeof Layers; labelKey: string }> = [
  { mode: 'main', icon: Layers, labelKey: 'view.main' },
  { mode: 'edit', icon: PenSquare, labelKey: 'view.editLabel' },
  { mode: 'audio', icon: Music, labelKey: 'view.audioLabel' },
  { mode: 'materials', icon: Grid3x3, labelKey: 'view.materialsLabel' },
];

export function CanvasViewSwitcher() {
  const dispatch = useDispatch<AppDispatch>();
  const { t } = useI18n();
  const canvasViewMode = useSelector((s: RootState) => s.ui.canvasViewMode);

  return (
    <div
      className="flex items-center gap-0.5 rounded-md border border-border/60 bg-card/95 p-0.5 shadow-sm backdrop-blur-sm"
      aria-label={t('view.switcherLabel')}
    >
      {VIEW_BUTTONS.map(({ mode, icon: Icon, labelKey }) => {
        const label = t(labelKey);
        return (
          <Tooltip key={mode}>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label={label}
                aria-pressed={canvasViewMode === mode}
                onClick={() => dispatch(setCanvasViewMode(mode))}
                className={cn(
                  'inline-flex h-7 w-7 items-center justify-center rounded transition-colors',
                  canvasViewMode === mode
                    ? 'bg-primary/12 text-primary'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                )}
              >
                <Icon className="h-3.5 w-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom">{label}</TooltipContent>
          </Tooltip>
        );
      })}
    </div>
  );
}
