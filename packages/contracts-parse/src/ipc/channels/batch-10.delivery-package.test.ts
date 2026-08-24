import { describe, expect, it } from 'vitest';
import {
  deliveryPackageCancelChannel,
  deliveryPackageOpenChannel,
  deliveryPackageRetryChannel,
  deliveryPackageStartChannel,
  deliveryPackageStatusChannel,
} from './batch-10.js';

describe('Delivery package IPC contracts', () => {
  it('exposes only approval identity on start', () => {
    const request = {
      taskListId: 'list-1',
      canvasId: 'canvas-1',
      expectedManifestRevision: 3,
      expectedManifestHash: 'a'.repeat(64),
    };
    expect(deliveryPackageStartChannel.schemas.request.parse(request)).toEqual(request);
    expect(() =>
      deliveryPackageStartChannel.schemas.request.parse({
        ...request,
        destinationDirectory: 'C:\\forged',
      }),
    ).toThrow();
    expect(() =>
      deliveryPackageStartChannel.schemas.request.parse({
        ...request,
        sourcePaths: ['C:\\forged.mp4'],
      }),
    ).toThrow();
  });

  it('uses exactly five deliveryPackage channels and no render aliases', () => {
    expect(
      [
        deliveryPackageStartChannel,
        deliveryPackageStatusChannel,
        deliveryPackageCancelChannel,
        deliveryPackageRetryChannel,
        deliveryPackageOpenChannel,
      ].map(({ channel }) => channel),
    ).toEqual([
      'deliveryPackage:start',
      'deliveryPackage:status',
      'deliveryPackage:cancel',
      'deliveryPackage:retry',
      'deliveryPackage:open',
    ]);
  });
});
