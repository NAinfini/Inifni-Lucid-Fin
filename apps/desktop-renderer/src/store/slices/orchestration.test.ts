import { describe, expect, it } from 'vitest';
import type { OrchestrationState, SegmentState } from './orchestration.js';
import {
  CAMERA_PRESETS,
  EMOTION_PRESETS,
  MOTION_PRESETS,
  addSegment,
  orchestrationSlice,
  removeSegment,
  selectSegment,
  setPreviewScene,
  setSegments,
  updateCamera,
  updateSegment,
} from './orchestration.js';

function makeSegment(overrides: Partial<SegmentState> = {}): SegmentState {
  return {
    id: 'segment-1',
    sceneId: 'scene-1',
    startKeyframeId: 'kf-1',
    endKeyframeId: 'kf-2',
    motion: 'walk',
    camera: 'push',
    mood: 'tense',
    moodIntensity: 80,
    negativePrompt: 'blurry',
    seed: 42,
    duration: 5,
    videoAssetHash: null,
    cameraPreset: 'tracking',
    splitLayout: 'single',
    focalLength: 50,
    depthOfField: 20,
    lipSync: false,
    ...overrides,
  };
}

describe('orchestration slice', () => {
  it('has the expected initial state and preset catalogs', () => {
    expect(orchestrationSlice.reducer(undefined, { type: '@@INIT' })).toEqual({
      segments: [],
      selectedId: null,
      previewSceneId: null,
    });
    expect(MOTION_PRESETS).toContain('custom');
    expect(CAMERA_PRESETS).toContain('orbit');
    expect(EMOTION_PRESETS).toContain('surprise');
  });

  it('exports action creators with the expected payloads', () => {
    const segment = makeSegment();
    const restored: OrchestrationState = {
      segments: [segment],
      selectedId: 'segment-1',
      previewSceneId: 'scene-1',
    };

    expect(setSegments([segment])).toMatchObject({
      type: 'orchestration/setSegments',
      payload: [segment],
    });
    expect(addSegment(segment)).toMatchObject({
      type: 'orchestration/addSegment',
      payload: segment,
    });
    expect(updateSegment({ id: 'segment-1', data: { mood: 'calm' } })).toMatchObject({
      type: 'orchestration/updateSegment',
      payload: { id: 'segment-1', data: { mood: 'calm' } },
    });
    expect(removeSegment('segment-1')).toMatchObject({
      type: 'orchestration/removeSegment',
      payload: 'segment-1',
    });
    expect(selectSegment('segment-1')).toMatchObject({
      type: 'orchestration/selectSegment',
      payload: 'segment-1',
    });
    expect(setPreviewScene('scene-1')).toMatchObject({
      type: 'orchestration/setPreviewScene',
      payload: 'scene-1',
    });
    expect(
      updateCamera({
        segmentId: 'segment-1',
        camera: { cameraPreset: 'orbit', focalLength: 85 },
      }),
    ).toMatchObject({
      type: 'orchestration/updateCamera',
      payload: { segmentId: 'segment-1', camera: { cameraPreset: 'orbit', focalLength: 85 } },
    });
    expect(orchestrationSlice.actions.restore(restored)).toMatchObject({
      type: 'orchestration/restore',
      payload: restored,
    });
  });

  it('sets, adds, updates, selects, previews, and removes segments', () => {
    let state = orchestrationSlice.reducer(
      undefined,
      setSegments([makeSegment(), makeSegment({ id: 'segment-2', sceneId: 'scene-2' })]),
    );
    state = orchestrationSlice.reducer(
      state,
      addSegment(makeSegment({ id: 'segment-3', sceneId: 'scene-3', motion: 'run' })),
    );
    state = orchestrationSlice.reducer(state, selectSegment('segment-2'));
    state = orchestrationSlice.reducer(state, setPreviewScene('scene-2'));
    state = orchestrationSlice.reducer(
      state,
      updateSegment({
        id: 'segment-2',
        data: { motion: 'dance', mood: 'joy', videoAssetHash: 'video-2', lipSync: true },
      }),
    );
    state = orchestrationSlice.reducer(
      state,
      updateSegment({
        id: 'missing',
        data: { mood: 'ignored' },
      }),
    );
    state = orchestrationSlice.reducer(
      state,
      updateCamera({
        segmentId: 'segment-2',
        camera: {
          cameraPreset: 'orbit',
          splitLayout: 'split-screen',
          focalLength: 85,
          depthOfField: 40,
        },
      }),
    );
    state = orchestrationSlice.reducer(
      state,
      updateCamera({
        segmentId: 'missing',
        camera: { cameraPreset: 'static' },
      }),
    );
    state = orchestrationSlice.reducer(state, removeSegment('segment-2'));
    state = orchestrationSlice.reducer(state, removeSegment('missing'));

    expect(state.segments.map((segment) => segment.id)).toEqual(['segment-1', 'segment-3']);
    expect(state.selectedId).toBeNull();
    expect(state.previewSceneId).toBe('scene-2');
  });

  it('restores full state snapshots', () => {
    const restored: OrchestrationState = {
      segments: [makeSegment({ id: 'segment-restore', sceneId: 'scene-restore' })],
      selectedId: 'segment-restore',
      previewSceneId: 'scene-restore',
    };

    expect(
      orchestrationSlice.reducer(undefined, orchestrationSlice.actions.restore(restored)),
    ).toEqual(restored);
  });
});
