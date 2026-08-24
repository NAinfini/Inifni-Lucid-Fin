// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  LEFT_CANVAS_PANEL_WIDTH_STORAGE_KEY,
  MAX_CANVAS_PANEL_WIDTH,
  MIN_CANVAS_PANEL_WIDTH,
  RIGHT_CANVAS_PANEL_WIDTH_STORAGE_KEY,
  clearCanvasSearch,
  setActivePanel,
  setCanvasSearchQuery,
  setMinimapVisible,
  setPanelWidth,
  setRightPanel,
  setRightPanelWidth,
  setSearchPanelOpen,
  setSnapToGrid,
  toggleCanvasStatusFilter,
  toggleCanvasTypeFilter,
  togglePanel,
  toggleSearchPanel,
  uiSlice,
} from './ui.js';

describe('uiSlice', () => {
  afterEach(() => {
    localStorage.clear();
  });

  it('sets the active panel directly', () => {
    const state = uiSlice.reducer(undefined, setActivePanel('assets'));
    expect(state.activePanel).toBe('assets');
  });

  it('accepts the shot template manager as a right panel', () => {
    const state = uiSlice.reducer(undefined, setRightPanel('shotTemplates'));
    expect(state.rightPanel).toBe('shotTemplates');
  });

  it('accepts chat history as a left panel', () => {
    const state = uiSlice.reducer(undefined, setActivePanel('history'));
    expect(state.activePanel).toBe('history');
  });

  it('toggles the same panel off and switches between panels', () => {
    const opened = uiSlice.reducer(undefined, togglePanel('assets'));
    expect(opened.activePanel).toBe('assets');

    const switched = uiSlice.reducer(opened, togglePanel('characters'));
    expect(switched.activePanel).toBe('characters');

    const closed = uiSlice.reducer(switched, togglePanel('characters'));
    expect(closed.activePanel).toBeNull();
  });

  it('stores panel width', () => {
    const resized = uiSlice.reducer(undefined, setPanelWidth(400));
    expect(resized.panelWidth).toBe(400);
  });

  it('clamps and persists left and right panel widths independently', () => {
    let state = uiSlice.reducer(undefined, setPanelWidth(MIN_CANVAS_PANEL_WIDTH - 1));
    state = uiSlice.reducer(state, setRightPanelWidth(MAX_CANVAS_PANEL_WIDTH + 1));

    expect(state.panelWidth).toBe(MIN_CANVAS_PANEL_WIDTH);
    expect(state.rightPanelWidth).toBe(MAX_CANVAS_PANEL_WIDTH);
    expect(localStorage.getItem(LEFT_CANVAS_PANEL_WIDTH_STORAGE_KEY)).toBe(
      String(MIN_CANVAS_PANEL_WIDTH),
    );
    expect(localStorage.getItem(RIGHT_CANVAS_PANEL_WIDTH_STORAGE_KEY)).toBe(
      String(MAX_CANVAS_PANEL_WIDTH),
    );
  });

  it('restores independently clamped panel widths at startup', async () => {
    localStorage.setItem(LEFT_CANVAS_PANEL_WIDTH_STORAGE_KEY, '180');
    localStorage.setItem(RIGHT_CANVAS_PANEL_WIDTH_STORAGE_KEY, '450');
    vi.resetModules();

    const { uiSlice: restoredUiSlice } = await import('./ui.js');
    const state = restoredUiSlice.getInitialState();

    expect(state.panelWidth).toBe(MIN_CANVAS_PANEL_WIDTH);
    expect(state.rightPanelWidth).toBe(450);
  });

  it('manages canvas search state and filters', () => {
    let state = uiSlice.reducer(undefined, setSearchPanelOpen(true));
    state = uiSlice.reducer(state, setCanvasSearchQuery('hero'));
    state = uiSlice.reducer(state, toggleCanvasTypeFilter('image'));
    state = uiSlice.reducer(state, toggleCanvasStatusFilter('generating'));

    expect(state.searchPanelOpen).toBe(true);
    expect(state.canvasSearchQuery).toBe('hero');
    expect(state.canvasTypeFilters).toEqual(['image']);
    expect(state.canvasStatusFilters).toEqual(['generating']);

    state = uiSlice.reducer(state, toggleCanvasTypeFilter('image'));
    state = uiSlice.reducer(state, toggleCanvasStatusFilter('generating'));
    state = uiSlice.reducer(state, toggleSearchPanel());
    state = uiSlice.reducer(state, clearCanvasSearch());

    expect(state.searchPanelOpen).toBe(false);
    expect(state.canvasSearchQuery).toBe('');
    expect(state.canvasTypeFilters).toEqual([]);
    expect(state.canvasStatusFilters).toEqual([]);
  });

  it('stores minimap and snap-to-grid preferences', () => {
    let state = uiSlice.reducer(undefined, setMinimapVisible(false));
    state = uiSlice.reducer(state, setSnapToGrid(false));

    expect(state.minimapVisible).toBe(false);
    expect(state.snapToGrid).toBe(false);
  });
});
