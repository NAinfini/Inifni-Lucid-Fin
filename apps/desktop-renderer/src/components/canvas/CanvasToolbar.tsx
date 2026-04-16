import { forwardRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Download, Grid2X2, Map, Palette, Redo2, Search, Undo2, Upload } from 'lucide-react';
import { cn } from '../../lib/utils.js';
import { t } from '../../i18n.js';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '../ui/Tooltip.js';

interface ToolbarButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  active?: boolean;
  ariaLabel: string;
  icon: ReactNode;
}

const ToolbarButton = forwardRef<HTMLButtonElement, ToolbarButtonProps>(
  ({ active = false, ariaLabel, className, icon, type = 'button', ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      aria-label={ariaLabel}
      aria-pressed={active}
      className={cn(
        'inline-flex h-8 w-8 items-center justify-center rounded-md transition-colors',
        props.disabled
          ? 'cursor-not-allowed text-muted-foreground/30'
          : active
            ? 'bg-primary/12 text-primary'
            : 'text-muted-foreground hover:bg-muted hover:text-foreground',
        className,
      )}
      {...props}
    >
      {icon}
    </button>
  ),
);
ToolbarButton.displayName = 'ToolbarButton';

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
  onUndo: () => void;
  onRedo: () => void;
  undoEnabled: boolean;
  redoEnabled: boolean;
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
  onUndo,
  onRedo,
  undoEnabled,
  redoEnabled,
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
  ];

  return (
    <TooltipProvider delayDuration={120}>
      <div className="absolute right-3 top-3 z-30 flex items-center gap-1.5">
        <div role="toolbar" aria-label="Undo / Redo" className="flex items-center gap-0.5 rounded-md border border-border/60 bg-card/95 p-1.5 shadow-lg backdrop-blur-sm">
          <Tooltip>
            <TooltipTrigger asChild>
              <ToolbarButton
                disabled={!undoEnabled}
                ariaLabel={t('canvas.undo')}
                icon={<Undo2 className="h-3.5 w-3.5" />}
                onClick={onUndo}
              />
            </TooltipTrigger>
            <TooltipContent side="bottom">{t('canvas.undo')}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <ToolbarButton
                disabled={!redoEnabled}
                ariaLabel={t('canvas.redo')}
                icon={<Redo2 className="h-3.5 w-3.5" />}
                onClick={onRedo}
              />
            </TooltipTrigger>
            <TooltipContent side="bottom">{t('canvas.redo')}</TooltipContent>
          </Tooltip>
        </div>
        <div role="toolbar" aria-label="Canvas tools" className="flex items-center gap-1.5 rounded-md border border-border/60 bg-card/95 p-1.5 shadow-lg backdrop-blur-sm">
        {styleGuide && <StyleGuideIndicator {...styleGuide} />}
        {buttons.map((button) => (
          <Tooltip key={button.id}>
            <TooltipTrigger asChild>
              <ToolbarButton
                active={button.active}
                ariaLabel={button.label}
                icon={button.icon}
                onClick={button.onClick}
              />
            </TooltipTrigger>
            <TooltipContent side="bottom">{button.label}</TooltipContent>
          </Tooltip>
        ))}
        </div>
      </div>
    </TooltipProvider>
  );
}
