// @vitest-environment jsdom

import React from 'react';
import { configureStore } from '@reduxjs/toolkit';
import { render, screen, within } from '@testing-library/react';
import { Provider } from 'react-redux';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CommanderPanel } from './CommanderPanel.js';
import { canvasReducer } from '../../store/slices/canvas.js';
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

function renderCommanderPanel(messages: CommanderMessage[]) {
  const store = configureStore({
    reducer: {
      canvas: canvasReducer,
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
});
