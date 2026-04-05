import { describe, expect, it } from 'vitest';
import type { Canvas } from '@lucid-fin/contracts';
import {
  addNode,
  canvasSlice,
  selectVariant,
  setActiveCanvas,
  setCanvases,
  setNodeEstimatedCost,
  setNodeGenerationComplete,
  setNodeGenerationFailed,
  setNodeGenerating,
  setNodeProgress,
  setNodeProvider,
  setNodeSeed,
  setNodeVariantCount,
  toggleSeedLock,
} from './canvas.js';

function makeCanvas(): Canvas {
  return {
    id: 'canvas-1',
    projectId: 'project-1',
    name: 'Main',
    nodes: [],
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    createdAt: 1,
    updatedAt: 1,
    notes: [],
  };
}

function setup() {
  let state = canvasSlice.reducer(undefined, setCanvases([makeCanvas()]));
  state = canvasSlice.reducer(state, setActiveCanvas('canvas-1'));
  state = canvasSlice.reducer(
    state,
    addNode({ id: 'img-1', type: 'image', position: { x: 0, y: 0 } }),
  );
  state = canvasSlice.reducer(
    state,
    addNode({ id: 'vid-1', type: 'video', position: { x: 120, y: 0 } }),
  );
  state = canvasSlice.reducer(
    state,
    addNode({ id: 'aud-1', type: 'audio', position: { x: 240, y: 0 } }),
  );
  state = canvasSlice.reducer(
    state,
    addNode({ id: 'txt-1', type: 'text', position: { x: 360, y: 0 } }),
  );
  return state;
}

