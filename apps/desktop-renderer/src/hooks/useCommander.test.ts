// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { Provider } from 'react-redux';
import { setCanvases, setActiveCanvas } from '../store/slices/canvas.js';
import { clearHistory, startStreaming } from '../store/slices/commander.js';
import { setEquipment } from '../store/slices/equipment.js';
import { store } from '../store/index.js';
import { syncCommanderEntitiesForTool, useCommander } from './useCommander.js';
import { getAPI, type LucidAPI } from '../utils/api.js';

vi.mock('../utils/api.js', () => ({
  getAPI: vi.fn(),
}));

type CommanderStreamEvent = Parameters<Parameters<LucidAPI['commander']['onStream']>[0]>[0];

describe('syncCommanderEntitiesForTool', () => {
  it('refreshes equipment state for equipment tool updates', async () => {
    const list = [{ id: 'eq-1', name: 'Lantern' }] as import('@lucid-fin/contracts').Equipment[];
    const dispatch = vi.fn();
    const api = {
      character: { list: vi.fn() },
      equipment: { list: vi.fn(async () => list) },
      location: { list: vi.fn() },
    } as unknown as Parameters<typeof syncCommanderEntitiesForTool>[0];

    await syncCommanderEntitiesForTool(
      api,
      dispatch as unknown as Parameters<typeof syncCommanderEntitiesForTool>[1],
      'equipment.create',
    );

    expect(api!.equipment?.list).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledWith(setEquipment(list));
    expect(api!.character?.list).not.toHaveBeenCalled();
    expect(api!.location?.list).not.toHaveBeenCalled();
  });

  it('does not route scene tool updates through character refresh', async () => {
    const dispatch = vi.fn();
    const api = {
      character: { list: vi.fn() },
      equipment: { list: vi.fn() },
      location: { list: vi.fn() },
      scene: { list: vi.fn() },
    } as unknown as Parameters<typeof syncCommanderEntitiesForTool>[0];

    await syncCommanderEntitiesForTool(
      api,
      dispatch as unknown as Parameters<typeof syncCommanderEntitiesForTool>[1],
      'scene.create',
    );

    expect(api!.character?.list).not.toHaveBeenCalled();
    expect(api!.equipment?.list).not.toHaveBeenCalled();
    expect(api!.location?.list).not.toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalled();
  });
});

function HookHarness() {
  useCommander();
  return null;
}

afterEach(() => {
  cleanup();
  store.dispatch(clearHistory());
  store.dispatch(setCanvases([]));
  store.dispatch(setActiveCanvas(null));
  vi.clearAllMocks();
});

describe('useCommander stream completion', () => {
  it('persists streamed content when the done event completes the session', async () => {
    let onStream: ((data: CommanderStreamEvent) => void) | undefined;

    vi.mocked(getAPI).mockReturnValue({
      commander: {
        onStream: (cb: Parameters<LucidAPI['commander']['onStream']>[0]) => {
          onStream = cb;
          return () => {};
        },
        onCanvasUpdated: () => () => {},
        onEntitiesUpdated: () => () => {},
        onSettingsDispatch: () => () => {},
      },
    } as never);

    store.dispatch(setCanvases([{
      id: 'canvas-1',
      projectId: 'project-1',
      name: 'Main',
      nodes: [],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
      createdAt: 1,
      updatedAt: 1,
      notes: [],
    }]));
    store.dispatch(setActiveCanvas('canvas-1'));
    store.dispatch(startStreaming());

    render(React.createElement(Provider, { store, children: React.createElement(HookHarness) }));

    await act(async () => {
      onStream?.({ type: 'chunk', content: 'Final answer' });
      onStream?.({ type: 'done' });
    });

    await waitFor(() => {
      expect(store.getState().commander.messages).toEqual([
        expect.objectContaining({
          role: 'assistant',
          content: 'Final answer',
        }),
      ]);
    });
  });
});
