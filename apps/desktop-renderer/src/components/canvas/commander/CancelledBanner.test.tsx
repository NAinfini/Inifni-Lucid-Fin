// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { CancelledBanner } from './CancelledBanner.js';

const baseEvent = {
  kind: 'cancelled' as const,
  reason: 'user' as const,
  completedToolCalls: 0,
  pendingToolCalls: 0,
  runId: 'run-1',
  step: 2,
  seq: 5,
  emittedAt: 1700000000000,
};

const mockT = (key: string): string => {
  const map: Record<string, string> = {
    'commander.cancelled.user': 'Cancelled by user',
    'commander.cancelled.timeout': 'Cancelled by timeout',
    'commander.cancelled.error': 'Cancelled due to error',
    'commander.cancelled.counts': '{completed} tools completed, {pending} pending',
    'commander.cancelled.partial': 'Partial content',
  };
  return map[key] ?? key;
};

describe('CancelledBanner', () => {
  afterEach(() => cleanup());

  it('renders reason and renderer-derived counts', () => {
    render(<CancelledBanner event={baseEvent} stats={{ completed: 3, pending: 2 }} t={mockT} />);
    expect(screen.getByText('Cancelled by user')).toBeTruthy();
    expect(screen.getByText('3 tools completed, 2 pending')).toBeTruthy();
  });

  it('localizes the reason based on cancel reason', () => {
    render(
      <CancelledBanner
        event={{ ...baseEvent, reason: 'timeout' }}
        stats={{ completed: 0, pending: 0 }}
        t={mockT}
      />,
    );
    expect(screen.getByText('Cancelled by timeout')).toBeTruthy();
  });

  it('renders partial content in a details block when present', () => {
    render(
      <CancelledBanner
        event={{ ...baseEvent, partialContent: 'halfway through' }}
        stats={{ completed: 0, pending: 1 }}
        t={mockT}
      />,
    );
    expect(screen.getByText('Partial content')).toBeTruthy();
    expect(screen.getByText('halfway through')).toBeTruthy();
  });

  it('omits the details block when no partial content', () => {
    render(<CancelledBanner event={baseEvent} stats={{ completed: 0, pending: 0 }} t={mockT} />);
    expect(screen.queryByText('Partial content')).toBeNull();
  });
});
