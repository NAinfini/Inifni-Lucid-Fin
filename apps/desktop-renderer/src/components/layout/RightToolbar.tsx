import React, { type ComponentType } from 'react';
import { Download, GitBranch, History, Info, ListTodo, StickyNote } from 'lucide-react';
import { useDispatch, useSelector } from 'react-redux';
import type { RootState } from '../../store/index.js';
import { toggleRightPanel, type RightPanelId } from '../../store/slices/ui.js';
import { cn } from '../../lib/utils.js';
import { t } from '../../i18n.js';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '../ui/Tooltip.js';

interface ToolbarButton {
  id: string;
  panel: RightPanelId;
  icon: ComponentType<{ className?: string }>;
  label: string;
}

const TOOLBAR_BUTTONS: ToolbarButton[] = [
  { id: 'inspector', panel: 'inspector', icon: Info, label: 'Inspector' },
  { id: 'dependencies', panel: 'dependencies', icon: GitBranch, label: 'Dependencies' },
  { id: 'queue', panel: 'queue', icon: ListTodo, label: 'Generation Queue' },
  { id: 'history', panel: 'history', icon: History, label: 'History' },
  { id: 'notes', panel: 'notes', icon: StickyNote, label: 'Canvas Notes' },
  { id: 'export', panel: 'export', icon: Download, label: 'Export / Render' },
];

export function RightToolbar() {
  const dispatch = useDispatch();
  const rightPanel = useSelector((state: RootState) => state.ui.rightPanel);

  return (
    <TooltipProvider delayDuration={120}>
      <aside className="flex h-full w-12 shrink-0 flex-col border-l border-border bg-card/95 px-1 py-2">
        <div className="flex flex-col gap-1">
          {TOOLBAR_BUTTONS.map((button) => {
            const Icon = button.icon;
            const active = rightPanel === button.panel;
            const label = t(`toolbar.${button.id}`) !== `toolbar.${button.id}`
              ? t(`toolbar.${button.id}`)
              : button.label;

            return (
              <Tooltip key={button.id}>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    aria-label={label}
                    aria-pressed={active}
                    onClick={() => dispatch(toggleRightPanel(button.panel))}
                    className={cn(
                      'flex h-10 w-10 items-center justify-center rounded-lg transition-colors',
                      active
                        ? 'bg-primary/10 text-primary'
                        : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                    )}
                  >
                    <Icon className="h-4 w-4" />
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
