import type { NodeStatus } from '@lucid-fin/contracts';

interface NodeStatusBadgeProps {
  status: NodeStatus;
}

/**
 * Previously rendered status badges (Failed, Queued, etc.) on canvas nodes.
 * Disabled — node status is shown via the error message area and border colors instead.
 */
export function NodeStatusBadge(_props: NodeStatusBadgeProps) {
  return null;
}
