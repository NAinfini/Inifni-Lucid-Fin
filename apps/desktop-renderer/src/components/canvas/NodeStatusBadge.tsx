import type { NodeStatus } from '@lucid-fin/contracts';
import { cn } from '../../lib/utils.js';

interface NodeStatusBadgeProps {
  status: NodeStatus;
}

const STATUS_STYLES: Partial<Record<NodeStatus, { dot: string; label: string }>> = {
  failed: { dot: 'bg-destructive', label: 'Failed' },
  queued: { dot: 'bg-amber-500', label: 'Queued' },
};

export function NodeStatusBadge({ status }: NodeStatusBadgeProps) {
  const style = STATUS_STYLES[status];
  if (!style) return null;

  return (
    <span className="absolute right-1.5 top-1.5 z-20 flex items-center gap-1 rounded-full bg-card/90 px-1.5 py-0.5 text-[9px] font-medium text-foreground shadow-sm backdrop-blur-sm">
      <span className={cn('h-1.5 w-1.5 rounded-full', style.dot)} />
      {style.label}
    </span>
  );
}
