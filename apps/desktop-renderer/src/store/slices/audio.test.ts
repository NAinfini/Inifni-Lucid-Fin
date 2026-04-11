import { describe, expect, it } from 'vitest';
import type { AudioState, AudioTrack } from './audio.js';
import {
  addAudioTrack,
  audioSlice,
  removeAudioTrack,
  selectAudioTrack,
  setAudioTracks,
  setPlayingTrack,
  updateAudioTrack,
} from './audio.js';

function makeTrack(overrides: Partial<AudioTrack> = {}): AudioTrack {
  return {
    id: 'audio-1',
    sceneId: 'scene-1',
    type: 'voice',
    provider: 'openai-tts',
    text: 'Hello world',
    assetHash: null,
    duration: 4,
    volume: 1,
    startTime: 0,
    status: 'draft',
    jobId: null,
    ...overrides,
  };
}

describe('audio slice', () => {
  it('has the expected initial state', () => {
    expect(audioSlice.reducer(undefined, { type: '@@INIT' })).toEqual({
      tracks: [],
      selectedId: null,
      playingId: null,
    });
  });

  it('exports action creators with the expected payloads', () => {
    const track = makeTrack();
    const restored: AudioState = {
      tracks: [track],
      selectedId: 'audio-1',
      playingId: 'audio-1',
    };

    expect(setAudioTracks([track])).toMatchObject({
      type: 'audio/setAudioTracks',
      payload: [track],
    });
    expect(addAudioTrack(track)).toMatchObject({
      type: 'audio/addAudioTrack',
      payload: track,
    });
    expect(updateAudioTrack({ id: 'audio-1', data: { status: 'completed' } })).toMatchObject({
      type: 'audio/updateAudioTrack',
      payload: { id: 'audio-1', data: { status: 'completed' } },
    });
    expect(removeAudioTrack('audio-1')).toMatchObject({
      type: 'audio/removeAudioTrack',
      payload: 'audio-1',
    });
    expect(selectAudioTrack('audio-1')).toMatchObject({
      type: 'audio/selectAudioTrack',
      payload: 'audio-1',
    });
    expect(setPlayingTrack('audio-1')).toMatchObject({
      type: 'audio/setPlayingTrack',
      payload: 'audio-1',
    });
    expect(audioSlice.actions.restore(restored)).toMatchObject({
      type: 'audio/restore',
      payload: restored,
    });
  });

  it('sets, adds, updates, selects, and removes audio tracks', () => {
    let state = audioSlice.reducer(
      undefined,
      setAudioTracks([
        makeTrack(),
        makeTrack({ id: 'audio-2', type: 'music', status: 'completed' }),
      ]),
    );
    state = audioSlice.reducer(
      state,
      addAudioTrack(makeTrack({ id: 'audio-3', type: 'sfx', text: 'Explosion' })),
    );
    state = audioSlice.reducer(state, selectAudioTrack('audio-2'));
    state = audioSlice.reducer(state, setPlayingTrack('audio-2'));
    state = audioSlice.reducer(
      state,
      updateAudioTrack({
        id: 'audio-2',
        data: { status: 'failed', jobId: 'job-1', assetHash: 'asset-audio-2' },
      }),
    );
    state = audioSlice.reducer(
      state,
      updateAudioTrack({
        id: 'missing',
        data: { status: 'completed' },
      }),
    );
    state = audioSlice.reducer(state, removeAudioTrack('audio-2'));
    state = audioSlice.reducer(state, removeAudioTrack('missing'));

    expect(state.tracks.map((track) => track.id)).toEqual(['audio-1', 'audio-3']);
    expect(state.selectedId).toBeNull();
    expect(state.playingId).toBeNull();
  });

  it('restores full state snapshots', () => {
    const restored: AudioState = {
      tracks: [makeTrack({ id: 'audio-restore', status: 'completed', assetHash: 'asset-restore' })],
      selectedId: 'audio-restore',
      playingId: 'audio-restore',
    };

    expect(audioSlice.reducer(undefined, audioSlice.actions.restore(restored))).toEqual(restored);
  });
});
