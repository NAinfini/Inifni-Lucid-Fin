import type { ReactNode } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { Download, Grid2X2, Map, Search, ScrollText, Upload } from 'lucide-react';
import { cn } from '../../lib/utils.js';
import { t } from '../../i18n.js';
import type { RootState } from '../../store/index.js';
import { toggleRightPanel } from '../../store/slices/ui.js';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '../ui/Tooltip.js';

interface ToolbarButtonProps {
  active?: boolean;
  ariaLabel: string;
  icon: ReactNode;
  onClick: () => void;
}

function ToolbarButton({ active = false, ariaLabel, icon, onClick }: ToolbarButtonProps) {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'inline-flex h-10 w-10 items-center justify-center rounded-xl border transition-colors',
        active
          ? 'border-primary bg-primary/10 text-primary'
          : 'border-border bg-card/95 text-muted-foreground hover:border-primary/40 hover:text-foreground',
      )}
    >
      {icon}
    </button>
  );
}

interface CanvasToolbarProps {
  minimapVisible: boolean;
  snapToGrid: boolean;
  searchOpen: boolean;
  onToggleSearch: () => void;
  onToggleMinimap: () => void;
  onToggleSnapToGrid: () => void;
  onExportWorkflow: () => void;
  onImportWorkflow: () => void;
}

export function CanvasToolbar({
  minimapVisible,
  snapToGrid,
  searchOpen,
  onToggleSearch,
  onToggleMinimap,
  onToggleSnapToGrid,
  onExportWorkflow,
  onImportWorkflow,
}: CanvasToolbarProps) {
  const dispatch = useDispatch();
  const loggerOpen = useSelector((s: RootState) => s.ui.rightPanel === 'logger');
  const buttons = [
    {
      id: 'search',
      active: searchOpen,
      label: t('canvas.openSearch'),
      icon: <Search className="h-4 w-4" />,
      onClick: onToggleSearch,
    },
    {
      id: 'minimap',
      active: minimapVisible,
      label: t('canvas.toggleMinimap'),
      icon: <Map className="h-4 w-4" />,
      onClick: onToggleMinimap,
    },
    {
      id: 'grid',
      active: snapToGrid,
      label: t('canvas.toggleSnapToGrid'),
      icon: <Grid2X2 className="h-4 w-4" />,
      onClick: onToggleSnapToGrid,
    },
    {
      id: 'export',
      label: t('canvas.exportWorkflow'),
      icon: <Download className="h-4 w-4" />,
      onClick: onExportWorkflow,
    },
    {
      id: 'import',
      label: t('canvas.importWorkflow'),
      icon: <Upload className="h-4 w-4" />,
      onClick: onImportWorkflow,
    },
    {
      id: 'logger',
      active: loggerOpen,
      label: t('logger.title'),
      icon: <ScrollText className="h-4 w-4" />,
      onClick: () => dispatch(toggleRightPanel('logger')),
    },
  ];

  return (
    <TooltipProvider delayDuration={120}>
      <div className="absolute right-4 top-4 z-30 flex items-center gap-2 rounded-2xl border border-border/70 bg-background/90 p-2 shadow-xl backdrop-blur">
        {buttons.map((button) => (
          <Tooltip key={button.id}>
            <TooltipTrigger asChild>
              <div>
                <ToolbarButton
                  active={button.active}
                  ariaLabel={button.label}
                  icon={button.icon}
                  onClick={button.onClick}
                />
              </div>
            </TooltipTrigger>
            <TooltipContent side="bottom">{button.label}</TooltipContent>
          </Tooltip>
        ))}
      </div>
    </TooltipProvider>
  );
}
