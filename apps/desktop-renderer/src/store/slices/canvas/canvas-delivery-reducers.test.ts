import { describe, expect, it } from 'vitest';
import {
  addDeliveryItem,
  canvasReducer,
  removeDeliveryItems,
  reorderDeliveryItem,
  setDeliveryEmbeddedAudio,
  trimDeliveryItem,
} from './canvas.js';
import type { CanvasSliceState } from './canvas.js';

const firstHash = 'a'.repeat(64);
const secondHash = 'b'.repeat(64);

function state(): CanvasSliceState {
  return canvasReducer(undefined, {
    type: 'canvas/setCanvases',
    payload: [{
      id: 'canvas', name: 'Canvas', nodes: [], edges: [], notes: [],
      viewport: { x: 0, y: 0, zoom: 1 }, createdAt: 1, updatedAt: 1,
    }],
  });
}

describe('canvas delivery reducers', () => {
  it('keeps array order canonical while editing selected source properties', () => {
    let next = state();
    next = canvasReducer(next, addDeliveryItem({
      shotId: 'shot-a', selectedVideoHash: firstHash, trimInMs: 0, trimOutMs: 5_000, embeddedAudioEnabled: true,
    }));
    next = canvasReducer(next, addDeliveryItem({
      shotId: 'shot-b', selectedVideoHash: secondHash, trimInMs: 0, trimOutMs: 4_000, embeddedAudioEnabled: false,
    }));
    next = canvasReducer(next, reorderDeliveryItem({ shotId: 'shot-b', toIndex: 0 }));
    next = canvasReducer(next, trimDeliveryItem({ shotId: 'shot-a', trimInMs: 500, trimOutMs: 4_500 }));
    next = canvasReducer(next, setDeliveryEmbeddedAudio({ shotId: 'shot-b', embeddedAudioEnabled: true }));

    expect(next.canvases.entities.canvas!.deliverySequence).toMatchObject({
      revision: 1,
      items: [
        { shotId: 'shot-b', selectedVideoHash: secondHash, embeddedAudioEnabled: true },
        { shotId: 'shot-a', selectedVideoHash: firstHash, trimInMs: 500, trimOutMs: 4_500 },
      ],
    });

    next = canvasReducer(next, removeDeliveryItems(['shot-b']));
    expect(next.canvases.entities.canvas!.deliverySequence!.items.map((item) => item.shotId)).toEqual(['shot-a']);
  });

  it('rejects duplicate shots and invalid source ranges', () => {
    let next = state();
    next = canvasReducer(next, addDeliveryItem({
      shotId: 'shot-a', selectedVideoHash: firstHash, trimInMs: 0, trimOutMs: 5_000, embeddedAudioEnabled: false,
    }));
    next = canvasReducer(next, addDeliveryItem({
      shotId: 'shot-a', selectedVideoHash: secondHash, trimInMs: 0, trimOutMs: 5_000, embeddedAudioEnabled: false,
    }));
    next = canvasReducer(next, trimDeliveryItem({ shotId: 'shot-a', trimInMs: 5_000, trimOutMs: 5_000 }));

    expect(next.canvases.entities.canvas!.deliverySequence!.items).toEqual([
      { shotId: 'shot-a', selectedVideoHash: firstHash, trimInMs: 0, trimOutMs: 5_000, embeddedAudioEnabled: false },
    ]);
  });
});
