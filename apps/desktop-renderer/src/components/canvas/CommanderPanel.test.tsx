// @vitest-environment jsdom

import React from 'react';
import { configureStore } from '@reduxjs/toolkit';
import { fireEvent, render, screen, within } from '@testing-library/react';
import type { Canvas, CanvasNode } from '@lucid-fin/contracts';
import { Provider } from 'react-redux';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CommanderPanel } from './CommanderPanel.js';
import { canvasSlice, setActiveCanvas } from '../../store/slices/canvas.js';
import { charactersSlice } from '../../store/slices/characters.js';
import { commanderSlice, type CommanderMessage } from '../../store/slices/commander.js';
import { commanderTimelineSlice } from '../../commander/state/commander-timeline-slice.js';
import { setBootstrapped, settingsSlice } from '../../store/slices/settings.js';
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
    name: 'Commander Test Canvas',
    nodes,
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    createdAt: 1,
    updatedAt: 1,
    notes: [],
  };
}

function renderCommanderPanel(
  messages: CommanderMessage[],
  canvases: Canvas[] = [createCanvas()],
  options?: { bootstrapped?: boolean },
) {
  const store = configureStore({
    reducer: {
      canvas: canvasSlice.reducer,
      characters: charactersSlice.reducer,
      commander: commanderSlice.reducer,
      commanderTimeline: commanderTimelineSlice.reducer,
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
  if (options?.bootstrapped ?? true) {
    store.dispatch(setBootstrapped());
  }

  const result = render(
    <Provider store={store}>
      <CommanderPanel />
    </Provider>,
  );

  return { store, ...result };
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

    fireEvent.click(screen.getByRole('button', { name: /Set Node Provider/i }));

    // Switch to the Inputs tab to see annotated node references
    fireEvent.click(screen.getByRole('button', { name: /Inputs/i }));

    expect(screen.getAllByText(/Opening Shot \(node-1\)/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/providerId/)).toBeTruthy();
  });

  it('keeps horizontal overflow clipped to the message pane while allowing message text to wrap', () => {
    const { container } = renderCommanderPanel([
      {
        id: 'assistant-overflow',
        role: 'assistant',
        content:
          'averyveryveryveryveryveryveryveryveryveryveryveryveryveryveryveryveryverylongtoken',
        timestamp: Date.now(),
      },
    ]);

    const messageScroll = container.querySelector('[data-testid="commander-message-scroll"]');
    const markdown = container.querySelector('[data-testid="markdown"]');

    expect(messageScroll?.className).toContain('overflow-x-hidden');
    expect(markdown?.className).toContain('break-words');
  });

  it('renders historical question messages as a localized question card', () => {
    setLocale('zh-CN');

    const historyQuestionMessage = {
      id: 'assistant-question',
      role: 'assistant',
      content:
        'Which relationship should we show?\n\n- Pure warmth: Keep it subtle\n- Clear confession: Be direct',
      timestamp: Date.now(),
    } as CommanderMessage & {
      questionMeta: {
        question: string;
        options: Array<{ label: string; description?: string }>;
      };
    };

    historyQuestionMessage.questionMeta = {
      question: '再定一下情感表达强度：你想要哪种关系呈现?',
      options: [
        { label: '纯爱暖味', description: '轻微暧昧，点到为止' },
        { label: '明确告白', description: '情感更直接' },
      ],
    };

    renderCommanderPanel([historyQuestionMessage]);

    expect(screen.getByText('问题工具：')).toBeTruthy();
    expect(screen.getByText('再定一下情感表达强度：你想要哪种关系呈现?')).toBeTruthy();
    expect(screen.getByText('纯爱暖味')).toBeTruthy();
    expect(screen.getByText('明确告白')).toBeTruthy();
    expect(screen.queryByText(/^Question:/)).toBeNull();
  });
  it('disables chat input and send button until bootstrap finishes', () => {
    const { container } = renderCommanderPanel([], [createCanvas()], { bootstrapped: false });

    const input = container.querySelector('textarea[placeholder="Message Commander AI... (/ for commands)"]');
    const sendButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === 'Send',
    );

    expect(input instanceof HTMLTextAreaElement).toBe(true);
    expect(input && (input as HTMLTextAreaElement).disabled).toBe(true);
    expect(sendButton instanceof HTMLButtonElement).toBe(true);
    expect(sendButton && (sendButton as HTMLButtonElement).disabled).toBe(true);
    expect(sendButton?.getAttribute('title')).toBe(
      'Commander backend is still starting. Wait for the app to finish loading and try again.',
    );
  });
});
