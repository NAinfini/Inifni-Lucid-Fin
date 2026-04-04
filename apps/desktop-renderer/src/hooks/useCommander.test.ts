import { describe, expect, it, vi } from 'vitest';
import { setEquipment } from '../store/slices/equipment.js';
import { syncCommanderEntitiesForTool } from './useCommander.js';

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
