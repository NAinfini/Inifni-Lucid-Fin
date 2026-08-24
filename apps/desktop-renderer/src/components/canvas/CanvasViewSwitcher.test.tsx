// @vitest-environment jsdom

import React from 'react';
import { configureStore } from '@reduxjs/toolkit';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Provider } from 'react-redux';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { t } from '../../i18n.js';
import { canvasSlice } from '../../store/slices/canvas/canvas.js';
import { commanderSlice } from '../../store/slices/commander.js';
import { uiSlice } from '../../store/slices/ui.js';
import { taskListsSlice } from '../../store/slices/task-lists.js';
import { TooltipProvider } from '../ui/Tooltip.js';
import { CanvasViewSwitcher } from './CanvasViewSwitcher.js';

function renderSwitcher() {
  const store = configureStore({
    reducer: {
      ui: uiSlice.reducer,
      canvas: canvasSlice.reducer,
      commander: commanderSlice.reducer,
      taskLists: taskListsSlice.reducer,
    },
  });

  render(
    <Provider store={store}>
      <TooltipProvider delayDuration={0}>
        <CanvasViewSwitcher />
      </TooltipProvider>
    </Provider>,
  );

  return store;
}

describe('CanvasViewSwitcher', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
    cleanup();
  });

  it('renders tooltip triggers with Radix state attributes', () => {
    renderSwitcher();

    const mainButton = screen.getByRole('button', { name: t('view.main') });
    expect(mainButton.getAttribute('data-state')).toBe('closed');
    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });

  it('switches canvas modes without logging update-depth errors', () => {
    renderSwitcher();

    const deliveryButton = screen.getByRole('button', { name: t('view.deliveryLabel') });
    fireEvent.click(deliveryButton);

    expect(deliveryButton.getAttribute('aria-pressed')).toBe('true');
    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });
});
