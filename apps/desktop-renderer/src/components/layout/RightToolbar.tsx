import React, { type ComponentType } from 'react';
import { GitBranch, History, Info, ListTodo, ScrollText, Share2, StickyNote } from 'lucide-react';
import { useDispatch, useSelector } from 'react-redux';
import type { RootState } from '../../store/index.js';
import { toggleRightPanel, type RightPanelId } from '../../store/slices/ui.js';
import { cn } from '../../lib/utils.js';
import { t } from '../../i18n.js';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../ui/Tooltip.js';

interface ToolbarButton {
  id: string;
  panel: RightPanelId;
  icon: ComponentType<{ className?: string }>;
}

const TOOLBAR_BUTTONS: ToolbarButton[] = [
  { id: 'inspector', panel: 'inspector', icon: Info },
  { id: 'dependencies', panel: 'dependencies', icon: GitBranch },
  { id: 'queue', panel: 'queue', icon: ListTodo },
  { id: 'history', panel: 'history', icon: History },
  { id: 'notes', panel: 'notes', icon: StickyNote },
  { id: 'export', panel: 'export', icon: Share2 },
  { id: 'logger', panel: 'logger', icon: ScrollText },
];

export function RightToolbar() {
  const dispatch = useDispatch();
  const rightPanel = useSelector((state: RootState) => state.ui.rightPanel);

  return (
    <TooltipProvider delayDuration={120}>
      <aside className="flex h-full w-11 shrink-0 flex-col border-l border-border bg-card px-0.5 py-1.5">
        <div className="flex flex-col gap-0.5">
          {TOOLBAR_BUTTONS.map((button) => {
            const Icon = button.icon;
            const active = rightPanel === button.panel;
            const label = t(`toolbar.${button.id}`);

            return (
              <Tooltip key={button.id}>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    aria-label={label}
                    aria-pressed={active}
                    onClick={() => dispatch(toggleRightPanel(button.panel))}
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
                <TooltipContent side="left">{label}</TooltipContent>
              </Tooltip>
            );
          })}
        </div>
      </aside>
    </TooltipProvider>
  );
}
