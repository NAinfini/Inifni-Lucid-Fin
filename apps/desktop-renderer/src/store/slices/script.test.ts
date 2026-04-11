import { describe, expect, it } from 'vitest';
import type { ScriptState } from './script.js';
import {
  clearScript,
  scriptSlice,
  setLoading,
  setParsedScenes,
  setScript,
  updateContent,
} from './script.js';

describe('script slice', () => {
  it('has the expected initial state', () => {
    expect(scriptSlice.reducer(undefined, { type: '@@INIT' })).toEqual({
      id: null,
      content: '',
      format: 'fountain',
      parsedScenes: [],
      dirty: false,
      loading: false,
    });
  });

  it('exports action creators with the expected payloads', () => {
    const parsedScenes = [{ heading: 'INT. LAB - DAY', body: 'A prototype hums.', index: 0 }];
    const restored: ScriptState = {
      id: 'script-1',
      content: 'Scene body',
      format: 'fdx',
      parsedScenes,
      dirty: true,
      loading: true,
    };

    expect(
      setScript({
        id: 'script-1',
        content: 'Scene body',
        format: 'fdx',
        parsedScenes,
      }),
    ).toMatchObject({
      type: 'script/setScript',
      payload: {
        id: 'script-1',
        content: 'Scene body',
        format: 'fdx',
        parsedScenes,
      },
    });
    expect(updateContent('New draft')).toMatchObject({
      type: 'script/updateContent',
      payload: 'New draft',
    });
    expect(setParsedScenes(parsedScenes)).toMatchObject({
      type: 'script/setParsedScenes',
      payload: parsedScenes,
    });
    expect(setLoading(true)).toMatchObject({
      type: 'script/setLoading',
      payload: true,
    });
    expect(clearScript()).toMatchObject({
      type: 'script/clearScript',
    });
    expect(scriptSlice.actions.restore(restored)).toMatchObject({
      type: 'script/restore',
      payload: restored,
    });
  });

  it('sets the script, updates content, manages parsed scenes and loading, and clears state', () => {
    const parsedScenes = [{ heading: 'INT. LAB - DAY', body: 'A prototype hums.', index: 0 }];
    let state = scriptSlice.reducer(
      undefined,
      setScript({
        id: 'script-1',
        content: 'Original draft',
        format: 'plaintext',
        parsedScenes,
      }),
    );

    expect(state).toMatchObject({
      id: 'script-1',
      content: 'Original draft',
      format: 'plaintext',
      parsedScenes,
      dirty: false,
    });

    state = scriptSlice.reducer(state, updateContent('Revised draft'));
    state = scriptSlice.reducer(
      state,
      setParsedScenes([{ heading: 'EXT. STREET - NIGHT', body: 'Rain falls.', index: 1 }]),
    );
    state = scriptSlice.reducer(state, setLoading(true));

    expect(state.content).toBe('Revised draft');
    expect(state.dirty).toBe(true);
    expect(state.parsedScenes).toEqual([
      { heading: 'EXT. STREET - NIGHT', body: 'Rain falls.', index: 1 },
    ]);
    expect(state.loading).toBe(true);

    state = scriptSlice.reducer(state, clearScript());
    expect(state).toEqual({
      id: null,
      content: '',
      format: 'fountain',
      parsedScenes: [],
      dirty: false,
      loading: false,
    });
  });

  it('restores full state snapshots', () => {
    const restored: ScriptState = {
      id: 'script-restore',
      content: 'Restored content',
      format: 'fountain',
      parsedScenes: [{ heading: 'INT. ROOM - DAY', body: 'Restored', index: 0 }],
      dirty: true,
      loading: false,
    };

    expect(scriptSlice.reducer(undefined, scriptSlice.actions.restore(restored))).toEqual(restored);
  });
});
