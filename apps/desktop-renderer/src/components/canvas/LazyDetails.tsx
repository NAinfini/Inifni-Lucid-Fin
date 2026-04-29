import { useState, useCallback, type ReactNode } from 'react';

interface LazyDetailsProps {
  summary: ReactNode;
  children: ReactNode;
  className?: string;
}

/**
 * A `<details>` wrapper that defers mounting `children` until the section
 * is opened for the first time. This avoids React reconciliation cost for
 * collapsed sections that the user may never expand.
 *
 * Once opened, the children remain mounted (no re-mount on close/re-open).
 */
export function LazyDetails({ summary, children, className }: LazyDetailsProps) {
  const [hasOpened, setHasOpened] = useState(false);

  const handleToggle = useCallback(
    (e: React.SyntheticEvent<HTMLDetailsElement>) => {
      if (e.currentTarget.open && !hasOpened) {
        setHasOpened(true);
      }
    },
    [hasOpened],
  );

  return (
    <details className={className} onToggle={handleToggle}>
      {summary}
      {hasOpened ? children : null}
    </details>
  );
}
