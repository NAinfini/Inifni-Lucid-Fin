import type { IpcMain } from 'electron';
import log from 'electron-log';
import type { StyleGuide } from '@lucid-fin/contracts';
import type { SqliteIndex } from '@lucid-fin/storage';

export function registerSeriesHandlers(ipcMain: IpcMain, db: SqliteIndex): void {
  ipcMain.handle('series:get', async (_e, args?: { id?: string }) => {
    if (!args?.id) return null;
    return db.getSeries(args.id) ?? null;
  });

  ipcMain.handle('series:save', async (_e, data: Record<string, unknown>) => {
    if (!data || typeof data.id !== 'string') throw new Error('series.id is required');
    const now = Date.now();
    db.upsertSeries({
      id: data.id as string,
      title: (data.title as string) ?? '',
      description: (data.description as string) ?? '',
      styleGuide: (data.styleGuide as StyleGuide) ?? {} as StyleGuide,
      episodeIds: Array.isArray(data.episodeIds) ? (data.episodeIds as string[]) : [],
      createdAt: (data.createdAt as number) ?? now,
      updatedAt: now,
    });
    log.info('Series saved:', data.id);
    return db.getSeries(data.id as string);
  });

  ipcMain.handle('series:delete', async (_e, args?: { id?: string }) => {
    if (args?.id) {
      db.deleteSeries(args.id);
    }
    log.info('Series deleted');
  });

  ipcMain.handle('series:episodes:list', async (_e, args?: { seriesId?: string }) => {
    if (!args?.seriesId) return [];
    return db.listEpisodes(args.seriesId);
  });

  ipcMain.handle('series:episodes:add', async (_e, episode: Record<string, unknown>) => {
    if (!episode || typeof episode.id !== 'string') throw new Error('episode.id is required');
    if (typeof episode.seriesId !== 'string') throw new Error('episode.seriesId is required');
    const now = Date.now();
    db.upsertEpisode({
      id: episode.id as string,
      seriesId: episode.seriesId as string,
      title: (episode.title as string) ?? '',
      order: typeof episode.order === 'number' ? episode.order : 0,
      projectId: typeof episode.projectId === 'string' ? episode.projectId : undefined,
      status: typeof episode.status === 'string' ? episode.status : 'draft',
      createdAt: (episode.createdAt as number) ?? now,
      updatedAt: now,
    });
    log.info('Episode added/updated:', episode.id);
    return episode;
  });

  ipcMain.handle('series:episodes:remove', async (_e, args: { id: string }) => {
    if (!args || typeof args.id !== 'string') throw new Error('id is required');
    db.deleteEpisode(args.id);
    log.info('Episode removed:', args.id);
  });

  ipcMain.handle('series:episodes:reorder', async (_e, args: { seriesId: string; ids: string[] }) => {
    if (!args || typeof args.seriesId !== 'string') throw new Error('seriesId is required');
    if (!Array.isArray(args.ids)) throw new Error('ids array is required');
    const episodes = db.listEpisodes(args.seriesId);
    for (let i = 0; i < args.ids.length; i++) {
      const ep = episodes.find((e) => e.id === args.ids[i]);
      if (ep) {
        db.upsertEpisode({ ...ep, projectId: ep.projectId ?? undefined, order: i, updatedAt: Date.now() });
      }
    }
  });
}
