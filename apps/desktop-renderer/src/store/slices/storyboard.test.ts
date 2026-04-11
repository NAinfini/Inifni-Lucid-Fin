import { describe, expect, it } from 'vitest';
import type { KeyframeState, StoryboardState } from './storyboard.js';
import {
  addKeyframe,
  approveKeyframe,
  clearAllStaleKeyframes,
  clearStaleKeyframe,
  markKeyframesStale,
  rejectKeyframe,
  reorderKeyframes,
  removeKeyframe,
  selectKeyframe,
  setKeyframes,
  storyboardSlice,
  updateKeyframe,
} from './storyboard.js';

function makeKeyframe(overrides: Partial<KeyframeState> = {}): KeyframeState {
  return {
    id: 'kf-1',
    sceneId: 'scene-1',
    index: 0,
    prompt: 'Hero enters the room',
    negativePrompt: 'low quality',
    assetHash: null,
    status: 'draft',
    variants: ['variant-a', 'variant-b'],
    seed: 42,
    ...overrides,
  };
}

describe('storyboard slice', () => {
  it('has the expected initial state', () => {
    expect(storyboardSlice.reducer(undefined, { type: '@@INIT' })).toEqual({
      keyframes: [],
      selectedId: null,
      staleKeyframeIds: [],
    });
  });

  it('exports action creators with the expected payloads', () => {
    const keyframe = makeKeyframe();
    const restored: StoryboardState = {
      keyframes: [keyframe],
      selectedId: 'kf-1',
      staleKeyframeIds: ['kf-1'],
    };

    expect(setKeyframes([keyframe])).toMatchObject({
      type: 'storyboard/setKeyframes',
      payload: [keyframe],
    });
    expect(addKeyframe(keyframe)).toMatchObject({
      type: 'storyboard/addKeyframe',
      payload: keyframe,
    });
    expect(updateKeyframe({ id: 'kf-1', data: { prompt: 'Updated' } })).toMatchObject({
      type: 'storyboard/updateKeyframe',
      payload: { id: 'kf-1', data: { prompt: 'Updated' } },
    });
    expect(removeKeyframe('kf-1')).toMatchObject({
      type: 'storyboard/removeKeyframe',
      payload: 'kf-1',
    });
    expect(selectKeyframe('kf-1')).toMatchObject({
      type: 'storyboard/selectKeyframe',
      payload: 'kf-1',
    });
    expect(approveKeyframe({ id: 'kf-1', variantIndex: 1 })).toMatchObject({
      type: 'storyboard/approveKeyframe',
      payload: { id: 'kf-1', variantIndex: 1 },
    });
    expect(rejectKeyframe('kf-1')).toMatchObject({
      type: 'storyboard/rejectKeyframe',
      payload: 'kf-1',
    });
    expect(reorderKeyframes({ activeId: 'kf-1', overId: 'kf-2' })).toMatchObject({
      type: 'storyboard/reorderKeyframes',
      payload: { activeId: 'kf-1', overId: 'kf-2' },
    });
    expect(markKeyframesStale(['kf-1', 'kf-2'])).toMatchObject({
      type: 'storyboard/markKeyframesStale',
      payload: ['kf-1', 'kf-2'],
    });
    expect(clearStaleKeyframe('kf-1')).toMatchObject({
      type: 'storyboard/clearStaleKeyframe',
      payload: 'kf-1',
    });
    expect(clearAllStaleKeyframes()).toMatchObject({
      type: 'storyboard/clearAllStaleKeyframes',
    });
    expect(storyboardSlice.actions.restore(restored)).toMatchObject({
      type: 'storyboard/restore',
      payload: restored,
    });
  });

  it('sets, adds, updates, selects, and removes keyframes', () => {
    let state = storyboardSlice.reducer(
      undefined,
      setKeyframes([
        makeKeyframe(),
        makeKeyframe({ id: 'kf-2', index: 1, prompt: 'Villain appears' }),
      ]),
    );
    state = storyboardSlice.reducer(
      state,
      addKeyframe(makeKeyframe({ id: 'kf-3', index: 2, prompt: 'Explosion' })),
    );
    state = storyboardSlice.reducer(state, selectKeyframe('kf-2'));
    state = storyboardSlice.reducer(
      state,
      updateKeyframe({
        id: 'kf-2',
        data: { prompt: 'Villain appears in silhouette', seed: 99, status: 'review' },
      }),
    );
    state = storyboardSlice.reducer(
      state,
      updateKeyframe({
        id: 'missing',
        data: { prompt: 'Ignored' },
      }),
    );
    state = storyboardSlice.reducer(state, removeKeyframe('kf-3'));
    state = storyboardSlice.reducer(state, removeKeyframe('missing'));

    expect(state.keyframes.map((keyframe) => keyframe.id)).toEqual(['kf-1', 'kf-2']);
    expect(state.selectedId).toBe('kf-2');
    expect(state.keyframes.find((keyframe) => keyframe.id === 'kf-2')).toMatchObject({
      prompt: 'Villain appears in silhouette',
      seed: 99,
      status: 'review',
    });
  });

  it('approves valid variants, rejects keyframes, and ignores invalid approvals', () => {
    let state = storyboardSlice.reducer(
      undefined,
      setKeyframes([makeKeyframe(), makeKeyframe({ id: 'kf-2', index: 1, variants: [] })]),
    );

    state = storyboardSlice.reducer(state, approveKeyframe({ id: 'kf-1', variantIndex: 1 }));
    state = storyboardSlice.reducer(state, approveKeyframe({ id: 'kf-2', variantIndex: 0 }));
    state = storyboardSlice.reducer(state, approveKeyframe({ id: 'missing', variantIndex: 0 }));
    state = storyboardSlice.reducer(state, rejectKeyframe('kf-2'));
    state = storyboardSlice.reducer(state, rejectKeyframe('missing'));

    expect(state.keyframes.find((keyframe) => keyframe.id === 'kf-1')).toMatchObject({
      assetHash: 'variant-b',
      status: 'approved',
    });
    expect(state.keyframes.find((keyframe) => keyframe.id === 'kf-2')).toMatchObject({
      assetHash: null,
      status: 'rejected',
    });
  });

  it('reorders keyframes and manages stale flags without duplicates', () => {
    let state = storyboardSlice.reducer(
      undefined,
      setKeyframes([
        makeKeyframe({ id: 'kf-1', index: 0 }),
        makeKeyframe({ id: 'kf-2', index: 1 }),
        makeKeyframe({ id: 'kf-3', index: 2 }),
      ]),
    );

    state = storyboardSlice.reducer(state, reorderKeyframes({ activeId: 'kf-3', overId: 'kf-1' }));
    state = storyboardSlice.reducer(
      state,
      reorderKeyframes({ activeId: 'missing', overId: 'kf-1' }),
    );
    state = storyboardSlice.reducer(state, markKeyframesStale(['kf-1', 'kf-2']));
    state = storyboardSlice.reducer(state, markKeyframesStale(['kf-2', 'kf-3']));
    state = storyboardSlice.reducer(state, clearStaleKeyframe('kf-2'));
    state = storyboardSlice.reducer(state, clearStaleKeyframe('missing'));

    expect(state.keyframes.map((keyframe) => ({ id: keyframe.id, index: keyframe.index }))).toEqual(
      [
        { id: 'kf-3', index: 0 },
        { id: 'kf-1', index: 1 },
        { id: 'kf-2', index: 2 },
      ],
    );
    expect(state.staleKeyframeIds).toEqual(['kf-1', 'kf-3']);

    state = storyboardSlice.reducer(state, clearAllStaleKeyframes());
    expect(state.staleKeyframeIds).toEqual([]);
  });

  it('restores full state snapshots', () => {
    const restored: StoryboardState = {
      keyframes: [makeKeyframe({ id: 'kf-restore', index: 0 })],
      selectedId: 'kf-restore',
      staleKeyframeIds: ['kf-restore'],
    };

    expect(storyboardSlice.reducer(undefined, storyboardSlice.actions.restore(restored))).toEqual(
      restored,
    );
  });
});
