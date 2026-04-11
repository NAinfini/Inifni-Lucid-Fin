// @vitest-environment jsdom

import React from 'react';
import { configureStore } from '@reduxjs/toolkit';
import { fireEvent, render, screen, within } from '@testing-library/react';
import type { Canvas, CanvasNode } from '@lucid-fin/contracts';
import { Provider } from 'react-redux';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CommanderPanel } from './CommanderPanel.js';
import { canvasSlice, setActiveCanvas } from '../../store/slices/canvas.js';
import { commanderSlice, type CommanderMessage } from '../../store/slices/commander.js';
import { settingsSlice } from '../../store/slices/settings.js';
import { setLocale } from '../../i18n.js';

vi.mock('../../hooks/useCommander.js', () => ({
  useCommander: () => ({
    sendMessage: vi.fn(),
    cancel: vi.fn(),
    isStreaming: false,
  }),
}));

vi.mock('../../utils/api.js', () => ({
  getAPI: vi.fn(() => null),
}));

function createCanvasNode(overrides: Partial<CanvasNode> = {}): CanvasNode {
  return {
    id: 'node-1',
    type: 'image',
    title: 'Opening Shot',
    position: { x: 0, y: 0 },
    status: 'idle',
    bypassed: false,
    locked: false,
    width: 320,
    height: 180,
    createdAt: 1,
    updatedAt: 1,
    data: {
      status: 'empty',
      progress: 0,
      variants: [],
      selectedVariantIndex: 0,
    },
    ...overrides,
  };
}

function createCanvas(nodes: CanvasNode[] = []): Canvas {
  return {
    id: 'canvas-1',
    projectId: 'project-1',
    name: 'Commander Test Canvas',
    nodes,
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    createdAt: 1,
    updatedAt: 1,
    notes: [],
  };
}

function renderCommanderPanel(messages: CommanderMessage[], canvases: Canvas[] = [createCanvas()]) {
  const store = configureStore({
    reducer: {
      canvas: canvasSlice.reducer,
      commander: commanderSlice.reducer,
      settings: settingsSlice.reducer,
    },
    preloadedState: {
      commander: {
        ...commanderSlice.getInitialState(),
        open: true,
        messages,
      },
    },
  });
  store.dispatch(canvasSlice.actions.setCanvases(canvases));
  store.dispatch(setActiveCanvas(canvases[0]?.id ?? null));

  return render(
    <Provider store={store}>
      <CommanderPanel />
    </Provider>,
  );
}

describe('CommanderPanel', () => {
  beforeEach(() => {
    setLocale('en-US');
  });

  it('renders a top action strip inside assistant bubbles for copy actions', () => {
    renderCommanderPanel([
      {
        id: 'assistant-1',
        role: 'assistant',
        content: 'Assistant copy target',
        timestamp: Date.now(),
      },
    ]);

    const bubble = screen.getByText('Assistant copy target').closest('article');
    expect(bubble).toBeTruthy();

    const actionStrip = within(bubble as HTMLElement).getByTestId(
      'commander-message-actions-assistant-1',
    );
    const copyButton = within(actionStrip).getByRole('button');

    expect(actionStrip.contains(copyButton)).toBe(true);
    expect(bubble?.firstElementChild).toBe(actionStrip);
  });

  it('shows node titles in tool call details instead of bare node ids', () => {
    renderCommanderPanel(
      [
        {
          id: 'assistant-2',
          role: 'assistant',
          content: '',
          toolCalls: [
            {
              id: 'tool-1',
              name: 'canvas.setNodeProvider',
              arguments: { canvasId: 'canvas-1', nodeId: 'node-1' },
              result: { success: true, data: { nodeId: 'node-1', providerId: 'replicate' } },
              startedAt: 1,
              completedAt: 2,
              status: 'done',
            },
          ],
          timestamp: Date.now(),
        },
      ],
      [createCanvas([createCanvasNode({ id: 'node-1', title: 'Opening Shot' })])],
    );

    fireEvent.click(screen.getByRole('button', { name: /canvas\.set node provider/i }));

    expect(screen.getAllByText(/Opening Shot \(node-1\)/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/providerId/)).toBeTruthy();
  });
});
