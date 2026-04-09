import { X, type LucideIcon } from 'lucide-react';
import { cn } from '../../lib/utils.js';

interface InspectorPanelHeaderProps {
  icon: LucideIcon;
  iconColorClass: string;
  title: string;
  closeLabel: string;
  onClose: () => void;
}

export function InspectorPanelHeader({
  icon: Icon,
  iconColorClass,
  title,
  closeLabel,
  onClose,
}: InspectorPanelHeaderProps) {
  return (
    <div className="flex shrink-0 items-center justify-between border-b border-border/60 px-3 py-2">
      <div className="flex items-center gap-2">
        <Icon className={cn('h-3.5 w-3.5', iconColorClass)} />
        <span className="text-xs font-semibold">{title}</span>
      </div>
      <button
        type="button"
        onClick={onClose}
        className="rounded-md p-0.5 transition-colors hover:bg-muted"
        aria-label={closeLabel}
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
