// @vitest-environment jsdom

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import type { Canvas, CanvasNode, ImageNodeData } from '@lucid-fin/contracts';
import { settingsSlice } from '../../store/slices/settings.js';
import { canvasReducer, setCanvases } from '../../store/slices/canvas/canvas.js';
import { getAPI } from '../../utils/api.js';
import { InspectorGenerationState } from './InspectorGenerationState.js';

vi.mock('../../utils/api.js', () => ({ getAPI: vi.fn(() => undefined) }));

const t = (key: string) =>
  (
    ({
      'generation.codexSignInRequired':
        'Sign in to ChatGPT in Settings → Providers before generating.',
      'generation.noKeyWarning': 'No API key configured for this provider type.',
      'generation.loadingProviders': 'Loading providers',
      'generation.generate': 'Generate',
      'generation.regenerate': 'Regenerate',
      'generation.cancel': 'Cancel',
      'generation.provider': 'Provider',
      'generation.variantCount': 'Variant count',
      'generation.upload': 'Upload',
      'generation.clear': 'Clear',
      'generation.estimated': 'Estimated',
      'node.generateAudio': 'Generate audio',
      'node.quality': 'Quality',
      'inspector.lipSync.enable': 'Enable lip sync',
      'export.resolution': 'Resolution',
      'resolutionPresetGroups.policy': 'Resolution policy',
      'resolutionPresetGroups.inheritCanvas': 'Inherit Canvas',
      'resolutionPresetGroups.providerDefault': 'Provider default',
      'resolutionPresetGroups.providerTier': 'Provider tier',
      'resolutionPresetGroups.square': 'Square',
      'resolutionPresetGroups.landscape': 'Landscape',
      'resolutionPresetGroups.portrait': 'Portrait',
    }) as Record<string, string>
  )[key] ?? key;

function createImageNode(): CanvasNode & { data: ImageNodeData } {
  return {
    id: 'image-1',
    type: 'image',
    title: 'Image',
    position: { x: 0, y: 0 },
    bypassed: false,
    locked: false,
    createdAt: 0,
    updatedAt: 0,
    data: {
      status: 'empty',
      variants: [],
      selectedVariantIndex: 0,
      providerId: 'codex-imagegen',
    },
  };
}

function createStore(node: CanvasNode) {
  const store = configureStore({
    reducer: {
      canvas: canvasReducer,
      settings: settingsSlice.reducer,
    },
  });
  const canvas: Canvas = {
    id: 'canvas-1',
    name: 'Canvas One',
    nodes: [node],
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    notes: [],
    createdAt: 0,
    updatedAt: 0,
  };
  store.dispatch(setCanvases([canvas]));
  return store;
}

describe('InspectorGenerationState', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('keeps Canvas inheritance distinct from an explicit provider default override', async () => {
    const selectedNode = createImageNode();
    const store = createStore(selectedNode);
    render(
      <Provider store={store}>
        <InspectorGenerationState selectedNode={selectedNode} t={t}>
          {({ generationBar }) => generationBar}
        </InspectorGenerationState>
      </Provider>,
    );

    fireEvent.click(screen.getByTitle('Expand'));
    const resolutionSelect = screen
      .getAllByRole('combobox')
      .find((element) =>
        element.querySelector('option[value="inherit-canvas"]'),
      ) as HTMLSelectElement;
    expect(resolutionSelect.value).toBe('inherit-canvas');

    fireEvent.change(resolutionSelect, { target: { value: 'provider-default' } });
    await waitFor(() => {
      const node = store.getState().canvas.canvases.entities['canvas-1']!.nodes[0];
      expect((node.data as ImageNodeData).resolutionIntent).toEqual({ mode: 'provider-default' });
    });

    fireEvent.change(resolutionSelect, { target: { value: 'inherit-canvas' } });
    await waitFor(() => {
      const node = store.getState().canvas.canvases.entities['canvas-1']!.nodes[0];
      expect((node.data as ImageNodeData).resolutionIntent).toBeUndefined();
      expect((node.data as ImageNodeData).width).toBeUndefined();
      expect((node.data as ImageNodeData).height).toBeUndefined();
    });
  });
});
