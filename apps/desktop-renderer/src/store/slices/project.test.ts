import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ProjectManifest, ProviderConfig, Snapshot, StyleGuide } from '@lucid-fin/contracts';
import {
  addSnapshot,
  clearProject,
  projectSlice,
  removeSnapshot,
  setAiProviders,
  setProject,
  updateProjectStyleGuide,
  updateProjectTitle,
} from './project.js';

function makeStyleGuide(overrides: Partial<StyleGuide> = {}): StyleGuide {
  return {
    global: {
      artStyle: 'Cinematic realism',
      colorPalette: { primary: '#111111', secondary: '#eeeeee', forbidden: ['#ff00ff'] },
      lighting: 'dramatic',
      texture: 'grainy',
      referenceImages: ['asset-ref-1'],
      freeformDescription: 'High-contrast scenes',
    },
    sceneOverrides: {},
    ...overrides,
  };
}

function makeProviderConfig(overrides: Partial<ProviderConfig> = {}): ProviderConfig {
  return {
    providerId: 'openai',
    enabled: true,
    priority: 1,
    ...overrides,
  };
}

function makeSnapshot(overrides: Partial<Snapshot> = {}): Snapshot {
  return {
    id: 'snapshot-1',
    name: 'First draft',
    createdAt: 10,
    description: 'Initial checkpoint',
    ...overrides,
  };
}

function makeManifest(overrides: Partial<ProjectManifest> = {}): ProjectManifest {
  return {
    id: 'project-1',
    title: 'Pilot',
    description: 'Opening episode',
    genre: 'Sci-Fi',
    resolution: [3840, 2160],
    fps: 30,
    aspectRatio: '16:9',
    createdAt: 1,
    updatedAt: 2,
    aiProviders: [makeProviderConfig()],
    snapshots: [makeSnapshot()],
    styleGuide: makeStyleGuide(),
    ...overrides,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('project slice', () => {
  it('has the expected initial state', () => {
    expect(projectSlice.reducer(undefined, { type: '@@INIT' })).toEqual({
      id: '',
      title: '',
      description: '',
      genre: '',
      resolution: [1920, 1080],
      fps: 24,
      aspectRatio: '16:9',
      createdAt: 0,
      updatedAt: 0,
      aiProviders: [],
      snapshots: [],
      styleGuide: {
        global: {
          artStyle: '',
          colorPalette: { primary: '', secondary: '', forbidden: [] },
          lighting: 'natural',
          texture: '',
          referenceImages: [],
          freeformDescription: '',
        },
        sceneOverrides: {},
      },
      path: '',
      loaded: false,
    });
  });

  it('exports action creators with the expected payloads', () => {
    const manifest = makeManifest();
    const styleGuide = makeStyleGuide();
    const providers = [makeProviderConfig({ providerId: 'gemini' })];
    const snapshot = makeSnapshot();

    expect(setProject({ ...manifest, path: '/projects/pilot' })).toMatchObject({
      type: 'project/setProject',
      payload: { ...manifest, path: '/projects/pilot' },
    });
    expect(clearProject()).toMatchObject({
      type: 'project/clearProject',
    });
    expect(updateProjectTitle('Renamed Project')).toMatchObject({
      type: 'project/updateProjectTitle',
      payload: 'Renamed Project',
    });
    expect(updateProjectStyleGuide(styleGuide)).toMatchObject({
      type: 'project/updateProjectStyleGuide',
      payload: styleGuide,
    });
    expect(setAiProviders(providers)).toMatchObject({
      type: 'project/setAiProviders',
      payload: providers,
    });
    expect(addSnapshot(snapshot)).toMatchObject({
      type: 'project/addSnapshot',
      payload: snapshot,
    });
    expect(removeSnapshot('snapshot-1')).toMatchObject({
      type: 'project/removeSnapshot',
      payload: 'snapshot-1',
    });
  });

  it('loads and clears project manifests', () => {
    let state = projectSlice.reducer(
      undefined,
      setProject({
        ...makeManifest({ title: 'Loaded Project' }),
        path: '/projects/loaded',
      }),
    );

    expect(state).toMatchObject({
      id: 'project-1',
      title: 'Loaded Project',
      path: '/projects/loaded',
      loaded: true,
    });

    state = projectSlice.reducer(state, clearProject());
    expect(state.loaded).toBe(false);
    expect(state.title).toBe('');
    expect(state.path).toBe('');
  });

  it('updates title, style guide, and AI providers with fresh timestamps', () => {
    const nowSpy = vi.spyOn(Date, 'now');
    let state = projectSlice.reducer(
      undefined,
      setProject({
        ...makeManifest(),
        path: '/projects/pilot',
      }),
    );

    nowSpy.mockReturnValueOnce(100);
    state = projectSlice.reducer(state, updateProjectTitle('Episode One'));

    nowSpy.mockReturnValueOnce(200);
    state = projectSlice.reducer(
      state,
      updateProjectStyleGuide(
        makeStyleGuide({
          global: {
            artStyle: 'Painterly',
            colorPalette: { primary: '#222222', secondary: '#dddddd', forbidden: [] },
            lighting: 'studio',
            texture: 'clean',
            referenceImages: [],
            freeformDescription: 'Updated',
          },
          sceneOverrides: {
            sceneA: { lighting: 'neon' },
          },
        }),
      ),
    );

    nowSpy.mockReturnValueOnce(300);
    state = projectSlice.reducer(
      state,
      setAiProviders([makeProviderConfig({ providerId: 'claude', priority: 2 })]),
    );

    expect(state.title).toBe('Episode One');
    expect(state.styleGuide.sceneOverrides).toEqual({ sceneA: { lighting: 'neon' } });
    expect(state.aiProviders).toEqual([
      expect.objectContaining({ providerId: 'claude', priority: 2 }),
    ]);
    expect(state.updatedAt).toBe(300);
  });

  it('adds and removes snapshots while ignoring unknown ids', () => {
    let state = projectSlice.reducer(
      undefined,
      setProject({
        ...makeManifest({ snapshots: [] }),
        path: '/projects/pilot',
      }),
    );

    state = projectSlice.reducer(state, addSnapshot(makeSnapshot()));
    state = projectSlice.reducer(
      state,
      addSnapshot(makeSnapshot({ id: 'snapshot-2', name: 'Second draft', createdAt: 20 })),
    );
    state = projectSlice.reducer(state, removeSnapshot('snapshot-1'));
    state = projectSlice.reducer(state, removeSnapshot('missing'));

    expect(state.snapshots).toEqual([
      expect.objectContaining({ id: 'snapshot-2', name: 'Second draft' }),
    ]);
  });
});
