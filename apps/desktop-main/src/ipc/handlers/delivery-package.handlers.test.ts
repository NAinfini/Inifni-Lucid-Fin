import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IpcMain } from 'electron';
import { registerDeliveryPackageHandlers } from './delivery-package.handlers.js';

describe('registerDeliveryPackageHandlers', () => {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  const service = {
    startApproved: vi.fn(async () => ({
      attemptId: 'attempt-1',
      status: 'queued',
      progress: 0,
      destinationPath: 'C:\\delivery\\movie-delivery-aaaaaaaaaaaa',
      manifestRevision: 2,
      manifestHash: 'a'.repeat(64),
      attempt: 1,
    })),
    getStatus: vi.fn(() => null),
    cancel: vi.fn(() => null),
    retry: vi.fn(),
    requireCompletedPackagePath: vi.fn(() => 'C:\\delivery\\movie-delivery-aaaaaaaaaaaa'),
  };
  const showOpenDialog = vi.fn();
  const openPath = vi.fn(async () => '');

  beforeEach(() => {
    handlers.clear();
    vi.clearAllMocks();
    registerDeliveryPackageHandlers(
      { handle: (channel, handler) => handlers.set(channel, handler) } as unknown as IpcMain,
      () => null,
      service as never,
      { dialog: { showOpenDialog } as never, shell: { openPath } },
    );
  });

  it('always gets the destination from the host directory picker', async () => {
    showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: ['C:\\delivery'] });
    const request = {
      taskListId: 'list-1',
      canvasId: 'canvas-1',
      expectedManifestRevision: 2,
      expectedManifestHash: 'a'.repeat(64),
    };

    await expect(handlers.get('deliveryPackage:start')?.({}, request)).resolves.toMatchObject({
      cancelled: false,
      attempt: { attemptId: 'attempt-1' },
    });
    expect(showOpenDialog).toHaveBeenCalledOnce();
    expect(service.startApproved).toHaveBeenCalledWith({
      ...request,
      destinationDirectory: 'C:\\delivery',
    });
  });

  it('returns a cancellation result without starting when the picker is cancelled', async () => {
    showOpenDialog.mockResolvedValueOnce({ canceled: true, filePaths: [] });

    await expect(
      handlers.get('deliveryPackage:start')?.({}, {
        taskListId: 'list-1',
        canvasId: 'canvas-1',
        expectedManifestRevision: 2,
        expectedManifestHash: 'a'.repeat(64),
      }),
    ).resolves.toEqual({ cancelled: true });
    expect(service.startApproved).not.toHaveBeenCalled();
  });

  it('rejects renderer paths and source data', async () => {
    await expect(
      handlers.get('deliveryPackage:start')?.({}, {
        taskListId: 'list-1',
        canvasId: 'canvas-1',
        expectedManifestRevision: 2,
        expectedManifestHash: 'a'.repeat(64),
        destinationDirectory: 'C:\\forged',
      }),
    ).rejects.toThrow('unsupported field "destinationDirectory"');
    await expect(
      handlers.get('deliveryPackage:start')?.({}, {
        taskListId: 'list-1',
        canvasId: 'canvas-1',
        expectedManifestRevision: 2,
        expectedManifestHash: 'a'.repeat(64),
        items: [{ selectedVideoHash: 'b'.repeat(64) }],
      }),
    ).rejects.toThrow('unsupported field "items"');
  });

  it('registers only the five Delivery package operations and opens completed packages', async () => {
    expect([...handlers.keys()].sort()).toEqual([
      'deliveryPackage:cancel',
      'deliveryPackage:open',
      'deliveryPackage:retry',
      'deliveryPackage:start',
      'deliveryPackage:status',
    ]);
    await expect(
      handlers.get('deliveryPackage:open')?.({}, { attemptId: 'attempt-1' }),
    ).resolves.toEqual({ opened: true });
    expect(openPath).toHaveBeenCalledWith('C:\\delivery\\movie-delivery-aaaaaaaaaaaa');
  });
});
