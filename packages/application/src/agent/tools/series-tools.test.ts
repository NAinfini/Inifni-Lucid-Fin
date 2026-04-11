import { describe, expect, it, vi } from 'vitest';
import type { Series } from '@lucid-fin/contracts';
import { createSeriesTools, type SeriesToolDeps } from './series-tools.js';

const series: Series = {
  id: 'series-1',
  title: 'Anthology',
  description: 'Stories',
  styleGuide: {
    global: {
      artStyle: 'cinematic',
      colorPalette: { primary: '#111111', secondary: '#ffffff', forbidden: [] },
      lighting: 'natural',
      texture: 'grain',
      referenceImages: [],
      freeformDescription: '',
    },
    sceneOverrides: {},
  },
  episodeIds: ['episode-1'],
  createdAt: 1,
  updatedAt: 1,
};

function createDeps(): SeriesToolDeps {
  return {
    getSeries: vi.fn(async () => series),
    saveSeries: vi.fn(async (value: Record<string, unknown>) => value),
    listEpisodes: vi.fn(async () => [
      { id: 'episode-1', title: 'Pilot', canvasId: 'canvas-1' },
      { id: 'episode-2', title: 'Finale', canvasId: 'canvas-2' },
    ]),
    addEpisode: vi.fn(async () => ({ id: 'episode-3' })),
    removeEpisode: vi.fn(async () => undefined),
    reorderEpisodes: vi.fn(async (episodeIds: string[]) => episodeIds.map((id, index) => ({
      id,
      seriesId: 'series-1',
      title: id,
      order: index,
      projectId: null,
      status: 'draft',
      createdAt: 1,
      updatedAt: 1,
    }))),
  };
}

function getTool(name: string, deps: SeriesToolDeps) {
  const tool = createSeriesTools(deps).find((entry) => entry.name === name);
  if (!tool) throw new Error(`Missing tool: ${name}`);
  return tool;
}

describe('createSeriesTools', () => {
  it('defines the expected series tool set', () => {
    const deps = createDeps();
    expect(createSeriesTools(deps).map((tool) => tool.name)).toEqual([
      'series.get',
      'series.save',
      'series.listEpisodes',
      'series.addEpisode',
      'series.removeEpisode',
      'series.reorderEpisodes',
    ]);
  });

  it('gets, partially saves, lists, adds, removes, and reorders episodes', async () => {
    const deps = createDeps();

    await expect(getTool('series.get', deps).execute({})).resolves.toEqual({ success: true, data: series });
    await expect(getTool('series.save', deps).execute({
      title: 'Updated',
      description: 'Updated desc',
    })).resolves.toEqual({
      success: true,
      data: { ...series, title: 'Updated', description: 'Updated desc' },
    });
    await expect(getTool('series.listEpisodes', deps).execute({ offset: 1, limit: 1 })).resolves.toEqual({
      success: true,
      data: {
        total: 2,
        offset: 1,
        limit: 1,
        episodes: [{ id: 'episode-2', title: 'Finale', canvasId: 'canvas-2' }],
      },
    });
    await expect(getTool('series.addEpisode', deps).execute({
      title: ' Chapter 3 ',
      canvasId: ' canvas-3 ',
    })).resolves.toEqual({ success: true, data: { id: 'episode-3' } });
    expect(deps.addEpisode).toHaveBeenCalledWith('Chapter 3', 'canvas-3');

    await expect(getTool('series.removeEpisode', deps).execute({ episodeId: 'episode-1' })).resolves.toEqual({
      success: true,
      data: { episodeId: 'episode-1' },
    });
    await expect(getTool('series.reorderEpisodes', deps).execute({
      episodeIds: ['episode-2', 'episode-1'],
    })).resolves.toEqual({
      success: true,
      data: [
        expect.objectContaining({ id: 'episode-2', order: 0 }),
        expect.objectContaining({ id: 'episode-1', order: 1 }),
      ],
    });
  });

  it('supports saving a full series object and validates arguments', async () => {
    const deps = createDeps();

    await expect(getTool('series.save', deps).execute({ series })).resolves.toEqual({
      success: true,
      data: series,
    });
    expect(deps.saveSeries).toHaveBeenCalledWith(series);

    await expect(getTool('series.save', deps).execute({ series: [] })).resolves.toEqual({
      success: false,
      error: 'series is required',
    });
    await expect(getTool('series.addEpisode', deps).execute({ title: ' ' })).resolves.toEqual({
      success: false,
      error: 'title is required',
    });
    await expect(getTool('series.reorderEpisodes', deps).execute({ episodeIds: ['episode-1', ''] })).resolves.toEqual({
      success: false,
      error: 'episodeIds[1] must be a non-empty string',
    });
  });

  it('reports unavailable reordering and dependency failures', async () => {
    const deps = createDeps();
    const toolsWithoutReorder = createSeriesTools({ ...deps, reorderEpisodes: undefined });
    const reorderTool = toolsWithoutReorder.find((tool) => tool.name === 'series.reorderEpisodes');
    if (!reorderTool) throw new Error('Missing reorder tool');

    await expect(reorderTool.execute({ episodeIds: ['episode-1'] })).resolves.toEqual({
      success: false,
      error: 'Episode reordering not available',
    });

    vi.mocked(deps.removeEpisode).mockRejectedValueOnce(new Error('remove failed'));
    await expect(getTool('series.removeEpisode', deps).execute({ episodeId: 'episode-2' })).resolves.toEqual({
      success: false,
      error: 'remove failed',
    });
  });
});
