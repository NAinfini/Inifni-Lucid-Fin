import { describe, expect, it } from 'vitest';
import { BUILT_IN_SHOT_TEMPLATES, type ShotTemplate } from '@lucid-fin/contracts';
import type { ShotTemplatesState } from './shotTemplates.js';
import {
  addCustomTemplate,
  removeCustomTemplate,
  shotTemplatesSlice,
  toggleTemplateHidden,
  updateCustomTemplate,
  updateCustomTemplateTracks,
} from './shotTemplates.js';

function makeTemplate(overrides: Partial<ShotTemplate> = {}): ShotTemplate {
  return {
    id: 'custom-template-1',
    name: 'Custom Close-Up',
    description: 'A close-up shot with custom pacing',
    builtIn: false,
    tracks: {
      composition: {
        category: 'composition',
        aiDecide: false,
        entries: [
          {
            id: 'entry-1',
            category: 'composition',
            presetId: 'builtin-composition-extreme-close-up',
            params: {},
            order: 0,
          },
        ],
      },
    },
    createdAt: 1,
    ...overrides,
  };
}

describe('shotTemplates slice', () => {
  it('has the expected initial state', () => {
    const state = shotTemplatesSlice.reducer(undefined, { type: '@@INIT' });

    expect(state.builtIn).toEqual(BUILT_IN_SHOT_TEMPLATES);
    expect(state.custom).toEqual([]);
    expect(state.loading).toBe(false);
    expect(state.hiddenIds).toEqual([]);
  });

  it('exports action creators with the expected payloads', () => {
    const template = makeTemplate();
    const restored: ShotTemplatesState = {
      builtIn: BUILT_IN_SHOT_TEMPLATES,
      custom: [template],
      loading: true,
      hiddenIds: ['builtin-tmpl-dramatic-reveal'],
    };

    expect(shotTemplatesSlice.actions.setCustomTemplates([template])).toMatchObject({
      type: 'shotTemplates/setCustomTemplates',
      payload: [template],
    });
    expect(addCustomTemplate(template)).toMatchObject({
      type: 'shotTemplates/addCustomTemplate',
      payload: template,
    });
    expect(
      updateCustomTemplate({
        id: 'custom-template-1',
        changes: { name: 'Updated', description: 'Updated description' },
      }),
    ).toMatchObject({
      type: 'shotTemplates/updateCustomTemplate',
      payload: {
        id: 'custom-template-1',
        changes: { name: 'Updated', description: 'Updated description' },
      },
    });
    expect(
      updateCustomTemplateTracks({ id: 'custom-template-1', tracks: template.tracks }),
    ).toMatchObject({
      type: 'shotTemplates/updateCustomTemplateTracks',
      payload: { id: 'custom-template-1', tracks: template.tracks },
    });
    expect(removeCustomTemplate('custom-template-1')).toMatchObject({
      type: 'shotTemplates/removeCustomTemplate',
      payload: 'custom-template-1',
    });
    expect(toggleTemplateHidden('builtin-tmpl-dramatic-reveal')).toMatchObject({
      type: 'shotTemplates/toggleTemplateHidden',
      payload: 'builtin-tmpl-dramatic-reveal',
    });
    expect(shotTemplatesSlice.actions.setLoading(true)).toMatchObject({
      type: 'shotTemplates/setLoading',
      payload: true,
    });
    expect(shotTemplatesSlice.actions.restore(restored)).toMatchObject({
      type: 'shotTemplates/restore',
      payload: restored,
    });
  });

  it('sets, adds, updates, removes, and hides custom templates', () => {
    let state = shotTemplatesSlice.reducer(
      undefined,
      shotTemplatesSlice.actions.setCustomTemplates([makeTemplate()]),
    );
    state = shotTemplatesSlice.reducer(
      state,
      addCustomTemplate(
        makeTemplate({
          id: 'custom-template-2',
          name: 'Wide Drift',
          description: 'A wider motion-heavy variant',
        }),
      ),
    );
    state = shotTemplatesSlice.reducer(
      state,
      updateCustomTemplate({
        id: 'custom-template-1',
        changes: { name: 'Close-Up Revised', description: 'Refined detail shot' },
      }),
    );
    state = shotTemplatesSlice.reducer(
      state,
      updateCustomTemplate({
        id: 'missing',
        changes: { name: 'Ignored' },
      }),
    );
    state = shotTemplatesSlice.reducer(
      state,
      updateCustomTemplateTracks({
        id: 'custom-template-2',
        tracks: {
          camera: {
            category: 'camera',
            aiDecide: false,
            entries: [
              {
                id: 'entry-camera',
                category: 'camera',
                presetId: 'builtin-camera-push-in',
                params: {},
                order: 0,
              },
            ],
          },
        },
      }),
    );
    state = shotTemplatesSlice.reducer(
      state,
      updateCustomTemplateTracks({
        id: 'missing',
        tracks: {},
      }),
    );
    state = shotTemplatesSlice.reducer(state, toggleTemplateHidden('builtin-tmpl-dramatic-reveal'));
    state = shotTemplatesSlice.reducer(state, toggleTemplateHidden('builtin-tmpl-dramatic-reveal'));
    state = shotTemplatesSlice.reducer(state, shotTemplatesSlice.actions.setLoading(true));
    state = shotTemplatesSlice.reducer(state, removeCustomTemplate('custom-template-1'));
    state = shotTemplatesSlice.reducer(state, removeCustomTemplate('missing'));

    expect(state.custom).toEqual([
      expect.objectContaining({
        id: 'custom-template-2',
        tracks: {
          camera: expect.objectContaining({
            category: 'camera',
          }),
        },
      }),
    ]);
    expect(state.loading).toBe(true);
    expect(state.hiddenIds).toEqual([]);
  });

  it('restores full state snapshots', () => {
    const restored: ShotTemplatesState = {
      builtIn: BUILT_IN_SHOT_TEMPLATES,
      custom: [makeTemplate({ id: 'template-restore' })],
      loading: true,
      hiddenIds: ['builtin-tmpl-intimate-dialogue'],
    };

    expect(
      shotTemplatesSlice.reducer(undefined, shotTemplatesSlice.actions.restore(restored)),
    ).toEqual(restored);
  });
});
