import { describe, expect, it } from 'vitest';
import {
  reviewCutCancelChannel,
  reviewCutOpenChannel,
  reviewCutStartChannel,
  reviewCutStatusChannel,
} from './batch-10.js';

describe('Review Cut IPC contracts', () => {
  it('accepts only the exact approved Delivery identity on start', () => {
    const request = {
      taskListId: 'list-1',
      canvasId: 'canvas-1',
      expectedManifestRevision: 3,
      expectedManifestHash: 'a'.repeat(64),
    };

    expect(reviewCutStartChannel.schemas.request.parse(request)).toEqual(request);
    expect(() =>
      reviewCutStartChannel.schemas.request.parse({
        ...request,
        outputPath: 'C:\\forged.mp4',
      }),
    ).toThrow();
    expect(() =>
      reviewCutStartChannel.schemas.request.parse({
        ...request,
        sourcePaths: ['C:\\forged.mp4'],
      }),
    ).toThrow();
  });

  it('exposes only start, status, cancel, and open', () => {
    expect(
      [
        reviewCutStartChannel,
        reviewCutStatusChannel,
        reviewCutCancelChannel,
        reviewCutOpenChannel,
      ].map(({ channel }) => channel),
    ).toEqual(['reviewCut:start', 'reviewCut:status', 'reviewCut:cancel', 'reviewCut:open']);
  });
});
