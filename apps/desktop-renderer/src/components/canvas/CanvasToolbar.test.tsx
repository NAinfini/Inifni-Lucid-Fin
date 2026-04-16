// @vitest-environment jsdom

import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CanvasToolbar } from './CanvasToolbar.js';

describe('CanvasToolbar', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
    cleanup();
  });

  it('renders tooltip-backed toolbar buttons without wrapper div triggers', () => {
    render(
      <CanvasToolbar
        minimapVisible={false}
        snapToGrid={false}
        searchOpen={false}
        onToggleSearch={vi.fn()}
        onToggleMinimap={vi.fn()}
        onToggleSnapToGrid={vi.fn()}
        onExportWorkflow={vi.fn()}
        onImportWorkflow={vi.fn()}
        onUndo={vi.fn()}
        onRedo={vi.fn()}
        undoEnabled
        redoEnabled
      />,
    );

    expect(screen.getByRole('button', { name: /undo/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /redo/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /search/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /undo/i }).getAttribute('data-state')).toBe('closed');
    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });

  it('invokes button handlers', () => {
    const onUndo = vi.fn();
    const onToggleSearch = vi.fn();

    render(
      <CanvasToolbar
        minimapVisible={false}
        snapToGrid={false}
        searchOpen={false}
        onToggleSearch={onToggleSearch}
        onToggleMinimap={vi.fn()}
        onToggleSnapToGrid={vi.fn()}
        onExportWorkflow={vi.fn()}
        onImportWorkflow={vi.fn()}
        onUndo={onUndo}
        onRedo={vi.fn()}
        undoEnabled
        redoEnabled
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /undo/i }));
    fireEvent.click(screen.getByRole('button', { name: /search/i }));

    expect(onUndo).toHaveBeenCalledOnce();
    expect(onToggleSearch).toHaveBeenCalledOnce();
    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });
});
