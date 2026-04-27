import { describe, expect, it, vi } from 'vitest';

const logger = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  fatal: vi.fn(),
}));

vi.mock('../../logger.js', () => ({
  default: logger,
  debug: logger.debug,
  info: logger.info,
  warn: logger.warn,
  error: logger.error,
  fatal: logger.fatal,
}));

import { registerSeriesHandlers } from './series.handlers.js';

function makeMockDb() {
  const upsertSeries = vi.fn();
  const getSeries = vi.fn(() => null);
  return {
    repos: {
      series: {
        getSeries,
        upsertSeries,
        deleteSeries: vi.fn(),
        listEpisodes: vi.fn(() => ({ rows: [] })),
        upsertEpisode: vi.fn(),
        deleteEpisode: vi.fn(),
      },
    },
    upsertSeries,
    getSeries,
  };
}

function registerHandlers(db: ReturnType<typeof makeMockDb>) {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  registerSeriesHandlers(
    {
      handle(channel: string, handler: (...args: unknown[]) => unknown) {
        handlers.set(channel, handler);
      },
    } as never,
    db as never,
  );
  return handlers;
}

describe('registerSeriesHandlers', () => {
  it('saves a series with valid episodeIds (UUID strings)', async () => {
    const db = makeMockDb();
    const handlers = registerHandlers(db);
    const save = handlers.get('series:save');

    await save?.(
      {},
      {
        id: 'series-aabbccdd-0000-0000-0000-000000000001',
        title: 'My Series',
        episodeIds: [
          'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
          'b3d3c4d5-e6f7-4a8b-9c0d-1e2f3a4b5c6d',
        ],
      },
    );

    expect(db.repos.series.upsertSeries).toHaveBeenCalledWith(
      expect.objectContaining({
        episodeIds: [
          'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
          'b3d3c4d5-e6f7-4a8b-9c0d-1e2f3a4b5c6d',
        ],
      }),
    );
  });

  it('rejects series:save when id is missing', async () => {
    const db = makeMockDb();
    const handlers = registerHandlers(db);
    const save = handlers.get('series:save');

    await expect(
      save?.(
        {},
        {
          title: 'No ID',
          episodeIds: [],
        },
      ),
    ).rejects.toMatchObject({ __ipcError: true, code: 'UNKNOWN' });
    expect(db.repos.series.upsertSeries).not.toHaveBeenCalled();
  });
});
