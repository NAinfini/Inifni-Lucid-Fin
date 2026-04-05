// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import {
  clearCanvasSearch,
  setActivePanel,
  setCanvasSearchQuery,
  setMinimapVisible,
  setPanelWidth,
  setSearchPanelOpen,
  setSnapToGrid,
  toggleCanvasStatusFilter,
  toggleCanvasTypeFilter,
  togglePanel,
  toggleSearchPanel,
  uiSlice,
} from './ui.js';

describe('uiSlice', () => {
  it('sets the active panel directly', () => {
    const state = uiSlice.reducer(undefined, setActivePanel('assets'));
    expect(state.activePanel).toBe('assets');
  });

  it('accepts the shot template manager as a left panel', () => {
    const state = uiSlice.reducer(undefined, setActivePanel('shotTemplates'));
    expect(state.activePanel).toBe('shotTemplates');
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
