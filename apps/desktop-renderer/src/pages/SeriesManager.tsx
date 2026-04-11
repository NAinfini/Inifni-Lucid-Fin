import React, { useState, useCallback, useEffect } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import {
  Library,
  Plus,
  Trash2,
  Film,
  Users,
  Palette,
  FolderOpen,
  ChevronRight,
} from 'lucide-react';
import type { RootState, AppDispatch } from '../store/index.js';
import {
  setSeries,
  clearSeries,
  addEpisode,
  removeEpisode,
  updateEpisode,
} from '../store/slices/series.js';
import { addLog } from '../store/slices/logger.js';
import { getAPI } from '../utils/api.js';
import { t } from '../i18n.js';

interface SeriesInfo {
  id: string;
  title: string;
  description: string;
  episodeCount: number;
}

const STATUS_LABELS: Record<string, string> = {
  draft: 'series.status.draft',
  in_progress: 'series.status.inProgress',
  review: 'series.status.review',
  final: 'series.status.final',
};

export function SeriesManager() {
  const dispatch = useDispatch<AppDispatch>();
  const series = useSelector((s: RootState) => s.series);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [selectedSeriesId, setSelectedSeriesId] = useState<string | null>(null);
  const [newEpisodeTitle, setNewEpisodeTitle] = useState('');

  const hasSeries = Boolean(
    series.id || series.title.trim() || series.description.trim() || series.episodes.length > 0,
  );
  const seriesList: SeriesInfo[] = hasSeries
    ? [
        {
          id: series.id || 'current-series',
          title: series.title || t('series.unnamedSeries'),
          description: series.description,
          episodeCount: series.episodes.length,
        },
      ]
    : [];

  // Load series from IPC on mount
  useEffect(() => {
    const api = getAPI();
    if (!api?.series) return;
    api.series
      .get()
      .then((data) => {
        if (data) {
          dispatch(setSeries({ id: data.id, title: data.title, description: data.description }));
        }
      })
      .catch((err) => {
        dispatch(
          addLog({
            level: 'error',
            category: 'series',
            message: t('series.log.loadFailed'),
            detail: err instanceof Error ? err.stack ?? err.message : String(err),
          }),
        );
      });
  }, [dispatch]);

  const handleCreate = useCallback(async () => {
    if (!newName.trim()) return;
    const id = crypto.randomUUID();
    dispatch(setSeries({ id, title: newName.trim(), description: newDescription.trim() }));
    // Persist via IPC
    const api = getAPI();
    if (api?.series) {
      try {
        await api.series.save({ id, title: newName.trim(), description: newDescription.trim() });
      } catch (err) {
        dispatch(
          addLog({
            level: 'error',
            category: 'series',
            message: t('series.log.saveFailed'),
            detail: err instanceof Error ? err.stack ?? err.message : String(err),
          }),
        );
      }
    }
    setNewName('');
    setNewDescription('');
    setShowCreate(false);
    setSelectedSeriesId(id);
  }, [dispatch, newName, newDescription]);

  const handleDelete = useCallback(async () => {
    dispatch(clearSeries());
    setSelectedSeriesId(null);
    const api = getAPI();
    if (api?.series) {
      try {
        await api.series.delete();
      } catch (err) {
        dispatch(
          addLog({
            level: 'error',
            category: 'series',
            message: t('series.log.deleteFailed'),
            detail: err instanceof Error ? err.stack ?? err.message : String(err),
          }),
        );
      }
    }
  }, [dispatch]);

  const handleAddEpisode = useCallback(async () => {
    if (!newEpisodeTitle.trim()) return;
    const id = crypto.randomUUID();
    const projectId = crypto.randomUUID();
    dispatch(addEpisode({ id, title: newEpisodeTitle.trim(), projectId }));
    const api = getAPI();
    if (api?.series?.episodes) {
      try {
        await api.series.episodes.add({
          id,
          title: newEpisodeTitle.trim(),
          projectId,
          order: series.episodes.length,
          status: 'draft',
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });
      } catch (err) {
        dispatch(
          addLog({
            level: 'error',
            category: 'series',
            message: t('series.log.addEpisodeFailed'),
            detail: err instanceof Error ? err.stack ?? err.message : String(err),
          }),
        );
      }
    }
    setNewEpisodeTitle('');
  }, [dispatch, newEpisodeTitle, series.episodes.length]);

  const handleRemoveEpisode = useCallback(
    async (episodeId: string) => {
      dispatch(removeEpisode(episodeId));
      const api = getAPI();
      if (api?.series?.episodes) {
        try {
          await api.series.episodes.remove(episodeId);
        } catch (err) {
          dispatch(
            addLog({
              level: 'error',
              category: 'series',
              message: t('series.log.removeEpisodeFailed'),
              detail: err instanceof Error ? err.stack ?? err.message : String(err),
            }),
          );
        }
      }
    },
    [dispatch],
  );

  const handleStatusChange = useCallback(
    async (episodeId: string, status: string) => {
      dispatch(
        updateEpisode({
          id: episodeId,
          data: { status: status as 'draft' | 'in_progress' | 'review' | 'final' },
        }),
      );
    },
    [dispatch],
  );

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-1.5 px-3 py-2 border-b border-border/60 bg-card">
        <Library className="w-3.5 h-3.5 text-primary" />
        <span className="text-xs font-medium">{t('series.title')}</span>
        <div className="flex-1" />
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-1 px-2.5 py-1 text-[10px] rounded-md bg-primary text-primary-foreground hover:opacity-90"
        >
          <Plus className="w-3 h-3" /> {t('series.newSeries')}
        </button>
      </div>

      <div className="flex flex-1 min-h-0">
        {/* Series list */}
        <div className="w-64 border-r border-border/60 overflow-y-auto">
          {seriesList.length === 0 && !showCreate ? (
            <div className="flex flex-col items-center justify-center h-full p-4 text-center text-muted-foreground">
              <Library className="w-10 h-10 mb-2 opacity-20" />
              <p className="text-xs">{t('series.empty')}</p>
              <p className="text-[10px] mt-0.5">{t('series.emptyHint')}</p>
            </div>
          ) : (
            <div className="divide-y divide-border/40">
              {seriesList.map((s) => (
                <div
                  key={s.id}
                  onClick={() => setSelectedSeriesId(s.id)}
                  className={`flex items-center gap-1.5 px-2.5 py-2 cursor-pointer hover:bg-muted transition-colors ${selectedSeriesId === s.id ? 'bg-muted' : ''}`}
                >
                  <Film className="w-3.5 h-3.5 text-primary shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium truncate">{s.title}</p>
                    <p className="text-[10px] text-muted-foreground">
                      {s.episodeCount} {t('series.episodesUnit')}
                    </p>
                  </div>
                  <ChevronRight className="w-3 h-3 text-muted-foreground" />
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Detail panel */}
        <div className="flex-1 overflow-y-auto p-4">
          {showCreate ? (
            <div className="max-w-md space-y-3">
              <h2 className="text-sm font-medium">{t('series.newSeries')}</h2>
              <div>
                <label className="block text-[10px] text-muted-foreground mb-0.5">
                  {t('series.fields.name')}
                </label>
                <input
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  className="w-full px-2.5 py-1.5 text-xs rounded-md border border-border/60 bg-background"
                  placeholder={t('series.placeholders.seriesName')}
                />
              </div>
              <div>
                <label className="block text-[10px] text-muted-foreground mb-0.5">
                  {t('series.fields.description')}
                </label>
                <textarea
                  value={newDescription}
                  onChange={(e) => setNewDescription(e.target.value)}
                  className="w-full px-2.5 py-1.5 text-xs rounded-md border border-border/60 bg-background resize-none h-16"
                  placeholder={t('series.placeholders.seriesDescription')}
                />
              </div>
              <div className="flex gap-1.5">
                <button
                  onClick={handleCreate}
                  className="px-3 py-1.5 text-xs rounded-md bg-primary text-primary-foreground hover:opacity-90"
                >
                  {t('series.create')}
                </button>
                <button
                  onClick={() => setShowCreate(false)}
                  className="px-3 py-1.5 text-xs rounded-md bg-secondary hover:bg-muted"
                >
                  {t('action.cancel')}
                </button>
              </div>
            </div>
          ) : selectedSeriesId ? (
            (() => {
              const selected = seriesList.find((s) => s.id === selectedSeriesId);
              if (!selected) return null;
              return (
                <div className="space-y-4">
                  <div>
                    <h2 className="text-sm font-medium">{selected.title}</h2>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {selected.description || t('series.noDescription')}
                    </p>
                  </div>

                  {/* Shared resources */}
                  <div className="grid grid-cols-3 gap-2">
                    <div className="p-3 rounded-md border border-border/60 text-center">
                      <Users className="w-5 h-5 mx-auto mb-1.5 text-primary" />
                      <p className="text-xs font-medium">{t('series.sharedCharacters')}</p>
                      <p className="text-[10px] text-muted-foreground mt-0.5">
                        {t('series.sharedCharactersHint')}
                      </p>
                    </div>
                    <div className="p-3 rounded-md border border-border/60 text-center">
                      <Palette className="w-5 h-5 mx-auto mb-1.5 text-primary" />
                      <p className="text-xs font-medium">{t('series.sharedStyle')}</p>
                      <p className="text-[10px] text-muted-foreground mt-0.5">
                        {t('series.sharedStyleHint')}
                      </p>
                    </div>
                    <div className="p-3 rounded-md border border-border/60 text-center">
                      <FolderOpen className="w-5 h-5 mx-auto mb-1.5 text-primary" />
                      <p className="text-xs font-medium">{t('series.sharedTemplates')}</p>
                      <p className="text-[10px] text-muted-foreground mt-0.5">
                        {t('series.sharedTemplatesHint')}
                      </p>
                    </div>
                  </div>

                  {/* Episodes table */}
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <h3 className="text-xs font-medium">{t('series.episodeList')}</h3>
                      <div className="flex items-center gap-1.5">
                        <input
                          value={newEpisodeTitle}
                          onChange={(e) => setNewEpisodeTitle(e.target.value)}
                          onKeyDown={(e) => e.key === 'Enter' && handleAddEpisode()}
                          placeholder={t('series.placeholders.newEpisode')}
                          className="px-2 py-0.5 text-[10px] rounded-md border border-border/60 bg-background w-28"
                        />
                        <button
                          onClick={handleAddEpisode}
                          className="flex items-center gap-0.5 px-2 py-0.5 text-[10px] rounded-md bg-secondary hover:bg-muted"
                        >
                          <Plus className="w-3 h-3" /> {t('series.addEpisode')}
                        </button>
                      </div>
                    </div>
                    <div className="rounded-md border border-border/60 overflow-hidden">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="bg-muted/50">
                            <th className="text-left px-2.5 py-1.5 text-[10px] font-medium text-muted-foreground">
                              #
                            </th>
                            <th className="text-left px-2.5 py-1.5 text-[10px] font-medium text-muted-foreground">
                              {t('series.fields.title')}
                            </th>
                            <th className="text-left px-2.5 py-1.5 text-[10px] font-medium text-muted-foreground">
                              {t('series.fields.status')}
                            </th>
                            <th className="text-left px-2.5 py-1.5 text-[10px] font-medium text-muted-foreground">
                              {t('series.fields.actions')}
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {series.episodes.length === 0 ? (
                            <tr>
                              <td
                                colSpan={4}
                                className="px-2.5 py-4 text-center text-[10px] text-muted-foreground"
                              >
                                {t('series.noEpisodes')}
                              </td>
                            </tr>
                          ) : (
                            series.episodes.map((ep, i) => (
                              <tr key={ep.id} className="border-t border-border/40 hover:bg-muted/30">
                                <td className="px-2.5 py-1.5 text-[10px] text-muted-foreground">{i + 1}</td>
                                <td className="px-2.5 py-1.5 text-[10px]">{ep.title}</td>
                                <td className="px-2.5 py-1.5">
                                  <select
                                    value={ep.status}
                                    onChange={(e) => handleStatusChange(ep.id, e.target.value)}
                                    className="text-[10px] px-1 py-0.5 rounded-md border border-border/60 bg-background"
                                  >
                                    {Object.entries(STATUS_LABELS).map(([val, label]) => (
                                      <option key={val} value={val}>
                                        {t(label)}
                                      </option>
                                    ))}
                                  </select>
                                </td>
                                <td className="px-2.5 py-1.5">
                                  <button
                                    onClick={() => handleRemoveEpisode(ep.id)}
                                    className="p-0.5 rounded-md hover:bg-destructive/10 text-destructive"
                                  >
                                    <Trash2 className="w-3 h-3" />
                                  </button>
                                </td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  <div className="pt-3 border-t border-border/40">
                    <button
                      onClick={handleDelete}
                      className="flex items-center gap-1 px-2.5 py-1 text-[10px] rounded-md text-destructive hover:bg-destructive/10"
                    >
                      <Trash2 className="w-3 h-3" /> {t('series.deleteSeries')}
                    </button>
                  </div>
                </div>
              );
            })()
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
              <Library className="w-10 h-10 mb-2 opacity-20" />
              <p className="text-xs">{t('series.selectSeries')}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
