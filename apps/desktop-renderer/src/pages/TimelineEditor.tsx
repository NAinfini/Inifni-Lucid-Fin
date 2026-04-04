import React, { useCallback, useMemo, useState } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import {
  Layers,
  Plus,
  Trash2,
  Scissors,
  Volume2,
  VolumeX,
  Lock,
  Unlock,
  ZoomIn,
  ZoomOut,
  Play,
  Pause,
} from 'lucide-react';
import type { RootState } from '../store/index.js';
import {
  addTrack,
  removeTrack,
  updateTrack,
  addClip,
  removeClip,
  splitClip,
  selectClip,
  selectTrack,
  setPlayhead,
  setZoom,
  type TimelineTrack,
  type TimelineClip,
} from '../store/slices/timeline.js';
import { SubtitleEditor } from '../components/timeline/SubtitleEditor.js';
import { t } from '../i18n.js';

const TRACK_TYPES = ['video', 'audio', 'subtitle', 'title'] as const;
const PX_PER_SEC = 80;

export function TimelineEditor() {
  const dispatch = useDispatch();
  const { tracks, totalDuration, selectedClipId, selectedTrackId, playheadTime, zoom, fps } =
    useSelector((s: RootState) => s.timeline);
  const [playing, setPlaying] = useState(false);

  const pxPerSec = PX_PER_SEC * zoom;
  const timelineWidth = Math.max(800, (totalDuration + 10) * pxPerSec);

  const handleAddTrack = useCallback(
    (type: TimelineTrack['type']) => {
      const id = crypto.randomUUID();
      const count = tracks.filter((t) => t.type === type).length + 1;
      dispatch(
        addTrack({
          id,
          type,
          name: `${type} ${count}`,
          clips: [],
          muted: false,
          locked: false,
          volume: 1,
        }),
      );
      dispatch(selectTrack(id));
    },
    [dispatch, tracks],
  );

  const handleAddClip = useCallback(() => {
    if (!selectedTrackId) return;
    const track = tracks.find((t) => t.id === selectedTrackId);
    if (!track || track.locked) return;
    const lastEnd = track.clips.reduce((max, c) => Math.max(max, c.startTime + c.duration), 0);
    const clip: TimelineClip = {
      id: crypto.randomUUID(),
      trackId: selectedTrackId,
      assetHash: '',
      startTime: lastEnd,
      duration: 3,
      inPoint: 0,
      outPoint: 3,
      speed: 1,
    };
    dispatch(addClip({ trackId: selectedTrackId, clip }));
    dispatch(selectClip(clip.id));
  }, [dispatch, selectedTrackId, tracks]);

  const handleSplit = useCallback(() => {
    if (!selectedClipId) return;
    dispatch(splitClip({ clipId: selectedClipId, splitTime: playheadTime }));
  }, [dispatch, selectedClipId, playheadTime]);

  const handleTimelineClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const rect = e.currentTarget.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const time = x / pxPerSec;
      dispatch(setPlayhead(time));
    },
    [dispatch, pxPerSec],
  );

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    const fr = Math.floor((s % 1) * fps);
    return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}:${String(fr).padStart(2, '0')}`;
  };

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-3 py-2 border-b bg-card">
        <Layers className="w-4 h-4 text-primary" />
        <span className="text-sm font-medium">{t('timelineEditor.title')}</span>
        <div className="flex-1" />
        <span className="text-xs text-muted-foreground font-mono">{formatTime(playheadTime)}</span>
        <button
          onClick={() => setPlaying(!playing)}
          className="p-1 rounded hover:bg-muted"
          aria-label={playing ? t('timelineEditor.pause') : t('timelineEditor.play')}
        >
          {playing ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
        </button>
        <button
          onClick={() => dispatch(setZoom(zoom - 0.2))}
          className="p-1 rounded hover:bg-muted"
          aria-label={t('timeline.zoomOut')}
        >
          <ZoomOut className="w-4 h-4" />
        </button>
        <button
          onClick={() => dispatch(setZoom(zoom + 0.2))}
          className="p-1 rounded hover:bg-muted"
          aria-label={t('timeline.zoomIn')}
        >
          <ZoomIn className="w-4 h-4" />
        </button>
        <button
          onClick={handleSplit}
          disabled={!selectedClipId}
          className="flex items-center gap-1 px-2 py-1 text-xs rounded bg-secondary hover:bg-muted disabled:opacity-50"
        >
          <Scissors className="w-3 h-3" /> {t('timeline.split')}
        </button>
        <button
          onClick={handleAddClip}
          disabled={!selectedTrackId}
          className="flex items-center gap-1 px-2 py-1 text-xs rounded bg-secondary hover:bg-muted disabled:opacity-50"
        >
          <Plus className="w-3 h-3" /> {t('timelineEditor.addClip')}
        </button>
        <div className="border-l pl-2 ml-1">
          {TRACK_TYPES.map((t) => (
            <button
              key={t}
              onClick={() => handleAddTrack(t)}
              className="px-2 py-1 text-xs rounded hover:bg-muted text-muted-foreground"
            >
              +{t}
            </button>
          ))}
        </div>
      </div>

      {/* Timeline body */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Track headers */}
        <div className="w-44 border-r bg-card flex-shrink-0 overflow-y-auto">
          {tracks.map((track) => (
            <div
              key={track.id}
              onClick={() => dispatch(selectTrack(track.id))}
              className={`flex items-center gap-1 px-2 py-2 border-b text-xs cursor-pointer hover:bg-muted
                ${track.id === selectedTrackId ? 'bg-muted' : ''}`}
            >
              <span
                className={`w-2 h-2 rounded-full ${
                  track.type === 'video'
                    ? 'bg-blue-500'
                    : track.type === 'audio'
                      ? 'bg-green-500'
                      : track.type === 'subtitle'
                        ? 'bg-yellow-500'
                        : 'bg-purple-500'
                }`}
              />
              <span className="flex-1 truncate">{track.name}</span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  dispatch(updateTrack({ id: track.id, data: { muted: !track.muted } }));
                }}
                className="p-0.5 rounded hover:bg-background"
                aria-label={track.muted ? t('timelineEditor.unmute') : t('timelineEditor.mute')}
              >
                {track.muted ? (
                  <VolumeX className="w-3 h-3 text-destructive" />
                ) : (
                  <Volume2 className="w-3 h-3" />
                )}
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  dispatch(updateTrack({ id: track.id, data: { locked: !track.locked } }));
                }}
                className="p-0.5 rounded hover:bg-background"
                aria-label={track.locked ? t('timelineEditor.unlock') : t('timelineEditor.lock')}
              >
                {track.locked ? (
                  <Lock className="w-3 h-3 text-destructive" />
                ) : (
                  <Unlock className="w-3 h-3" />
                )}
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  dispatch(removeTrack(track.id));
                }}
                className="p-0.5 rounded hover:bg-destructive/10"
                aria-label={t('timelineEditor.deleteTrack')}
              >
                <Trash2 className="w-3 h-3 text-destructive" />
              </button>
            </div>
          ))}
          {tracks.length === 0 && (
            <div className="p-3 text-xs text-muted-foreground">
              {t('timelineEditor.emptyTracks')}
            </div>
          )}
        </div>

        {/* Timeline tracks + ruler */}
        <div className="flex-1 overflow-auto relative" onClick={handleTimelineClick}>
          {/* Ruler */}
          <div
            className="sticky top-0 z-10 h-6 bg-card border-b flex items-end"
            style={{ width: timelineWidth }}
          >
            {useMemo(
              () =>
                Array.from({ length: Math.ceil(totalDuration + 10) }, (_, i) => (
                  <div
                    key={i}
                    className="absolute text-[10px] text-muted-foreground border-l border-muted"
                    style={{ left: i * pxPerSec, height: '100%', paddingLeft: 2 }}
                  >
                    {i}s
                  </div>
                )),
              [totalDuration, pxPerSec],
            )}
          </div>

          {/* Track lanes */}
          {tracks.map((track) => (
            <div
              key={track.id}
              className="relative h-12 border-b bg-background/50"
              style={{ width: timelineWidth }}
            >
              {track.clips.map((clip) => (
                <div
                  key={clip.id}
                  onClick={(e) => {
                    e.stopPropagation();
                    dispatch(selectClip(clip.id));
                  }}
                  className={`absolute top-1 h-10 rounded text-[10px] flex items-center px-1 cursor-pointer border
                    ${clip.id === selectedClipId ? 'border-primary ring-1 ring-primary' : 'border-transparent'}
                    ${
                      track.type === 'video'
                        ? 'bg-blue-500/30'
                        : track.type === 'audio'
                          ? 'bg-green-500/30'
                          : track.type === 'subtitle'
                            ? 'bg-yellow-500/30'
                            : 'bg-purple-500/30'
                    }`}
                  style={{ left: clip.startTime * pxPerSec, width: clip.duration * pxPerSec }}
                >
                  <span className="truncate">
                    {clip.assetHash || `${clip.duration.toFixed(1)}s`}
                  </span>
                </div>
              ))}
            </div>
          ))}

          {/* Playhead */}
          <div
            className="absolute top-0 bottom-0 w-px bg-red-500 z-20 pointer-events-none"
            style={{ left: playheadTime * pxPerSec }}
          />
          <div
            className="absolute top-0 w-3 h-3 bg-red-500 z-20 pointer-events-none"
            style={{
              left: playheadTime * pxPerSec - 5,
              clipPath: 'polygon(50% 100%, 0 0, 100% 0)',
            }}
          />
        </div>
      </div>

      {/* Clip inspector */}
      {selectedClipId &&
        (() => {
          let clip: TimelineClip | undefined;
          for (const t of tracks) {
            clip = t.clips.find((c) => c.id === selectedClipId);
            if (clip) break;
          }
          if (!clip) return null;
          return (
            <div className="border-t bg-card px-4 py-2 flex items-center gap-4 text-xs">
              <span className="text-muted-foreground">{t('timelineEditor.clip')}:</span>
              <span>
                {t('timelineEditor.start')} {clip.startTime.toFixed(2)}s
              </span>
              <span>
                {t('timelineEditor.duration')} {clip.duration.toFixed(2)}s
              </span>
              <span>
                {t('timelineEditor.speed')} {clip.speed}x
              </span>
              <button
                onClick={() => dispatch(removeClip(selectedClipId))}
                className="ml-auto flex items-center gap-1 px-2 py-1 rounded text-destructive hover:bg-destructive/10"
              >
                <Trash2 className="w-3 h-3" /> {t('action.delete')}
              </button>
            </div>
          );
        })()}
      {tracks.some((t) => t.type === 'subtitle') && <SubtitleEditor />}
    </div>
  );
}
