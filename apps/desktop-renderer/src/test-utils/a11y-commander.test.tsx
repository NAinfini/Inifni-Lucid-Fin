// @vitest-environment jsdom
/**
 * Accessibility audit — CommanderPanel.
 *
 * Renders the CommanderPanel in various states and runs axe-core to catch
 * structural / ARIA violations.
 */
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { configureStore } from '@reduxjs/toolkit';
import { Provider } from 'react-redux';
import { axe } from 'vitest-axe';
import * as matchers from 'vitest-axe/matchers';
import type { Canvas } from '@lucid-fin/contracts';

import { CommanderPanel } from '../components/canvas/CommanderPanel.js';
import { canvasSlice, setActiveCanvas } from '../store/slices/canvas/canvas.js';
import { charactersSlice } from '../store/slices/characters.js';
import { commanderSlice, type CommanderMessage } from '../store/slices/commander.js';
import { taskListsSlice } from '../store/slices/task-lists.js';
import { commanderTimelineSlice } from '../commander/state/commander-timeline-slice.js';
import { createCommanderSession } from '../commander/state/helpers.js';
import { setBootstrapped, settingsSlice } from '../store/slices/settings.js';
import { setLocale } from '../i18n.js';

expect.extend(matchers);

vi.mock('../hooks/useCommander.js', () => ({
  useCommander: () => ({
    sendMessage: vi.fn(),
    cancel: vi.fn(),
    isStreaming: false,
  }),
}));

vi.mock('../utils/api.js', () => ({
  getAPI: vi.fn(() => null),
}));

const AXE_OPTIONS = {
  rules: {
    'color-contrast': { enabled: false },
    region: { enabled: false },
  },
};

function createCanvas(id = 'canvas-1', name = 'A11y Test Canvas'): Canvas {
  return {
    id,
    name,
    nodes: [],
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    createdAt: 1,
    updatedAt: 1,
    notes: [],
  };
}

function renderCommanderPanel(messages: CommanderMessage[] = []) {
  const canvases = [createCanvas(), createCanvas('canvas-2', 'Reference Canvas')];
  const session = createCommanderSession('a11y-session', canvases[0]!.id);
  session.messages = messages;
  const store = configureStore({
    reducer: {
      canvas: canvasSlice.reducer,
      characters: charactersSlice.reducer,
      commander: commanderSlice.reducer,
      commanderTimeline: commanderTimelineSlice.reducer,
      taskLists: taskListsSlice.reducer,
      settings: settingsSlice.reducer,
    },
    preloadedState: {
      commander: {
        ...commanderSlice.getInitialState(),
        open: true,
        activeSessionId: session.id,
        sessions: [session],
      },
    },
  });
  store.dispatch(canvasSlice.actions.setCanvases(canvases));
  store.dispatch(setActiveCanvas(canvases[0]!.id));
  store.dispatch(setBootstrapped());

  const result = render(
    <Provider store={store}>
      <CommanderPanel />
    </Provider>,
  );

  return { store, ...result };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  setLocale('en-US');
});

describe('a11y audit: CommanderPanel', () => {
  it('has no axe violations in empty state', async () => {
    const { container } = renderCommanderPanel();
    const results = await axe(container, AXE_OPTIONS);
    expect(results).toHaveNoViolations();
  });

  it('has no axe violations with chat messages', async () => {
    const { container } = renderCommanderPanel([
      {
        id: 'user-1',
        role: 'user',
        content: 'Hello, Commander!',
        timestamp: Date.now(),
      },
      {
        id: 'assistant-1',
        role: 'assistant',
        content: 'Hello! How can I help you today?',
        timestamp: Date.now(),
      },
    ]);

    const results = await axe(container, AXE_OPTIONS);
    expect(results).toHaveNoViolations();
  });

  it('has no axe violations with the Canvas context chooser open', async () => {
    const { container } = renderCommanderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Add context' }));

    const results = await axe(container, AXE_OPTIONS);
    expect(results).toHaveNoViolations();
  });

  it('chat message list uses article elements for message structure', () => {
    renderCommanderPanel([
      {
        id: 'user-1',
        role: 'user',
        content: 'Test message',
        timestamp: Date.now(),
      },
      {
        id: 'assistant-1',
        role: 'assistant',
        content: 'Response',
        timestamp: Date.now(),
      },
    ]);

    // Each message should be wrapped in an <article> for proper semantics
    const articles = document.querySelectorAll('article');
    expect(articles.length).toBe(2);
  });
});
