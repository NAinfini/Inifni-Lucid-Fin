import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Download, Grid2X2, Map, Maximize, Palette, Redo2, Search, Undo2, Upload, ZoomIn, ZoomOut } from 'lucide-react';
import { cn } from '../../lib/utils.js';
import { t } from '../../i18n.js';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '../ui/Tooltip.js';

/* -------------------------------------------------------------------------- */
/*  Toolbar button rendered as a plain TooltipTrigger (no asChild).           */
/*                                                                            */
/*  Radix TooltipTrigger renders its own Primitive.button.  Using asChild to  */
/*  merge into a forwardRef <button> creates a multi-layer Slot chain where   */
/*  composeRefs is called inline (not memoised).  On every re-render React 19 */
/*  sees a new callback-ref identity, detaches the old ref (calling           */
/*  setTrigger(null)) and attaches the new one (setTrigger(node)), which      */
/*  schedules state updates and triggers an infinite re-render loop.          */
/*                                                                            */
/*  Fix: let TooltipTrigger render its own <button> and apply styling to it   */
/*  directly via className.  This keeps a single Slot layer and a stable ref. */
/* -------------------------------------------------------------------------- */

interface ToolbarTriggerButtonProps {
  active?: boolean;
  ariaLabel: string;
  icon: ReactNode;
  disabled?: boolean;
  className?: string;
  onClick?: () => void;
  tooltip: string;
}

function ToolbarTriggerButton({
  active = false,
  ariaLabel,
  className,
  icon,
  disabled,
  onClick,
  tooltip,
}: ToolbarTriggerButtonProps) {
  return (
    <Tooltip>
      <TooltipTrigger
        type="button"
        disabled={disabled}
        aria-label={ariaLabel}
        aria-pressed={active}
        className={cn(
          'inline-flex h-8 w-8 items-center justify-center rounded-md transition-colors',
          disabled
            ? 'cursor-not-allowed text-muted-foreground/30'
            : active
              ? 'bg-primary/12 text-primary'
              : 'text-muted-foreground hover:bg-muted hover:text-foreground',
          className,
        )}
        onClick={onClick}
      >
        {icon}
      </TooltipTrigger>
      <TooltipContent side="bottom">{tooltip}</TooltipContent>
    </Tooltip>
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
  const popoverRef = useRef<HTMLDivElement>(null);
  const hasContent = Boolean(artStyle || freeformDescription);

  useEffect(() => {
    if (!expanded) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setExpanded(false);
    };
    const handleClick = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setExpanded(false);
      }
    };
    document.addEventListener('keydown', handleKey);
    document.addEventListener('mousedown', handleClick);
    return () => {
      document.removeEventListener('keydown', handleKey);
      document.removeEventListener('mousedown', handleClick);
    };
  }, [expanded]);

  if (!hasContent) return null;

  return (
    <div className="relative" ref={popoverRef}>
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
  onZoomIn?: () => void;
  onZoomOut?: () => void;
  onFitView?: () => void;
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
  onZoomIn,
  onZoomOut,
  onFitView,
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
        <div role="toolbar" aria-label={t('canvas.toolbar.undoRedo')} className="flex items-center gap-0.5 rounded-md border border-border/60 bg-card/95 p-1.5 shadow-lg backdrop-blur-sm">
          <ToolbarTriggerButton
            disabled={!undoEnabled}
            ariaLabel={t('canvas.undo')}
            icon={<Undo2 className="h-3.5 w-3.5" />}
            onClick={onUndo}
            tooltip={t('canvas.undo')}
          />
          <ToolbarTriggerButton
            disabled={!redoEnabled}
            ariaLabel={t('canvas.redo')}
            icon={<Redo2 className="h-3.5 w-3.5" />}
            onClick={onRedo}
            tooltip={t('canvas.redo')}
          />
        </div>
        {onZoomIn && onZoomOut && onFitView && (
        <div role="toolbar" aria-label={t('canvas.toolbar.zoom')} className="flex items-center gap-0.5 rounded-md border border-border/60 bg-card/95 p-1.5 shadow-lg backdrop-blur-sm">
          <ToolbarTriggerButton
            ariaLabel={t('canvas.zoomIn')}
            icon={<ZoomIn className="h-3.5 w-3.5" />}
            onClick={onZoomIn}
            tooltip={t('canvas.zoomIn')}
          />
          <ToolbarTriggerButton
            ariaLabel={t('canvas.zoomOut')}
            icon={<ZoomOut className="h-3.5 w-3.5" />}
            onClick={onZoomOut}
            tooltip={t('canvas.zoomOut')}
          />
          <ToolbarTriggerButton
            ariaLabel={t('canvas.fitView')}
            icon={<Maximize className="h-3.5 w-3.5" />}
            onClick={onFitView}
            tooltip={t('canvas.fitView')}
          />
        </div>
        )}
        <div role="toolbar" aria-label={t('canvas.toolbar.canvasTools')} className="flex items-center gap-1.5 rounded-md border border-border/60 bg-card/95 p-1.5 shadow-lg backdrop-blur-sm">
        {styleGuide && <StyleGuideIndicator {...styleGuide} />}
        {buttons.map((button) => (
          <ToolbarTriggerButton
            key={button.id}
            active={button.active}
            ariaLabel={button.label}
            icon={button.icon}
            onClick={button.onClick}
            tooltip={button.label}
          />
        ))}
        </div>
      </div>
    </TooltipProvider>
  );
}
