import React, { type ComponentType, useCallback, useRef } from 'react';
import {
  Clapperboard,
  FolderSearch,
  Layers,
  MapPin,
  Package,
  Plus,
  Settings,
  SlidersHorizontal,
  Users,
  Zap,
} from 'lucide-react';
import { useDispatch, useSelector } from 'react-redux';
import { useLocation, useNavigate } from 'react-router-dom';
import type { RootState } from '../../store/index.js';
import { setActivePanel, type LeftPanelId, togglePanel } from '../../store/slices/ui.js';
import { toggleCommander } from '../../store/slices/commander.js';
import { cn } from '../../lib/utils.js';
import { t } from '../../i18n.js';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../ui/Tooltip.js';

interface ToolbarButton {
  id: string;
  icon: ComponentType<{ className?: string }>;
  label: string;
  panel?: LeftPanelId;
  route?: string;
}

const TOOLBAR_BUTTONS: ToolbarButton[] = [
  { id: 'add', icon: Plus, label: 'toolbar.add', panel: 'add' },
  { id: 'assets', icon: FolderSearch, label: 'toolbar.assets', panel: 'assets' },
  { id: 'characters', icon: Users, label: 'toolbar.characters', panel: 'characters' },
  { id: 'equipment', icon: Package, label: 'toolbar.equipment', panel: 'equipment' },
  { id: 'locations', icon: MapPin, label: 'toolbar.locations', panel: 'locations' },
  {
    id: 'shotTemplates',
    icon: Clapperboard,
    label: 'toolbar.shotTemplates',
    panel: 'shotTemplates',
  },
  { id: 'presets', icon: SlidersHorizontal, label: 'toolbar.presets', panel: 'presets' },
  { id: 'canvases', icon: Layers, label: 'toolbar.canvases', panel: 'canvases' },
  { id: 'settings', icon: Settings, label: 'toolbar.settings', route: '/settings' },
];

export function LeftToolbar() {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const location = useLocation();
  const activePanel = useSelector((state: RootState) => state.ui.activePanel);
  const commanderOpen = useSelector((state: RootState) => state.commander.open);
  const toolbarRef = useRef<HTMLElement>(null);

  const anyActive = activePanel !== null || commanderOpen || location.pathname === '/settings';

  const handleToolbarKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (!toolbarRef.current) return;
    const buttons = Array.from(
      toolbarRef.current.querySelectorAll<HTMLButtonElement>('button:not([disabled])'),
    );
    const focused = document.activeElement as HTMLButtonElement;
    const idx = buttons.indexOf(focused);
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      buttons[(idx + 1) % buttons.length]?.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      buttons[(idx - 1 + buttons.length) % buttons.length]?.focus();
    }
  }, []);

  return (
    <TooltipProvider delayDuration={120}>
      <aside
        ref={toolbarRef}
        role="toolbar"
        aria-label={t('toolbar.ariaLabel')}
        aria-orientation="vertical"
        onKeyDown={handleToolbarKeyDown}
        className="flex h-full w-11 shrink-0 flex-col border-r border-border bg-card px-0.5 py-1.5"
      >
        <div className="flex flex-col gap-0.5">
          {TOOLBAR_BUTTONS.slice(0, -1).map((button, idx) => {
            const label = t(button.label);
            const Icon = button.icon;
            const active = Boolean(
              (button.panel && activePanel === button.panel) ||
              (button.route && location.pathname === button.route),
            );
            const isDefaultFocusable = !anyActive && idx === 0;

            return (
              <Tooltip key={button.id}>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    aria-label={label}
                    aria-pressed={active}
                    tabIndex={active || isDefaultFocusable ? 0 : -1}
                    onClick={() => {
                      if (button.panel) {
                        dispatch(togglePanel(button.panel));
                        return;
                      }
                      if (button.route) {
                        dispatch(setActivePanel(null));
                        navigate(button.route);
                      }
                    }}
                    className={cn(
                      'flex h-9 w-10 items-center justify-center rounded-md transition-colors',
                      active
                        ? 'bg-primary/12 text-primary'
                        : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                    )}
                  >
                    <Icon className="h-[15px] w-[15px]" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right">{label}</TooltipContent>
              </Tooltip>
            );
          })}
        </div>

        <div className="flex-1" />

        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label={`${t('commander.commanderAI')} (Ctrl+J)`}
              aria-pressed={commanderOpen}
              tabIndex={commanderOpen ? 0 : -1}
              onClick={() => dispatch(toggleCommander())}
              className={cn(
                'flex h-9 w-10 items-center justify-center rounded-md transition-colors',
                commanderOpen
                  ? 'bg-amber-400/12 text-amber-400'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground',
              )}
            >
              <Zap className="h-[15px] w-[15px]" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="right">{t('commander.commanderAI')} (Ctrl+J)</TooltipContent>
        </Tooltip>

        {(() => {
          const button = TOOLBAR_BUTTONS[TOOLBAR_BUTTONS.length - 1];
          const label = t(button.label);
          const Icon = button.icon;
          const active = location.pathname === button.route;

          return (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  aria-label={label}
                  aria-pressed={active}
                  tabIndex={active ? 0 : -1}
                  onClick={() => {
                    if (button.route) {
                      dispatch(setActivePanel(null));
                      navigate(button.route);
                    }
                  }}
                  className={cn(
                    'flex h-9 w-10 items-center justify-center rounded-md transition-colors',
                    active
                      ? 'bg-primary/12 text-primary'
                      : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                  )}
                >
                  <Icon className="h-[15px] w-[15px]" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="right">{label}</TooltipContent>
            </Tooltip>
          );
        })()}
      </aside>
    </TooltipProvider>
  );
}
