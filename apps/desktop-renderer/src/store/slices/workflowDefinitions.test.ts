// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const STORAGE_KEY = 'lucid-workflow-definitions-v1';

async function loadWorkflowDefinitionsModule() {
  vi.resetModules();
  return import('./workflowDefinitions.js');
}

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
});

beforeEach(() => {
  window.localStorage.clear();
});

describe('workflowDefinitions slice', () => {
  it('loads built-in entries plus persisted custom entries from localStorage', async () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([
        {
          id: 'custom-wf-1',
          name: 'Custom Skill',
          category: 'skill',
          content: 'Use this carefully',
          builtIn: false,
          createdAt: 10,
        },
      ]),
    );

    const { workflowDefinitionsSlice } = await loadWorkflowDefinitionsModule();
    const state = workflowDefinitionsSlice.reducer(undefined, { type: '@@INIT' });

    expect(state.entries.map((entry) => entry.id)).toEqual([
      'wf-story-idea-to-video',
      'wf-novel-to-video',
      'custom-wf-1',
    ]);
  });

  it('falls back to built-in entries when persisted storage is invalid', async () => {
    window.localStorage.setItem(STORAGE_KEY, '{not-valid-json');

    const { workflowDefinitionsSlice } = await loadWorkflowDefinitionsModule();
    const state = workflowDefinitionsSlice.reducer(undefined, { type: '@@INIT' });

    expect(state.entries.map((entry) => entry.id)).toEqual([
      'wf-story-idea-to-video',
      'wf-novel-to-video',
    ]);
  });

  it('exports action creators with the expected payloads and default-name lookup', async () => {
    const module = await loadWorkflowDefinitionsModule();

    expect(
      module.addEntry({
        name: 'New Workflow',
        category: 'workflow',
        content: 'Step 1',
      }),
    ).toMatchObject({
      type: 'workflowDefinitions/addEntry',
      payload: {
        name: 'New Workflow',
        category: 'workflow',
        content: 'Step 1',
      },
    });
    expect(
      module.updateEntry({
        id: 'custom-wf-1',
        name: 'Updated Workflow',
        content: 'Updated content',
      }),
    ).toMatchObject({
      type: 'workflowDefinitions/updateEntry',
      payload: {
        id: 'custom-wf-1',
        name: 'Updated Workflow',
        content: 'Updated content',
      },
    });
    expect(module.removeEntry('custom-wf-1')).toMatchObject({
      type: 'workflowDefinitions/removeEntry',
      payload: 'custom-wf-1',
    });
    expect(module.getDefaultWorkflowDefinitionName('wf-story-idea-to-video')).toBe(
      'Story Idea → Video',
    );
    expect(module.getDefaultWorkflowDefinitionName('missing')).toBeUndefined();
  });

  it('adds, updates, and removes custom entries while persisting only non-built-in entries', async () => {
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(100);
    const module = await loadWorkflowDefinitionsModule();
    let state = module.workflowDefinitionsSlice.reducer(undefined, { type: '@@INIT' });

    state = module.workflowDefinitionsSlice.reducer(
      state,
      module.addEntry({
        name: 'Custom Workflow',
        category: 'workflow',
        content: '1. Draft\n2. Review',
      }),
    );

    expect(state.entries.at(-1)).toMatchObject({
      id: 'custom-wf-100',
      name: 'Custom Workflow',
      builtIn: false,
      createdAt: 100,
    });
    expect(JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '[]')).toEqual([
      expect.objectContaining({
        id: 'custom-wf-100',
        name: 'Custom Workflow',
        builtIn: false,
      }),
    ]);

    nowSpy.mockReturnValue(200);
    state = module.workflowDefinitionsSlice.reducer(
      state,
      module.updateEntry({
        id: 'custom-wf-100',
        name: 'Custom Workflow v2',
        content: 'Updated body',
      }),
    );
    state = module.workflowDefinitionsSlice.reducer(
      state,
      module.updateEntry({
        id: 'missing',
        name: 'Ignored',
        content: 'Ignored',
      }),
    );

    expect(state.entries.find((entry) => entry.id === 'custom-wf-100')).toMatchObject({
      name: 'Custom Workflow v2',
      content: 'Updated body',
    });
    expect(JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '[]')).toEqual([
      expect.objectContaining({
        id: 'custom-wf-100',
        name: 'Custom Workflow v2',
        content: 'Updated body',
      }),
    ]);

    state = module.workflowDefinitionsSlice.reducer(
      state,
      module.removeEntry('wf-story-idea-to-video'),
    );
    state = module.workflowDefinitionsSlice.reducer(state, module.removeEntry('custom-wf-100'));
    state = module.workflowDefinitionsSlice.reducer(state, module.removeEntry('missing'));

    expect(state.entries.map((entry) => entry.id)).toEqual([
      'wf-story-idea-to-video',
      'wf-novel-to-video',
    ]);
    expect(JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '[]')).toEqual([]);
  });
});
