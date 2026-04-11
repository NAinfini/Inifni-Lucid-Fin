import type { NodeStatus } from '@lucid-fin/contracts';
import { cn } from '../../lib/utils.js';

interface NodeStatusBadgeProps {
  status: NodeStatus;
}

const STATUS_CONFIG: Record<
  NodeStatus,
  { dot: string; label: string } | null
> = {
  idle: null,
  queued: { dot: 'bg-amber-400', label: 'Queued' },
  generating: { dot: 'bg-blue-400 animate-pulse', label: 'Generating' },
  done: null,
  failed: { dot: 'bg-red-400', label: 'Failed' },
  locked: { dot: 'bg-slate-400', label: 'Locked' },
  bypassed: { dot: 'bg-slate-500', label: 'Bypassed' },
};

export function NodeStatusBadge({ status }: NodeStatusBadgeProps) {
  const config = STATUS_CONFIG[status];
  if (!config) return null;

  return (
    <div
      className="absolute left-1.5 top-1.5 z-20 flex items-center gap-1 rounded-full bg-background/80 px-1.5 py-0.5 backdrop-blur-sm"
      title={config.label}
    >
      <span className={cn('inline-block h-1.5 w-1.5 rounded-full', config.dot)} />
      <span className="text-[9px] font-medium leading-none text-muted-foreground">
        {config.label}
      </span>
    </div>
  );
}
