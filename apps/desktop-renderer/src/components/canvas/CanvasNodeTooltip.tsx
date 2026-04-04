import type { ReactNode } from 'react';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '../ui/Tooltip.js';

export interface CanvasNodeTooltipItem {
  label: string;
  value: ReactNode;
}

interface CanvasNodeTooltipProps {
  children: ReactNode;
  title: string;
  subtitle?: string;
  items: CanvasNodeTooltipItem[];
}

export function CanvasNodeTooltip({
  children,
  title,
  subtitle,
  items,
}: CanvasNodeTooltipProps) {
  return (
    <TooltipProvider delayDuration={180}>
      <Tooltip>
        <TooltipTrigger asChild>{children}</TooltipTrigger>
        <TooltipContent side="top" className="max-w-64 rounded-xl border border-border bg-card/95 p-3 text-card-foreground shadow-2xl">
          <div className="space-y-2">
            <div>
              <div className="text-xs font-semibold text-foreground">{title}</div>
              {subtitle ? <div className="text-[10px] text-muted-foreground">{subtitle}</div> : null}
            </div>
            <div className="space-y-1">
              {items.map((item) => (
                <div key={item.label} className="flex items-center justify-between gap-3 text-[10px]">
                  <span className="text-muted-foreground">{item.label}</span>
                  <span className="font-medium text-foreground">{item.value}</span>
                </div>
              ))}
            </div>
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
