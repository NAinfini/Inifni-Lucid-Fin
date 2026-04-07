// @vitest-environment jsdom

import React from 'react';
import { configureStore } from '@reduxjs/toolkit';
import { render, screen, within } from '@testing-library/react';
import { Provider } from 'react-redux';
import { describe, expect, it } from 'vitest';
import { LoggerPanel } from './LoggerPanel.js';
import { loggerSlice, type LoggerState } from '../../store/slices/logger.js';
import { uiSlice, type UIState } from '../../store/slices/ui.js';

function formatTimestamp(timestamp: number): string {
  return new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(new Date(timestamp));
}

function renderLoggerPanel({
  loggerState,
  uiState,
}: {
  loggerState?: LoggerState;
  uiState?: UIState;
} = {}) {
  const store = configureStore({
    reducer: {
      logger: loggerSlice.reducer,
      ui: uiSlice.reducer,
    },
    preloadedState: {
      logger:
        loggerState ??
        ({
          entries: [],
        } satisfies LoggerState),
      ui: uiState ?? uiSlice.getInitialState(),
    },
  });

  return render(
    <Provider store={store}>
      <LoggerPanel />
    </Provider>,
  );
}

describe('LoggerPanel', () => {
  it('renders timestamp, level, and category in the meta row and message in a separate body row', () => {
    const timestamp = new Date(2026, 3, 6, 3, 26, 12).getTime();

    renderLoggerPanel({
      loggerState: {
        entries: [
          {
            id: 'entry-1',
            timestamp,
            level: 'info',
            category: 'provider',
            message: 'Provider connection test started',
            detail: 'detail payload',
          },
        ],
      },
    });

    const meta = screen.getByTestId('logger-entry-meta-entry-1');
    const body = screen.getByTestId('logger-entry-body-entry-1');

    expect(within(meta).getByText(`[${formatTimestamp(timestamp)}]`)).toBeTruthy();
    expect(within(meta).getByText('info')).toBeTruthy();
    expect(within(meta).getByText('provider')).toBeTruthy();
    expect(within(meta).queryByText('Provider connection test started')).toBeNull();

    expect(within(body).getByText('Provider connection test started')).toBeTruthy();
    expect(screen.queryByText('detail payload')).toBeNull();
  });
});