describe('canvas generation reducers', () => {
  it('sets node generating state and progress', () => {
    let state = setup();
    state = canvasSlice.reducer(state, setNodeGenerating({ id: 'img-1', jobId: 'job-1' }));
    state = canvasSlice.reducer(state, setNodeProgress({ id: 'img-1', progress: 45 }));

    const node = state.canvases[0].nodes.find((n) => n.id === 'img-1');
    const data = node?.data as { status: string; progress?: number; jobId?: string };
    expect(node?.status).toBe('generating');
    expect(data.status).toBe('generating');
    expect(data.progress).toBe(45);
    expect(data.jobId).toBe('job-1');
  });

  it('completes generation and sets variants/primary asset', () => {
    let state = setup();
    state = canvasSlice.reducer(state, setNodeGenerating({ id: 'vid-1', jobId: 'job-video' }));
    state = canvasSlice.reducer(
      state,
      setNodeGenerationComplete({
        id: 'vid-1',
        variants: ['hash-a', 'hash-b'],
        primaryAssetHash: 'hash-a',
        cost: 0.2,
        generationTimeMs: 8000,
      }),
    );

    const node = state.canvases[0].nodes.find((n) => n.id === 'vid-1');
    const data = node?.data as {
      status: string;
      variants: string[];
      selectedVariantIndex: number;
      assetHash?: string;
      progress?: number;
      estimatedCost?: number;
      generationTimeMs?: number;
    };
    expect(node?.status).toBe('done');
    expect(data.status).toBe('done');
    expect(data.variants).toEqual(['hash-a', 'hash-b']);
    expect(data.selectedVariantIndex).toBe(0);
    expect(data.assetHash).toBe('hash-a');
    expect(data.progress).toBe(100);
    expect(data.estimatedCost).toBe(0.2);
    expect(data.generationTimeMs).toBe(8000);
  });

  it('marks generation failed and clears progress', () => {
    let state = setup();
    state = canvasSlice.reducer(state, setNodeGenerating({ id: 'aud-1', jobId: 'job-2' }));
    state = canvasSlice.reducer(
      state,
      setNodeGenerationFailed({ id: 'aud-1', error: 'provider timeout' }),
    );

    const node = state.canvases[0].nodes.find((n) => n.id === 'aud-1');
    const data = node?.data as { status: string; error?: string; progress?: number };
    expect(node?.status).toBe('failed');
    expect(data.status).toBe('failed');
    expect(data.error).toBe('provider timeout');
    expect(data.progress).toBeUndefined();
  });

  it('supports selecting variants for image and audio nodes', () => {
    let state = setup();
    state = canvasSlice.reducer(
      state,
      setNodeGenerationComplete({
        id: 'img-1',
        variants: ['img-v1', 'img-v2'],
        primaryAssetHash: 'img-v1',
        generationTimeMs: 1000,
      }),
    );
    state = canvasSlice.reducer(
      state,
      setNodeGenerationComplete({
        id: 'aud-1',
        variants: ['aud-v1', 'aud-v2'],
        primaryAssetHash: 'aud-v1',
        generationTimeMs: 1000,
      }),
    );
    state = canvasSlice.reducer(state, selectVariant({ id: 'img-1', index: 1 }));
    state = canvasSlice.reducer(state, selectVariant({ id: 'aud-1', index: 1 }));

    const imageNode = state.canvases[0].nodes.find((n) => n.id === 'img-1');
    const audioNode = state.canvases[0].nodes.find((n) => n.id === 'aud-1');
    expect((imageNode?.data as { selectedVariantIndex: number; assetHash?: string }).selectedVariantIndex).toBe(1);
    expect((imageNode?.data as { selectedVariantIndex: number; assetHash?: string }).assetHash).toBe('img-v2');
    expect((audioNode?.data as { selectedVariantIndex: number; assetHash?: string }).selectedVariantIndex).toBe(1);
    expect((audioNode?.data as { selectedVariantIndex: number; assetHash?: string }).assetHash).toBe('aud-v2');
  });

  it('updates seed/provider/variant count/estimated cost and toggles lock', () => {
    let state = setup();
    state = canvasSlice.reducer(state, setNodeSeed({ id: 'img-1', seed: 42 }));
    state = canvasSlice.reducer(state, toggleSeedLock({ id: 'img-1' }));
    state = canvasSlice.reducer(
      state,
      setNodeProvider({ id: 'img-1', providerId: 'runway' }),
    );
    state = canvasSlice.reducer(state, setNodeVariantCount({ id: 'img-1', count: 4 }));
    state = canvasSlice.reducer(
      state,
      setNodeEstimatedCost({ id: 'img-1', estimatedCost: 0.14 }),
    );

    const node = state.canvases[0].nodes.find((n) => n.id === 'img-1');
    const data = node?.data as {
      seed?: number;
      seedLocked?: boolean;
      providerId?: string;
      variantCount?: number;
      estimatedCost?: number;
    };
    expect(data.seed).toBe(42);
    expect(data.seedLocked).toBe(true);
    expect(data.providerId).toBe('runway');
    expect(data.variantCount).toBe(4);
    expect(data.estimatedCost).toBe(0.14);
  });

  it('is a no-op for generation actions on text nodes', () => {
    let state = setup();
    state = canvasSlice.reducer(state, setNodeGenerating({ id: 'txt-1', jobId: 'job-x' }));
    state = canvasSlice.reducer(state, setNodeProgress({ id: 'txt-1', progress: 30 }));
    state = canvasSlice.reducer(
      state,
      setNodeGenerationComplete({
        id: 'txt-1',
        variants: ['a'],
        primaryAssetHash: 'a',
        generationTimeMs: 1,
      }),
    );
    state = canvasSlice.reducer(state, setNodeGenerationFailed({ id: 'txt-1', error: 'x' }));
    state = canvasSlice.reducer(state, setNodeSeed({ id: 'txt-1', seed: 7 }));
    state = canvasSlice.reducer(state, toggleSeedLock({ id: 'txt-1' }));
    state = canvasSlice.reducer(state, setNodeProvider({ id: 'txt-1', providerId: 'kling' }));
    state = canvasSlice.reducer(state, setNodeVariantCount({ id: 'txt-1', count: 2 }));
    state = canvasSlice.reducer(state, setNodeEstimatedCost({ id: 'txt-1', estimatedCost: 0.1 }));
    state = canvasSlice.reducer(state, selectVariant({ id: 'txt-1', index: 0 }));

    const node = state.canvases[0].nodes.find((n) => n.id === 'txt-1');
    const data = node?.data as unknown as Record<string, unknown>;
    expect(data.status).toBeUndefined();
    expect(data.seed).toBeUndefined();
    expect(data.providerId).toBeUndefined();
  });
});
