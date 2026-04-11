import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SubtitleEntry, TimelineClip, TimelineTrack, TimelineState } from './timeline.js';
import {
  addClip,
  addSubtitle,
  addTrack,
  moveClip,
  removeClip,
  removeSubtitle,
  removeTrack,
  selectClip,
  selectTrack,
  setPlayhead,
  setSubtitles,
  setTimeline,
  setZoom,
  splitClip,
  timelineSlice,
  updateClip,
  updateSubtitle,
  updateTrack,
} from './timeline.js';

function makeClip(overrides: Partial<TimelineClip> = {}): TimelineClip {
  return {
    id: 'clip-1',
    trackId: 'track-video',
    assetHash: 'asset-1',
    startTime: 0,
    duration: 10,
    inPoint: 0,
    outPoint: 10,
    speed: 1,
    ...overrides,
  };
}

function makeTrack(overrides: Partial<TimelineTrack> = {}): TimelineTrack {
  return {
    id: 'track-video',
    type: 'video',
    name: 'Video Track',
    clips: [],
    muted: false,
    locked: false,
    volume: 1,
    ...overrides,
  };
}

function makeSubtitle(overrides: Partial<SubtitleEntry> = {}): SubtitleEntry {
  return {
    id: 'subtitle-1',
    startTime: 0,
    endTime: 2,
    text: 'Hello world',
    fontSize: 48,
    color: '#ffffff',
    position: 'bottom',
    bgOpacity: 0.5,
    ...overrides,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('timeline slice', () => {
  it('has the expected initial state', () => {
    expect(timelineSlice.reducer(undefined, { type: '@@INIT' })).toEqual({
      tracks: [],
      subtitles: [],
      totalDuration: 0,
      fps: 30,
      selectedClipId: null,
      selectedTrackId: null,
      playheadTime: 0,
      zoom: 1,
    });
  });

  it('exports action creators with the expected payloads', () => {
    const track = makeTrack();
    const clip = makeClip();
    const subtitle = makeSubtitle();
    const restored: TimelineState = {
      tracks: [track],
      subtitles: [subtitle],
      totalDuration: 10,
      fps: 24,
      selectedClipId: 'clip-1',
      selectedTrackId: 'track-video',
      playheadTime: 5,
      zoom: 2,
    };

    expect(setTimeline({ tracks: [track], fps: 24 })).toMatchObject({
      type: 'timeline/setTimeline',
      payload: { tracks: [track], fps: 24 },
    });
    expect(addTrack(track)).toMatchObject({ type: 'timeline/addTrack', payload: track });
    expect(removeTrack('track-video')).toMatchObject({
      type: 'timeline/removeTrack',
      payload: 'track-video',
    });
    expect(
      updateTrack({ id: 'track-video', data: { name: 'Renamed', muted: true } }),
    ).toMatchObject({
      type: 'timeline/updateTrack',
      payload: { id: 'track-video', data: { name: 'Renamed', muted: true } },
    });
    expect(addClip({ trackId: 'track-video', clip })).toMatchObject({
      type: 'timeline/addClip',
      payload: { trackId: 'track-video', clip },
    });
    expect(updateClip({ clipId: 'clip-1', data: { startTime: 3 } })).toMatchObject({
      type: 'timeline/updateClip',
      payload: { clipId: 'clip-1', data: { startTime: 3 } },
    });
    expect(removeClip('clip-1')).toMatchObject({
      type: 'timeline/removeClip',
      payload: 'clip-1',
    });
    expect(
      moveClip({ clipId: 'clip-1', newStartTime: 4, newTrackId: 'track-video-2' }),
    ).toMatchObject({
      type: 'timeline/moveClip',
      payload: { clipId: 'clip-1', newStartTime: 4, newTrackId: 'track-video-2' },
    });
    expect(splitClip({ clipId: 'clip-1', splitTime: 4 })).toMatchObject({
      type: 'timeline/splitClip',
      payload: { clipId: 'clip-1', splitTime: 4 },
    });
    expect(selectClip('clip-1')).toMatchObject({
      type: 'timeline/selectClip',
      payload: 'clip-1',
    });
    expect(selectTrack('track-video')).toMatchObject({
      type: 'timeline/selectTrack',
      payload: 'track-video',
    });
    expect(setPlayhead(12)).toMatchObject({
      type: 'timeline/setPlayhead',
      payload: 12,
    });
    expect(setZoom(3)).toMatchObject({
      type: 'timeline/setZoom',
      payload: 3,
    });
    expect(setSubtitles([subtitle])).toMatchObject({
      type: 'timeline/setSubtitles',
      payload: [subtitle],
    });
    expect(addSubtitle(subtitle)).toMatchObject({
      type: 'timeline/addSubtitle',
      payload: subtitle,
    });
    expect(updateSubtitle({ id: 'subtitle-1', data: { text: 'Updated' } })).toMatchObject({
      type: 'timeline/updateSubtitle',
      payload: { id: 'subtitle-1', data: { text: 'Updated' } },
    });
    expect(removeSubtitle('subtitle-1')).toMatchObject({
      type: 'timeline/removeSubtitle',
      payload: 'subtitle-1',
    });
    expect(timelineSlice.actions.restore(restored)).toMatchObject({
      type: 'timeline/restore',
      payload: restored,
    });
  });

  it('sets timelines and recalculates duration while preserving default fps when omitted', () => {
    let state = timelineSlice.reducer(
      undefined,
      setTimeline({
        tracks: [
          makeTrack({
            clips: [
              makeClip({ id: 'clip-1', duration: 5 }),
              makeClip({ id: 'clip-2', startTime: 8, duration: 7, outPoint: 15 }),
            ],
          }),
        ],
        fps: 24,
      }),
    );

    expect(state.totalDuration).toBe(15);
    expect(state.fps).toBe(24);

    state = timelineSlice.reducer(
      state,
      setTimeline({
        tracks: [makeTrack({ clips: [makeClip({ id: 'clip-3', duration: 4 })] })],
      }),
    );

    expect(state.totalDuration).toBe(4);
    expect(state.fps).toBe(24);
  });

  it('manages tracks and clips, including same-type moves and invalid no-ops', () => {
    let state = timelineSlice.reducer(undefined, addTrack(makeTrack()));
    state = timelineSlice.reducer(
      state,
      addTrack(makeTrack({ id: 'track-video-2', name: 'Video Track 2' })),
    );
    state = timelineSlice.reducer(
      state,
      addTrack(makeTrack({ id: 'track-audio', type: 'audio', name: 'Audio Track' })),
    );
    state = timelineSlice.reducer(
      state,
      addClip({ trackId: 'track-video', clip: makeClip({ id: 'clip-1', duration: 10 }) }),
    );
    state = timelineSlice.reducer(
      state,
      addClip({
        trackId: 'track-video',
        clip: makeClip({ id: 'clip-2', startTime: 12, duration: 8, outPoint: 20 }),
      }),
    );
    state = timelineSlice.reducer(
      state,
      addClip({
        trackId: 'missing',
        clip: makeClip({ id: 'clip-missing' }),
      }),
    );
    state = timelineSlice.reducer(
      state,
      updateTrack({
        id: 'track-video',
        data: { name: 'Primary Video', muted: true, locked: true, volume: 0.4 },
      }),
    );
    state = timelineSlice.reducer(
      state,
      updateTrack({
        id: 'missing',
        data: { name: 'Ignored' },
      }),
    );
    state = timelineSlice.reducer(
      state,
      updateClip({
        clipId: 'clip-2',
        data: { duration: 6, transition: { type: 'fade', duration: 1 } },
      }),
    );
    state = timelineSlice.reducer(
      state,
      updateClip({
        clipId: 'missing',
        data: { duration: 99 },
      }),
    );
    state = timelineSlice.reducer(state, selectClip('clip-1'));
    state = timelineSlice.reducer(state, moveClip({ clipId: 'clip-1', newStartTime: -3 }));
    state = timelineSlice.reducer(
      state,
      moveClip({ clipId: 'clip-2', newStartTime: 20, newTrackId: 'track-video-2' }),
    );
    state = timelineSlice.reducer(
      state,
      moveClip({ clipId: 'clip-2', newStartTime: 30, newTrackId: 'track-audio' }),
    );
    state = timelineSlice.reducer(state, removeClip('clip-1'));
    state = timelineSlice.reducer(state, removeClip('missing'));
    state = timelineSlice.reducer(state, removeTrack('track-video'));
    state = timelineSlice.reducer(state, removeTrack('missing'));

    expect(state.tracks.find((track) => track.id === 'track-video')).toBeUndefined();
    expect(state.tracks.find((track) => track.id === 'track-video-2')?.clips).toEqual([
      expect.objectContaining({ id: 'clip-2', startTime: 30, trackId: 'track-video' }),
    ]);
    expect(state.selectedClipId).toBeNull();
    expect(state.totalDuration).toBe(36);
  });

  it('splits clips only when the split point is valid', () => {
    const uuidSpy = vi
      .spyOn(globalThis.crypto, 'randomUUID')
      .mockReturnValue('00000000-0000-4000-8000-000000000123');
    let state = timelineSlice.reducer(
      undefined,
      setTimeline({
        tracks: [
          makeTrack({
            clips: [
              makeClip({
                id: 'clip-1',
                startTime: 10,
                duration: 8,
                inPoint: 2,
                outPoint: 10,
                speed: 2,
              }),
            ],
          }),
        ],
      }),
    );

    state = timelineSlice.reducer(state, splitClip({ clipId: 'clip-1', splitTime: 14 }));
    state = timelineSlice.reducer(state, splitClip({ clipId: 'clip-1', splitTime: 10 }));
    state = timelineSlice.reducer(state, splitClip({ clipId: 'clip-1', splitTime: 99 }));
    state = timelineSlice.reducer(state, splitClip({ clipId: 'missing', splitTime: 12 }));

    expect(uuidSpy).toHaveBeenCalledTimes(1);
    expect(state.tracks[0]?.clips).toEqual([
      expect.objectContaining({
        id: 'clip-1',
        startTime: 10,
        duration: 4,
        inPoint: 2,
        outPoint: 10,
      }),
      expect.objectContaining({
        id: '00000000-0000-4000-8000-000000000123',
        startTime: 14,
        duration: 4,
        inPoint: 10,
        outPoint: 10,
      }),
    ]);
    expect(state.totalDuration).toBe(18);
  });

  it('manages selection, playhead, zoom, subtitles, and restore snapshots', () => {
    const restored: TimelineState = {
      tracks: [makeTrack()],
      subtitles: [makeSubtitle()],
      totalDuration: 10,
      fps: 24,
      selectedClipId: 'clip-1',
      selectedTrackId: 'track-video',
      playheadTime: 5,
      zoom: 2,
    };

    let state = timelineSlice.reducer(undefined, selectTrack('track-video'));
    state = timelineSlice.reducer(state, selectClip('clip-1'));
    state = timelineSlice.reducer(state, setPlayhead(-5));
    state = timelineSlice.reducer(state, setZoom(0.01));
    state = timelineSlice.reducer(state, setZoom(11));
    state = timelineSlice.reducer(state, setSubtitles([makeSubtitle()]));
    state = timelineSlice.reducer(
      state,
      addSubtitle(
        makeSubtitle({ id: 'subtitle-2', text: 'Second line', startTime: 3, endTime: 5 }),
      ),
    );
    state = timelineSlice.reducer(
      state,
      updateSubtitle({ id: 'subtitle-2', data: { text: 'Updated subtitle', position: 'top' } }),
    );
    state = timelineSlice.reducer(
      state,
      updateSubtitle({ id: 'missing', data: { text: 'Ignored' } }),
    );
    state = timelineSlice.reducer(state, removeSubtitle('subtitle-1'));
    state = timelineSlice.reducer(state, removeSubtitle('missing'));

    expect(state.selectedTrackId).toBe('track-video');
    expect(state.selectedClipId).toBe('clip-1');
    expect(state.playheadTime).toBe(0);
    expect(state.zoom).toBe(10);
    expect(state.subtitles).toEqual([
      expect.objectContaining({ id: 'subtitle-2', text: 'Updated subtitle', position: 'top' }),
    ]);

    expect(timelineSlice.reducer(state, timelineSlice.actions.restore(restored))).toEqual(restored);
  });
});
