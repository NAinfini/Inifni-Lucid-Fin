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
