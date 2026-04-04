// @vitest-environment jsdom

import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NodeContextMenu } from './NodeContextMenu.js';

const TRIGGER_LABEL = 'Node trigger';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function createProps(
  overrides: Partial<React.ComponentProps<typeof NodeContextMenu>> = {},
): React.ComponentProps<typeof NodeContextMenu> {
  return {
    children: <button type="button">{TRIGGER_LABEL}</button>,
    nodeId: 'node-1',
    nodeType: 'image',
    locked: false,
    colorTag: undefined,
    onRename: vi.fn(),
    onDelete: vi.fn(),
    onDuplicate: vi.fn(),
    onCut: vi.fn(),
    onCopy: vi.fn(),
    onPaste: vi.fn(),
    onDisconnect: vi.fn(),
    onConnectTo: vi.fn(),
    onLock: vi.fn(),
    onGenerate: vi.fn(),
    onColorTag: vi.fn(),
    ...overrides,
  };
}

async function openMenu(
  overrides: Partial<React.ComponentProps<typeof NodeContextMenu>> = {},
) {
  const props = createProps(overrides);
  const view = render(<NodeContextMenu {...props} />);

  fireEvent.contextMenu(screen.getByRole('button', { name: TRIGGER_LABEL }));
  await screen.findByText('Rename');

  return { ...view, props };
}

describe('NodeContextMenu', () => {
  it('renders all standard menu items for image node', async () => {
    await openMenu();

    expect(screen.getByText('Rename')).toBeTruthy();
    expect(screen.getByText('Duplicate')).toBeTruthy();
    expect(screen.getByText('Cut')).toBeTruthy();
    expect(screen.getByText('Copy')).toBeTruthy();
    expect(screen.getByText('Paste')).toBeTruthy();
    expect(screen.getByText('Disconnect All Edges')).toBeTruthy();
    expect(screen.getByText('Connect To...')).toBeTruthy();
    expect(screen.getByText('Lock')).toBeTruthy();
    expect(screen.getByText('Generate')).toBeTruthy();
    expect(screen.getByText('Color Tag')).toBeTruthy();
    expect(screen.getByText('Delete')).toBeTruthy();
  });

  it.each(['text', 'backdrop'] as const)(
    'Generate hidden for %s nodes',
    async (nodeType) => {
      await openMenu({ nodeType });
      expect(screen.queryByText('Generate')).toBeNull();
    },
  );

  it('Connect To hidden for backdrop type', async () => {
    await openMenu({ nodeType: 'backdrop' });
    expect(screen.queryByText('Connect To...')).toBeNull();
  });

  it('Cut callback fires with correct nodeId', async () => {
    const { props } = await openMenu();
    fireEvent.click(screen.getByText('Cut'));
    expect(props.onCut).toHaveBeenCalledWith('node-1');
  });

  it('Copy callback fires with correct nodeId', async () => {
    const { props } = await openMenu();
    fireEvent.click(screen.getByText('Copy'));
    expect(props.onCopy).toHaveBeenCalledWith('node-1');
  });

  it('Paste callback fires with correct nodeId', async () => {
    const { props } = await openMenu();
    fireEvent.click(screen.getByText('Paste'));
    expect(props.onPaste).toHaveBeenCalledWith('node-1');
  });

  it('Lock label toggles based on locked prop', async () => {
    const unlocked = await openMenu({ locked: false });
    expect(screen.getByText('Lock')).toBeTruthy();
    expect(screen.queryByText('Unlock')).toBeNull();
    unlocked.unmount();

    const locked = await openMenu({ locked: true });
    expect(screen.getByText('Unlock')).toBeTruthy();
    expect(screen.queryByText('Lock')).toBeNull();
    locked.unmount();
  });
});
