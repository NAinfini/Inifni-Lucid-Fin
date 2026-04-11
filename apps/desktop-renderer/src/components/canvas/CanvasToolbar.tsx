import { useState, type ReactNode } from 'react';
import { Download, Film, Grid2X2, Map, Palette, Search, Upload } from 'lucide-react';
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

interface StyleGuideIndicatorProps {
  artStyle?: string;
  lighting?: string;
  freeformDescription?: string;
  onOpenSettings?: () => void;
}

function StyleGuideIndicator({ artStyle, lighting, freeformDescription, onOpenSettings }: StyleGuideIndicatorProps) {
  const [expanded, setExpanded] = useState(false);
  const hasContent = Boolean(artStyle || freeformDescription);
  if (!hasContent) return null;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex items-center gap-1 rounded-md border border-border/60 bg-muted/40 px-2 py-1 text-[10px] text-muted-foreground hover:bg-muted/60 transition-colors max-w-[160px]"
        title={t('canvas.styleGuide')}
      >
        <Palette className="h-3 w-3 shrink-0 text-primary/70" />
        <span className="truncate">{artStyle || t('canvas.styleGuide')}</span>
      </button>
      {expanded && (
        <div className="absolute right-0 top-full mt-1 z-50 w-64 rounded-lg border border-border/60 bg-card/95 p-3 shadow-lg backdrop-blur-sm">
          <div className="space-y-2">
            {artStyle && (
              <div>
                <span className="text-[10px] font-medium text-muted-foreground uppercase">{t('canvas.styleGuideArt')}</span>
                <p className="text-[11px] text-foreground">{artStyle}</p>
              </div>
            )}
            {lighting && (
              <div>
                <span className="text-[10px] font-medium text-muted-foreground uppercase">{t('canvas.styleGuideLighting')}</span>
                <p className="text-[11px] text-foreground capitalize">{lighting}</p>
              </div>
            )}
            {freeformDescription && (
              <div>
                <span className="text-[10px] font-medium text-muted-foreground uppercase">{t('canvas.styleGuideDesc')}</span>
                <p className="text-[11px] text-foreground line-clamp-4">{freeformDescription}</p>
              </div>
            )}
            {onOpenSettings && (
              <button
                type="button"
                onClick={() => { setExpanded(false); onOpenSettings(); }}
                className="mt-1 w-full rounded-md border border-border/60 py-1 text-[10px] text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
              >
                {t('canvas.editStyleGuide')}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
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
  onCloneVideo: () => void;
  styleGuide?: StyleGuideIndicatorProps;
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
  onCloneVideo,
  styleGuide,
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
    {
      id: 'clone-video',
      label: t('canvas.cloneVideo'),
      icon: <Film className="h-3.5 w-3.5" />,
      onClick: onCloneVideo,
    },
  ];

  return (
    <TooltipProvider delayDuration={120}>
      <div className="absolute right-3 top-3 z-30 flex items-center gap-1.5">
        <div className="flex items-center gap-1.5 rounded-md border border-border/60 bg-card/95 p-1.5 shadow-lg backdrop-blur-sm">
        {styleGuide && <StyleGuideIndicator {...styleGuide} />}
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
      </div>
    </TooltipProvider>
  );
}
