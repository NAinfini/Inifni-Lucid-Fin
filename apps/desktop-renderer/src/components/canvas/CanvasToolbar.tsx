import type { ReactNode } from 'react';
import { Download, Grid2X2, Map, Search, Upload } from 'lucide-react';
import { cn } from '../../lib/utils.js';
import { t } from '../../i18n.js';
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
        'inline-flex h-8 w-8 items-center justify-center rounded-md transition-colors',
        active
          ? 'bg-primary/12 text-primary'
          : 'text-muted-foreground hover:bg-muted hover:text-foreground',
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
  const buttons = [
    {
      id: 'search',
      active: searchOpen,
      label: t('canvas.openSearch'),
      icon: <Search className="h-3.5 w-3.5" />,
      onClick: onToggleSearch,
    },
    {
      id: 'minimap',
      active: minimapVisible,
      label: t('canvas.toggleMinimap'),
      icon: <Map className="h-3.5 w-3.5" />,
      onClick: onToggleMinimap,
    },
    {
      id: 'grid',
      active: snapToGrid,
      label: t('canvas.toggleSnapToGrid'),
      icon: <Grid2X2 className="h-3.5 w-3.5" />,
      onClick: onToggleSnapToGrid,
    },
    {
      id: 'export',
      label: t('canvas.exportWorkflow'),
      icon: <Download className="h-3.5 w-3.5" />,
      onClick: onExportWorkflow,
    },
    {
      id: 'import',
      label: t('canvas.importWorkflow'),
      icon: <Upload className="h-3.5 w-3.5" />,
      onClick: onImportWorkflow,
    },
  ];

  return (
    <TooltipProvider delayDuration={120}>
      <div className="absolute right-3 top-3 z-30 flex items-center gap-1.5 rounded-md border border-border/60 bg-card/95 p-1.5 shadow-lg backdrop-blur-sm">
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
