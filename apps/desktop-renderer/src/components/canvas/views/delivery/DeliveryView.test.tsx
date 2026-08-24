// @vitest-environment jsdom

import React from 'react';
import { configureStore } from '@reduxjs/toolkit';
import { Provider } from 'react-redux';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { setLocale } from '../../../../i18n.js';
import { assetsSlice, type Asset } from '../../../../store/slices/assets.js';
import { canvasSlice, setCanvases } from '../../../../store/slices/canvas/canvas.js';
import { uiSlice } from '../../../../store/slices/ui.js';
import { DeliveryView } from './DeliveryView.js';

const firstHash = 'a'.repeat(64);
const secondHash = 'b'.repeat(64);

function videoAsset(id: string, hash: string, name: string): Asset {
  return {
    id, hash, name, type: 'video', path: `/videos/${name}.mp4`, tags: [], global: true,
    size: 1, createdAt: 1, format: 'mp4', duration: 5,
  };
}

function renderDelivery() {
  const store = configureStore({
    reducer: { canvas: canvasSlice.reducer, assets: assetsSlice.reducer, ui: uiSlice.reducer },
    preloadedState: {
      assets: { ...assetsSlice.getInitialState(), items: [videoAsset('one', firstHash, 'Opening'), videoAsset('two', secondHash, 'Closing')] },
    },
  });
  store.dispatch(setCanvases([{
    id: 'canvas', name: 'Film', edges: [], notes: [], viewport: { x: 0, y: 0, zoom: 1 }, createdAt: 1, updatedAt: 1,
    nodes: [
      { id: 'shot-1', type: 'video', title: 'Opening', position: { x: 0, y: 0 }, data: { assetHash: firstHash, variants: [], selectedVariantIndex: 0, duration: 5 }, createdAt: 1, updatedAt: 1 },
      { id: 'shot-2', type: 'video', title: 'Closing', position: { x: 0, y: 0 }, data: { assetHash: secondHash, variants: [], selectedVariantIndex: 0, duration: 5 }, createdAt: 1, updatedAt: 1 },
    ],
  }] as never));

  render(<Provider store={store}><DeliveryView /></Provider>);
  return store;
}

describe('DeliveryView', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    delete (window as { lucidAPI?: unknown }).lucidAPI;
  });

  it('adds selected videos, edits trims in seconds, confirms audio metadata, and reorders by keyboard', async () => {
    setLocale('en-US');
    const inspect = vi.fn(async (hash: string) => ({
      hash,
      type: 'video' as const,
      format: 'mp4',
      originalName: 'clip.mp4',
      fileSize: 1,
      duration: 5,
      hasAudio: true,
      createdAt: 1,
    }));
    window.lucidAPI = { assetContent: { inspect } } as never;
    const store = renderDelivery();

    fireEvent.click(screen.getByRole('button', { name: 'Choose first video' }));
    fireEvent.click(screen.getByRole('button', { name: 'Opening' }));
    await waitFor(() => expect(store.getState().canvas.canvases.entities.canvas!.deliverySequence!.items).toHaveLength(1));

    const trimIn = screen.getByRole('spinbutton', { name: 'Trim in' });
    fireEvent.change(trimIn, { target: { value: '0.5' } });
    fireEvent.blur(trimIn);
    expect(store.getState().canvas.canvases.entities.canvas!.deliverySequence!.items[0]!.trimInMs).toBe(500);

    const audio = screen.getByRole('switch', { name: 'Embedded audio' });
    await waitFor(() => expect((audio as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(audio);
    expect(store.getState().canvas.canvases.entities.canvas!.deliverySequence!.items[0]!.embeddedAudioEnabled).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: 'Add video' }));
    fireEvent.click(screen.getByRole('button', { name: 'Closing' }));
    await waitFor(() => expect(store.getState().canvas.canvases.entities.canvas!.deliverySequence!.items).toHaveLength(2));

    fireEvent.keyDown(screen.getAllByRole('listitem')[0]!, { altKey: true, key: 'ArrowDown' });
    expect(store.getState().canvas.canvases.entities.canvas!.deliverySequence!.items.map((item) => item.shotId)).toEqual(['shot-2', 'shot-1']);
    expect(inspect).toHaveBeenCalledWith(firstHash);
  });
});
