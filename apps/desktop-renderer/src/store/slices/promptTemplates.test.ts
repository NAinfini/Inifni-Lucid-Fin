// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('promptTemplatesSlice persistence', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.resetModules();
  });

  it('rehydrates user-created templates across module reloads', async () => {
    const firstModule = await import('./promptTemplates.js');

    let state = firstModule.promptTemplatesSlice.reducer(
      undefined,
      firstModule.addCustomTemplate({
        id: 'custom-story-beats',
        name: 'Story Beats',
        category: 'process',
        content: '# Story Beats\n\nTrack dramatic turns.',
      }),
    );

    state = firstModule.promptTemplatesSlice.reducer(
      state,
      firstModule.setCustomContent({
        id: 'meta-prompt',
        content: 'Customized meta prompt',
      }),
    );

    state = firstModule.promptTemplatesSlice.reducer(
      state,
      firstModule.renameTemplate({
        id: 'meta-prompt',
        name: 'Custom Meta Prompt',
      }),
    );

    state = firstModule.promptTemplatesSlice.reducer(
      state,
      firstModule.renameTemplate({
        id: 'custom-story-beats',
        name: 'Story Beats v2',
      }),
    );

    expect(state.templates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'custom-story-beats',
          name: 'Story Beats v2',
        }),
      ]),
    );

    vi.resetModules();

    const secondModule = await import('./promptTemplates.js');
    const rehydratedState = secondModule.promptTemplatesSlice.reducer(undefined, {
      type: 'promptTemplates/rehydrate-test',
    });

    expect(rehydratedState.templates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'custom-story-beats',
          name: 'Story Beats v2',
          category: 'process',
          defaultContent: '',
          customContent: '# Story Beats\n\nTrack dramatic turns.',
        }),
        expect.objectContaining({
          id: 'meta-prompt',
          name: 'Custom Meta Prompt',
          customContent: 'Customized meta prompt',
        }),
      ]),
    );
  });

  it('rehydrates renamed built-in and custom template names across module reloads', async () => {
    const firstModule = await import('./promptTemplates.js');

    let state = firstModule.promptTemplatesSlice.reducer(
      undefined,
      firstModule.renameTemplate({
        id: 'meta-prompt',
        name: 'Director System Prompt',
      }),
    );

    state = firstModule.promptTemplatesSlice.reducer(
      state,
      firstModule.addCustomTemplate({
        id: 'custom-story-beats',
        name: 'Story Beats',
        category: 'process',
        content: '# Story Beats\n\nTrack dramatic turns.',
      }),
    );

    state = firstModule.promptTemplatesSlice.reducer(
      state,
      firstModule.renameTemplate({
        id: 'custom-story-beats',
        name: 'Story Spine',
      }),
    );

    expect(state.templates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'custom-story-beats',
          name: 'Story Spine',
        }),
      ]),
    );

    vi.resetModules();

    const secondModule = await import('./promptTemplates.js');
    const rehydratedState = secondModule.promptTemplatesSlice.reducer(undefined, {
      type: 'promptTemplates/rehydrate-test',
    });

    expect(rehydratedState.templates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'meta-prompt',
          name: 'Director System Prompt',
        }),
        expect.objectContaining({
          id: 'custom-story-beats',
          name: 'Story Spine',
          customContent: '# Story Beats\n\nTrack dramatic turns.',
        }),
      ]),
    );
  });
});
