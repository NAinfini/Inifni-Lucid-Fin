import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import type { NodeKind, NodeStatus } from '@lucid-fin/contracts';

export type LeftPanelId =
  | 'add'
  | 'assets'
  | 'characters'
  | 'equipment'
  | 'locations'
  | 'shotTemplates'
  | 'presets'
  | 'canvases';

export type RightPanelId =
  | 'inspector'
  | 'logger'
  | 'dependencies'
  | 'queue'
  | 'history'
  | 'notes'
  | 'export';

export type Theme = 'light' | 'dark' | 'high-contrast' | 'auto';

export type CanvasViewMode = 'main' | 'edit' | 'audio' | 'materials';

export interface UIState {
  activePanel: LeftPanelId | null;
  panelWidth: number;
  rightPanel: RightPanelId | null;
  rightPanelWidth: number;
  searchPanelOpen: boolean;
  canvasSearchQuery: string;
  canvasTypeFilters: NodeKind[];
  canvasStatusFilters: NodeStatus[];
  minimapVisible: boolean;
  snapToGrid: boolean;
  theme: Theme;
  hoveredDependencyNodeId: string | null;
  onboardingComplete: boolean;
  canvasViewMode: CanvasViewMode;
  editViewFocusedNodeId: string | null;
}

export function resolveEffectiveTheme(theme: Theme): 'light' | 'dark' | 'high-contrast' {
  if (theme !== 'auto') return theme;
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  } catch { return 'dark'; }
}

export function applyThemeToDOM(theme: Theme): void {
  const effective = resolveEffectiveTheme(theme);
  document.documentElement.classList.toggle('dark', effective === 'dark');
  document.documentElement.classList.toggle('high-contrast', effective === 'high-contrast');
}

function loadTheme(): Theme {
  try {
    const stored = localStorage.getItem('lucid-fin:theme');
    if (stored === 'light' || stored === 'dark' || stored === 'high-contrast' || stored === 'auto') {
      applyThemeToDOM(stored);
      return stored;
    }
  } catch { /* localStorage unavailable */ }
  document.documentElement.classList.add('dark');
  return 'dark';
}

function loadOnboardingComplete(): boolean {
  try {
    return localStorage.getItem('lucid-fin:onboarding-complete') === 'true';
  } catch { /* localStorage unavailable */ }
  return false;
}

const initialState: UIState = {
  activePanel: null,
  panelWidth: 320,
  rightPanel: null,
  rightPanelWidth: 320,
  searchPanelOpen: false,
  canvasSearchQuery: '',
  canvasTypeFilters: [],
  canvasStatusFilters: [],
  minimapVisible: true,
  snapToGrid: true,
  theme: loadTheme(),
  hoveredDependencyNodeId: null,
  onboardingComplete: loadOnboardingComplete(),
  canvasViewMode: 'main',
  editViewFocusedNodeId: null,
};

export const uiSlice = createSlice({
  name: 'ui',
  initialState,
  reducers: {
    setActivePanel(state, action: PayloadAction<LeftPanelId | null>) {
      state.activePanel = action.payload;
    },
    togglePanel(state, action: PayloadAction<LeftPanelId>) {
      state.activePanel = state.activePanel === action.payload ? null : action.payload;
    },
    setPanelWidth(state, action: PayloadAction<number>) {
      state.panelWidth = action.payload;
    },
    setRightPanel(state, action: PayloadAction<RightPanelId | null>) {
      state.rightPanel = action.payload;
    },
    toggleRightPanel(state, action: PayloadAction<RightPanelId>) {
      state.rightPanel = state.rightPanel === action.payload ? null : action.payload;
    },
    setRightPanelWidth(state, action: PayloadAction<number>) {
      state.rightPanelWidth = action.payload;
    },
    setSearchPanelOpen(state, action: PayloadAction<boolean>) {
      state.searchPanelOpen = action.payload;
    },
    toggleSearchPanel(state) {
      state.searchPanelOpen = !state.searchPanelOpen;
    },
    setCanvasSearchQuery(state, action: PayloadAction<string>) {
      state.canvasSearchQuery = action.payload;
    },
    toggleCanvasTypeFilter(state, action: PayloadAction<NodeKind>) {
      if (state.canvasTypeFilters.includes(action.payload)) {
        state.canvasTypeFilters = state.canvasTypeFilters.filter((type) => type !== action.payload);
      } else {
        state.canvasTypeFilters.push(action.payload);
      }
    },
    toggleCanvasStatusFilter(state, action: PayloadAction<NodeStatus>) {
      if (state.canvasStatusFilters.includes(action.payload)) {
        state.canvasStatusFilters = state.canvasStatusFilters.filter((status) => status !== action.payload);
      } else {
        state.canvasStatusFilters.push(action.payload);
      }
    },
    clearCanvasSearch(state) {
      state.canvasSearchQuery = '';
      state.canvasTypeFilters = [];
      state.canvasStatusFilters = [];
    },
    setMinimapVisible(state, action: PayloadAction<boolean>) {
      state.minimapVisible = action.payload;
    },
    toggleMinimapVisible(state) {
      state.minimapVisible = !state.minimapVisible;
    },
    setSnapToGrid(state, action: PayloadAction<boolean>) {
      state.snapToGrid = action.payload;
    },
    toggleSnapToGrid(state) {
      state.snapToGrid = !state.snapToGrid;
    },
    setTheme(state, action: PayloadAction<Theme>) {
      state.theme = action.payload;
      applyThemeToDOM(action.payload);
      try {
        localStorage.setItem('lucid-fin:theme', action.payload);
      } catch { /* localStorage unavailable */ }
    },
    setHoveredDependencyNodeId(state, action: PayloadAction<string | null>) {
      state.hoveredDependencyNodeId = action.payload;
    },
    setOnboardingComplete(state, action: PayloadAction<boolean>) {
      state.onboardingComplete = action.payload;
      try {
        localStorage.setItem('lucid-fin:onboarding-complete', action.payload ? 'true' : 'false');
      } catch { /* localStorage unavailable */ }
    },
    restore(_state, action: PayloadAction<UIState>) {
      return action.payload;
    },
    setCanvasViewMode(state, action: PayloadAction<CanvasViewMode>) {
      state.canvasViewMode = action.payload;
    },
    setEditViewFocusedNodeId(state, action: PayloadAction<string | null>) {
      state.editViewFocusedNodeId = action.payload;
    },
  },
});

export const {
  setActivePanel,
  togglePanel,
  setPanelWidth,
  setRightPanel,
  toggleRightPanel,
  setRightPanelWidth,
  setSearchPanelOpen,
  toggleSearchPanel,
  setCanvasSearchQuery,
  toggleCanvasTypeFilter,
  toggleCanvasStatusFilter,
  clearCanvasSearch,
  setMinimapVisible,
  toggleMinimapVisible,
  setSnapToGrid,
  toggleSnapToGrid,
  setTheme,
  setHoveredDependencyNodeId,
  setOnboardingComplete,
  restore,
  setCanvasViewMode,
  setEditViewFocusedNodeId,
} = uiSlice.actions;
