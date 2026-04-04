import type { NodeStatus } from '@lucid-fin/contracts';
import { cn } from '../../lib/utils.js';
import { Clock, Loader2, Check, X, Lock, EyeOff } from 'lucide-react';
import { t } from '../../i18n.js';

const STATUS_CONFIG: Record<
  NodeStatus,
  { icon: typeof Clock; labelKey: string; className: string } | null
> = {
  idle: null,
  queued: { icon: Clock, labelKey: 'status.queued', className: 'text-yellow-500 bg-yellow-500/10' },
  generating: {
    icon: Loader2,
    labelKey: 'status.generating',
    className: 'text-blue-500 bg-blue-500/10',
  },
  done: { icon: Check, labelKey: 'status.done', className: 'text-green-500 bg-green-500/10' },
  failed: { icon: X, labelKey: 'status.failed', className: 'text-red-500 bg-red-500/10' },
  locked: { icon: Lock, labelKey: 'status.locked', className: 'text-muted-foreground bg-muted' },
  bypassed: { icon: EyeOff, labelKey: 'status.bypassed', className: 'text-muted-foreground bg-muted' },
};

interface NodeStatusBadgeProps {
  status: NodeStatus;
}

export function NodeStatusBadge({ status }: NodeStatusBadgeProps) {
  void status;
  return null;
}
