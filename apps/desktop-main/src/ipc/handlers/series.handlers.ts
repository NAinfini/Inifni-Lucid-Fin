import type { IpcMain } from 'electron';
import log from '../../logger.js';
import type { StyleGuide } from '@lucid-fin/contracts';
import type { SqliteIndex } from '@lucid-fin/storage';
import { parseSeriesId, parseEpisodeId } from '@lucid-fin/contracts-parse';
import { safeHandle } from '../ipc-error-handler.js';

export function registerSeriesHandlers(ipcMain: IpcMain, db: SqliteIndex): void {
  safeHandle(ipcMain, 'series:get', async (_e, args?: { id?: string }) => {
    if (!args?.id) return null;
    return db.repos.series.getSeries(parseSeriesId(args.id)) ?? null;
  });

  safeHandle(ipcMain, 'series:save', async (_e, data: Record<string, unknown>) => {
    if (!data || typeof data.id !== 'string') throw new Error('series.id is required');
    const now = Date.now();
    db.repos.series.upsertSeries({
      id: parseSeriesId(data.id),
      title: (data.title as string) ?? '',
      description: (data.description as string) ?? '',
      styleGuide: (data.styleGuide as StyleGuide) ?? ({} as StyleGuide),
      episodeIds: Array.isArray(data.episodeIds) ? (data.episodeIds as string[]) : [],
      createdAt: (data.createdAt as number) ?? now,
      updatedAt: now,
    });
    log.info('Series saved:', data.id);
    return db.repos.series.getSeries(parseSeriesId(data.id));
  });

  safeHandle(ipcMain, 'series:delete', async (_e, args?: { id?: string }) => {
    if (args?.id) {
      db.repos.series.deleteSeries(parseSeriesId(args.id));
    }
    log.info('Series deleted');
  });

  safeHandle(ipcMain, 'series:episodes:list', async (_e, args?: { seriesId?: string }) => {
    if (!args?.seriesId) return [];
    return db.repos.series.listEpisodes(parseSeriesId(args.seriesId)).rows;
  });

  safeHandle(ipcMain, 'series:episodes:add', async (_e, episode: Record<string, unknown>) => {
    if (!episode || typeof episode.id !== 'string') throw new Error('episode.id is required');
    if (typeof episode.seriesId !== 'string') throw new Error('episode.seriesId is required');
    const now = Date.now();
    db.repos.series.upsertEpisode({
      id: parseEpisodeId(episode.id),
      seriesId: parseSeriesId(episode.seriesId),
      title: (episode.title as string) ?? '',
      order: typeof episode.order === 'number' ? episode.order : 0,
      status: typeof episode.status === 'string' ? episode.status : 'draft',
      createdAt: (episode.createdAt as number) ?? now,
      updatedAt: now,
    });
    log.info('Episode added/updated:', episode.id);
    return episode;
  });

  safeHandle(ipcMain, 'series:episodes:remove', async (_e, args: { id: string }) => {
    if (!args || typeof args.id !== 'string') throw new Error('id is required');
    db.repos.series.deleteEpisode(parseEpisodeId(args.id));
    log.info('Episode removed:', args.id);
  });

  safeHandle(
    ipcMain,
    'series:episodes:reorder',
    async (_e, args: { seriesId: string; ids: string[] }) => {
      if (!args || typeof args.seriesId !== 'string') throw new Error('seriesId is required');
      if (!Array.isArray(args.ids)) throw new Error('ids array is required');
      const seriesId = parseSeriesId(args.seriesId);
      const episodes = db.repos.series.listEpisodes(seriesId).rows;
      for (let i = 0; i < args.ids.length; i++) {
        const ep = episodes.find((e) => e.id === args.ids[i]);
        if (ep) {
          db.repos.series.upsertEpisode({
            ...ep,
            id: parseEpisodeId(ep.id),
            seriesId,
            order: i,
            updatedAt: Date.now(),
          });
        }
      }
    },
  );
}
