// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CatalogFrozenEvent } from '@lucid-fin/contracts';
import { CommanderCapabilityViewer } from './CommanderCapabilityViewer.js';
import { CommanderHeader } from './CommanderHeader.js';

vi.mock('react-redux', () => ({
  useDispatch: () => vi.fn(),
}));

const t = (key: string): string =>
  (
    ({
      'commander.capabilities.trigger': 'View run capabilities',
      'commander.capabilities.title': 'Run capabilities',
      'commander.capabilities.summary': '{count} tools were frozen for this run.',
      'commander.capabilities.search': 'Search capabilities',
      'commander.capabilities.noMatches': 'No capabilities match this search.',
      'commander.capabilities.catalogHash': 'Catalog',
      'commander.capabilities.tier.1': 'Read',
      'commander.capabilities.tier.2': 'Edit',
    }) as Record<string, string>
  )[key] ?? key;

const catalog: CatalogFrozenEvent = {
  kind: 'catalog_frozen',
  runId: 'run-1',
  step: 0,
  seq: 1,
  emittedAt: 2,
  catalogHash: 'a'.repeat(64),
  tools: [
    {
      name: 'canvas.get',
      description: 'Read a Canvas',
      tier: 1,
      tags: ['read'],
      contexts: ['canvas'],
      inputSchemaHash: 'b'.repeat(64),
    },
    {
      name: 'node.update',
      description: 'Update a node',
      tier: 2,
      tags: ['write'],
      contexts: ['canvas'],
      inputSchemaHash: 'c'.repeat(64),
    },
  ],
};

afterEach(cleanup);

describe('CommanderCapabilityViewer', () => {
  it('opens from the compact header trigger and shows the frozen catalog', () => {
    render(<CommanderHeader capabilityCatalog={catalog} t={t} />);

    const trigger = screen.getByRole('button', { name: 'View run capabilities' });
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(document.querySelector('[data-radix-popper-content-wrapper]')).toBeNull();
    expect(screen.getByText('Run capabilities')).toBeTruthy();
    expect(screen.getByText('canvas.get')).toBeTruthy();
    expect(screen.getByText('node.update')).toBeTruthy();
    expect(screen.getByText('Read')).toBeTruthy();
    expect(screen.getByText('Edit')).toBeTruthy();
  });

  it('filters tools without mutating the frozen catalog', () => {
    render(<CommanderCapabilityViewer id="catalog-test" catalog={catalog} t={t} />);
    fireEvent.change(screen.getByPlaceholderText('Search capabilities'), {
      target: { value: 'update' },
    });

    expect(screen.queryByText('canvas.get')).toBeNull();
    expect(screen.getByText('node.update')).toBeTruthy();
    expect(catalog.tools).toHaveLength(2);
  });
});
