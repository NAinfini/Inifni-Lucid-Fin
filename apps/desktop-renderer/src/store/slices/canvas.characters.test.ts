import { describe, expect, it } from 'vitest';
import type { Canvas, ImageNodeData, VideoNodeData } from '@lucid-fin/contracts';
import {
  addNode,
  addNodeCharacterRef,
  addNodeEquipmentRef,
  canvasSlice,
  removeNodeCharacterRef,
  removeNodeEquipmentRef,
  setActiveCanvas,
  setCanvases,
  setNodeCharacterRefs,
  setNodeEquipmentRefs,
} from './canvas.js';

function makeCanvas(): Canvas {
  return {
    id: 'canvas-1',
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
    addNode({
      id: 'img-1',
      type: 'image',
      position: { x: 0, y: 0 },
    }),
  );
  state = canvasSlice.reducer(
    state,
    addNode({
      id: 'vid-1',
      type: 'video',
      position: { x: 100, y: 0 },
    }),
  );
  state = canvasSlice.reducer(
    state,
    addNode({
      id: 'txt-1',
      type: 'text',
      position: { x: 200, y: 0 },
    }),
  );
  return state;
}

describe('canvas character refs', () => {
  it('adds a character ref to an image node', () => {
    let state = setup();
    state = canvasSlice.reducer(
      state,
      addNodeCharacterRef({
        id: 'img-1',
        characterRef: { characterId: 'char-1', loadoutId: 'loadout-1' },
      }),
    );

    const node = state.canvases.entities['canvas-1']!.nodes.find((n) => n.id === 'img-1');
    const data = node?.data as ImageNodeData;
    expect(data.characterRefs).toHaveLength(1);
    expect(data.characterRefs![0].characterId).toBe('char-1');
    expect(data.characterRefs![0].loadoutId).toBe('loadout-1');
  });

  it('prevents duplicate character refs on same node', () => {
    let state = setup();
    state = canvasSlice.reducer(
      state,
      addNodeCharacterRef({
        id: 'img-1',
        characterRef: { characterId: 'char-1', loadoutId: 'lo-1' },
      }),
    );
    state = canvasSlice.reducer(
      state,
      addNodeCharacterRef({
        id: 'img-1',
        characterRef: { characterId: 'char-1', loadoutId: 'lo-2' },
      }),
    );

    const node = state.canvases.entities['canvas-1']!.nodes.find((n) => n.id === 'img-1');
    const data = node?.data as ImageNodeData;
    expect(data.characterRefs).toHaveLength(1);
  });

  it('removes a character ref', () => {
    let state = setup();
    state = canvasSlice.reducer(
      state,
      addNodeCharacterRef({
        id: 'vid-1',
        characterRef: { characterId: 'char-1', loadoutId: '' },
      }),
    );
    state = canvasSlice.reducer(
      state,
      addNodeCharacterRef({
        id: 'vid-1',
        characterRef: { characterId: 'char-2', loadoutId: '' },
      }),
    );
    state = canvasSlice.reducer(
      state,
      removeNodeCharacterRef({ id: 'vid-1', characterId: 'char-1' }),
    );

    const node = state.canvases.entities['canvas-1']!.nodes.find((n) => n.id === 'vid-1');
    const data = node?.data as VideoNodeData;
    expect(data.characterRefs).toHaveLength(1);
    expect(data.characterRefs![0].characterId).toBe('char-2');
  });

  it('sets character refs wholesale', () => {
    let state = setup();
    state = canvasSlice.reducer(
      state,
      setNodeCharacterRefs({
        id: 'img-1',
        characterRefs: [
          { characterId: 'a', loadoutId: 'la' },
          { characterId: 'b', loadoutId: 'lb' },
        ],
      }),
    );

    const node = state.canvases.entities['canvas-1']!.nodes.find((n) => n.id === 'img-1');
    const data = node?.data as ImageNodeData;
    expect(data.characterRefs).toHaveLength(2);
  });

  it('ignores character ref actions on text nodes', () => {
    let state = setup();
    state = canvasSlice.reducer(
      state,
      addNodeCharacterRef({
        id: 'txt-1',
        characterRef: { characterId: 'char-1', loadoutId: '' },
      }),
    );

    const node = state.canvases.entities['canvas-1']!.nodes.find((n) => n.id === 'txt-1');
    expect((node?.data as unknown as Record<string, unknown>).characterRefs).toBeUndefined();
  });
});

describe('canvas equipment refs', () => {
  it('adds equipment ref to an image node', () => {
    let state = setup();
    state = canvasSlice.reducer(state, addNodeEquipmentRef({ id: 'img-1', equipmentId: 'eq-1' }));

    const node = state.canvases.entities['canvas-1']!.nodes.find((n) => n.id === 'img-1');
    const data = node?.data as ImageNodeData;
    expect(data.equipmentRefs).toHaveLength(1);
    expect(data.equipmentRefs![0]).toEqual({
      equipmentId: 'eq-1',
      angleSlot: undefined,
      referenceImageHash: undefined,
    });
  });

  it('prevents duplicate equipment refs', () => {
    let state = setup();
    state = canvasSlice.reducer(state, addNodeEquipmentRef({ id: 'img-1', equipmentId: 'eq-1' }));
    state = canvasSlice.reducer(state, addNodeEquipmentRef({ id: 'img-1', equipmentId: 'eq-1' }));

    const node = state.canvases.entities['canvas-1']!.nodes.find((n) => n.id === 'img-1');
    const data = node?.data as ImageNodeData;
    expect(data.equipmentRefs).toHaveLength(1);
  });

  it('removes equipment ref', () => {
    let state = setup();
    state = canvasSlice.reducer(state, addNodeEquipmentRef({ id: 'vid-1', equipmentId: 'eq-1' }));
    state = canvasSlice.reducer(state, addNodeEquipmentRef({ id: 'vid-1', equipmentId: 'eq-2' }));
    state = canvasSlice.reducer(
      state,
      removeNodeEquipmentRef({ id: 'vid-1', equipmentId: 'eq-1' }),
    );

    const node = state.canvases.entities['canvas-1']!.nodes.find((n) => n.id === 'vid-1');
    const data = node?.data as VideoNodeData;
    expect(data.equipmentRefs).toHaveLength(1);
    expect(data.equipmentRefs![0]).toEqual({
      equipmentId: 'eq-2',
      angleSlot: undefined,
      referenceImageHash: undefined,
    });
  });

  it('sets equipment refs wholesale', () => {
    let state = setup();
    state = canvasSlice.reducer(
      state,
      setNodeEquipmentRefs({
        id: 'img-1',
        equipmentRefs: [{ equipmentId: 'eq-a' }, { equipmentId: 'eq-b' }, { equipmentId: 'eq-c' }],
      }),
    );

    const node = state.canvases.entities['canvas-1']!.nodes.find((n) => n.id === 'img-1');
    const data = node?.data as ImageNodeData;
    expect(data.equipmentRefs).toHaveLength(3);
  });

  it('ignores equipment ref actions on text nodes', () => {
    let state = setup();
    state = canvasSlice.reducer(state, addNodeEquipmentRef({ id: 'txt-1', equipmentId: 'eq-1' }));

    const node = state.canvases.entities['canvas-1']!.nodes.find((n) => n.id === 'txt-1');
    expect((node?.data as unknown as Record<string, unknown>).equipmentRefs).toBeUndefined();
  });
});
