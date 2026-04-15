// @vitest-environment jsdom

import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NodeContextMenu } from './NodeContextMenu.js';
import { NodeCallbacksContext, type NodeCallbacks } from './node-callbacks-context.js';

const TRIGGER_LABEL = 'Node trigger';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function createCallbacks(
  overrides: Partial<NodeCallbacks> = {},
): NodeCallbacks {
  return {
    onTitleChange: vi.fn(),
    onDelete: vi.fn(),
    onDuplicate: vi.fn(),
    onCut: vi.fn(),
    onCopy: vi.fn(),
    onPaste: vi.fn(),
    onDisconnect: vi.fn(),
    onConnectTo: vi.fn(),
    onRename: vi.fn(),
    onGenerate: vi.fn(),
    onLock: vi.fn(),
    onColorTag: vi.fn(),
    onCopyPromptForAI: vi.fn(),
    onUpload: vi.fn(),
    onSelectVariant: vi.fn(),
    onToggleSeedLock: vi.fn(),
    onToggleCollapse: vi.fn(),
    onOpacityChange: vi.fn(),
    onCloneVideo: vi.fn(),
    ...overrides,
  };
}

async function openMenu(
  overrides: { nodeType?: 'text' | 'image' | 'video' | 'audio' | 'backdrop'; locked?: boolean; colorTag?: string } = {},
  cbOverrides: Partial<NodeCallbacks> = {},
) {
  const callbacks = createCallbacks(cbOverrides);
  const view = render(
    <NodeCallbacksContext.Provider value={callbacks}>
      <NodeContextMenu
        nodeId="node-1"
        nodeType={overrides.nodeType ?? 'image'}
        locked={overrides.locked ?? false}
        colorTag={overrides.colorTag}
      >
        <button type="button">{TRIGGER_LABEL}</button>
      </NodeContextMenu>
    </NodeCallbacksContext.Provider>,
  );

  fireEvent.contextMenu(screen.getByRole('button', { name: TRIGGER_LABEL }));
  await screen.findByText('Rename');

  return { ...view, callbacks };
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
    const { callbacks } = await openMenu();
    fireEvent.click(screen.getByText('Cut'));
    expect(callbacks.onCut).toHaveBeenCalledWith('node-1');
  });

  it('Copy callback fires with correct nodeId', async () => {
    const { callbacks } = await openMenu();
    fireEvent.click(screen.getByText('Copy'));
    expect(callbacks.onCopy).toHaveBeenCalledWith('node-1');
  });

  it('Paste callback fires with correct nodeId', async () => {
    const { callbacks } = await openMenu();
    fireEvent.click(screen.getByText('Paste'));
    expect(callbacks.onPaste).toHaveBeenCalledWith('node-1');
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
