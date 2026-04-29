import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  addEpisode,
  addSharedResource,
  clearResourceOverride,
  clearSeries,
  removeEpisode,
  removeSharedResource,
  reorderEpisode,
  seriesSlice,
  setActiveEpisode,
  setResourceOverride,
  setSeries,
  updateEpisode,
} from './series.js';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('series slice', () => {
  it('has the expected initial state', () => {
    expect(seriesSlice.reducer(undefined, { type: '@@INIT' })).toEqual({
      id: '',
      title: '',
      description: '',
      episodes: [],
      sharedResources: [],
      activeEpisodeId: null,
    });
  });

  it('exports action creators with the expected payloads', () => {
    expect(setSeries({ id: 'series-1', title: 'Anthology' })).toMatchObject({
      type: 'series/setSeries',
      payload: { id: 'series-1', title: 'Anthology' },
    });
    expect(addEpisode({ id: 'ep-1', title: 'Pilot' })).toMatchObject({
      type: 'series/addEpisode',
      payload: { id: 'ep-1', title: 'Pilot' },
    });
    expect(removeEpisode('ep-1')).toMatchObject({
      type: 'series/removeEpisode',
      payload: 'ep-1',
    });
    expect(reorderEpisode({ id: 'ep-1', newOrder: 2 })).toMatchObject({
      type: 'series/reorderEpisode',
      payload: { id: 'ep-1', newOrder: 2 },
    });
    expect(
      updateEpisode({ id: 'ep-1', data: { title: 'Pilot v2', status: 'review' } }),
    ).toMatchObject({
      type: 'series/updateEpisode',
      payload: { id: 'ep-1', data: { title: 'Pilot v2', status: 'review' } },
    });
    expect(setActiveEpisode('ep-1')).toMatchObject({
      type: 'series/setActiveEpisode',
      payload: 'ep-1',
    });
    expect(
      addSharedResource({
        id: 'resource-1',
        type: 'character',
        name: 'Hero',
        sourceEpisodeId: 'ep-1',
      }),
    ).toMatchObject({
      type: 'series/addSharedResource',
      payload: {
        id: 'resource-1',
        type: 'character',
        name: 'Hero',
        sourceEpisodeId: 'ep-1',
      },
    });
    expect(removeSharedResource('resource-1')).toMatchObject({
      type: 'series/removeSharedResource',
      payload: 'resource-1',
    });
    expect(
      setResourceOverride({
        resourceId: 'resource-1',
        episodeId: 'ep-1',
        data: { outfit: 'armor' },
      }),
    ).toMatchObject({
      type: 'series/setResourceOverride',
      payload: { resourceId: 'resource-1', episodeId: 'ep-1', data: { outfit: 'armor' } },
    });
    expect(clearResourceOverride({ resourceId: 'resource-1', episodeId: 'ep-1' })).toMatchObject({
      type: 'series/clearResourceOverride',
      payload: { resourceId: 'resource-1', episodeId: 'ep-1' },
    });
    expect(clearSeries()).toMatchObject({
      type: 'series/clearSeries',
    });
  });

  it('sets base series fields without overwriting omitted values', () => {
    let state = seriesSlice.reducer(
      undefined,
      setSeries({ id: 'series-1', title: 'Anthology', description: 'Short stories' }),
    );
    state = seriesSlice.reducer(state, setSeries({ title: 'Anthology Vol. 2' }));

    expect(state).toMatchObject({
      id: 'series-1',
      title: 'Anthology Vol. 2',
      description: 'Short stories',
    });
  });

  it('adds episodes once, updates them, reorders them, and removes active episodes', () => {
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(50);
    let state = seriesSlice.reducer(undefined, addEpisode({ id: 'ep-1', title: 'Pilot' }));
    state = seriesSlice.reducer(state, addEpisode({ id: 'ep-2', title: 'Finale' }));
    state = seriesSlice.reducer(state, addEpisode({ id: 'ep-3', title: 'Interlude' }));
    state = seriesSlice.reducer(state, addEpisode({ id: 'ep-2', title: 'Duplicate' }));
    state = seriesSlice.reducer(state, setActiveEpisode('ep-2'));

    nowSpy.mockReturnValue(75);
    state = seriesSlice.reducer(
      state,
      updateEpisode({ id: 'ep-2', data: { title: 'Finale Revised', status: 'review' } }),
    );
    state = seriesSlice.reducer(
      state,
      updateEpisode({ id: 'missing', data: { title: 'Ignored' } }),
    );

    state = seriesSlice.reducer(state, reorderEpisode({ id: 'ep-3', newOrder: -5 }));
    state = seriesSlice.reducer(state, reorderEpisode({ id: 'ep-1', newOrder: 99 }));
    state = seriesSlice.reducer(state, reorderEpisode({ id: 'missing', newOrder: 1 }));
    state = seriesSlice.reducer(state, removeEpisode('ep-2'));

    expect(state.episodes.map((episode) => ({ id: episode.id, order: episode.order }))).toEqual([
      { id: 'ep-3', order: 0 },
      { id: 'ep-1', order: 1 },
    ]);
    expect(state.episodes.find((episode) => episode.id === 'ep-2')).toBeUndefined();
    expect(state.activeEpisodeId).toBe('ep-3');
  });

  it('adds shared resources and manages episode-level overrides', () => {
    let state = seriesSlice.reducer(
      undefined,
      addSharedResource({
        id: 'resource-1',
        type: 'character',
        name: 'Hero',
        sourceEpisodeId: 'ep-1',
      }),
    );

    state = seriesSlice.reducer(
      state,
      setResourceOverride({
        resourceId: 'resource-1',
        episodeId: 'ep-1',
        data: { costume: 'armor' },
      }),
    );
    state = seriesSlice.reducer(
      state,
      setResourceOverride({
        resourceId: 'resource-1',
        episodeId: 'ep-2',
        data: { costume: 'cloak' },
      }),
    );
    state = seriesSlice.reducer(
      state,
      setResourceOverride({
        resourceId: 'missing',
        episodeId: 'ep-3',
        data: { ignored: true },
      }),
    );
    state = seriesSlice.reducer(
      state,
      clearResourceOverride({ resourceId: 'resource-1', episodeId: 'ep-1' }),
    );
    state = seriesSlice.reducer(
      state,
      clearResourceOverride({ resourceId: 'missing', episodeId: 'ep-1' }),
    );
    state = seriesSlice.reducer(state, removeSharedResource('resource-1'));
    state = seriesSlice.reducer(state, removeSharedResource('missing'));

    expect(state.sharedResources).toEqual([]);
  });

  it('clears the full series state', () => {
    let state = seriesSlice.reducer(
      undefined,
      setSeries({ id: 'series-1', title: 'Anthology', description: 'Stories' }),
    );
    state = seriesSlice.reducer(state, addEpisode({ id: 'ep-1', title: 'Pilot' }));
    state = seriesSlice.reducer(
      state,
      addSharedResource({
        id: 'resource-1',
        type: 'asset',
        name: 'Theme Song',
      }),
    );
    state = seriesSlice.reducer(state, setActiveEpisode('ep-1'));
    state = seriesSlice.reducer(state, clearSeries());

    expect(state).toEqual({
      id: '',
      title: '',
      description: '',
      episodes: [],
      sharedResources: [],
      activeEpisodeId: null,
    });
  });
});
