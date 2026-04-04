import { createSlice, type PayloadAction } from '@reduxjs/toolkit';

export interface SharedResource {
  id: string;
  type: 'character' | 'style' | 'template' | 'asset';
  name: string;
  sourceEpisodeId?: string;
  /** Episode-level overrides keyed by episodeId */
  overrides: Record<string, Record<string, unknown>>;
}

export interface Episode {
  id: string;
  title: string;
  order: number;
  projectId: string;
  status: 'draft' | 'in_progress' | 'review' | 'final';
  createdAt: number;
  updatedAt: number;
}

export interface SeriesState {
  id: string;
  title: string;
  description: string;
  episodes: Episode[];
  sharedResources: SharedResource[];
  activeEpisodeId: string | null;
}

const initialState: SeriesState = {
  id: '',
  title: '',
  description: '',
  episodes: [],
  sharedResources: [],
  activeEpisodeId: null,
};

export const seriesSlice = createSlice({
  name: 'series',
  initialState,
  reducers: {
    setSeries(
      state,
      action: PayloadAction<Partial<Pick<SeriesState, 'id' | 'title' | 'description'>>>,
    ) {
      const { title, description, id } = action.payload;
      if (id !== undefined) state.id = id;
      if (title !== undefined) state.title = title;
      if (description !== undefined) state.description = description;
    },

    addEpisode(state, action: PayloadAction<{ id: string; title: string; projectId: string }>) {
      const { id, title, projectId } = action.payload;
      if (state.episodes.some((e) => e.id === id)) return;
      state.episodes.push({
        id,
        title,
        projectId,
        order: state.episodes.length,
        status: 'draft',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    },

    removeEpisode(state, action: PayloadAction<string>) {
      state.episodes = state.episodes.filter((e) => e.id !== action.payload);
      // Reorder
      state.episodes.forEach((e, i) => {
        e.order = i;
      });
      if (state.activeEpisodeId === action.payload) {
        state.activeEpisodeId = state.episodes[0]?.id ?? null;
      }
    },

    reorderEpisode(state, action: PayloadAction<{ id: string; newOrder: number }>) {
      const { id, newOrder } = action.payload;
      const idx = state.episodes.findIndex((e) => e.id === id);
      if (idx < 0) return;
      const clamped = Math.max(0, Math.min(newOrder, state.episodes.length - 1));
      const [ep] = state.episodes.splice(idx, 1);
      state.episodes.splice(clamped, 0, ep);
      state.episodes.forEach((e, i) => {
        e.order = i;
      });
    },

    updateEpisode(
      state,
      action: PayloadAction<{ id: string; data: Partial<Pick<Episode, 'title' | 'status'>> }>,
    ) {
      const ep = state.episodes.find((e) => e.id === action.payload.id);
      if (!ep) return;
      const { title, status } = action.payload.data;
      if (title !== undefined) ep.title = title;
      if (status !== undefined) ep.status = status;
      ep.updatedAt = Date.now();
    },

    setActiveEpisode(state, action: PayloadAction<string | null>) {
      state.activeEpisodeId = action.payload;
    },

    // --- Shared Resources ---

    addSharedResource(state, action: PayloadAction<Omit<SharedResource, 'overrides'>>) {
      state.sharedResources.push({ ...action.payload, overrides: {} });
    },

    removeSharedResource(state, action: PayloadAction<string>) {
      state.sharedResources = state.sharedResources.filter((r) => r.id !== action.payload);
    },

    /** Set an episode-level override for a shared resource (read-only inheritance, episode-level overwrite) */
    setResourceOverride(
      state,
      action: PayloadAction<{
        resourceId: string;
        episodeId: string;
        data: Record<string, unknown>;
      }>,
    ) {
      const res = state.sharedResources.find((r) => r.id === action.payload.resourceId);
      if (res) {
        res.overrides[action.payload.episodeId] = action.payload.data;
      }
    },

    clearResourceOverride(state, action: PayloadAction<{ resourceId: string; episodeId: string }>) {
      const res = state.sharedResources.find((r) => r.id === action.payload.resourceId);
      if (res) {
        delete res.overrides[action.payload.episodeId];
      }
    },

    clearSeries() {
      return {
        ...initialState,
        episodes: [],
        sharedResources: [],
      };
    },
  },
});

export const {
  setSeries,
  addEpisode,
  removeEpisode,
  reorderEpisode,
  updateEpisode,
  setActiveEpisode,
  addSharedResource,
  removeSharedResource,
  setResourceOverride,
  clearResourceOverride,
  clearSeries,
} = seriesSlice.actions;

export type { SeriesState as SeriesSliceState };
