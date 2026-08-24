import { describe, expect, it } from 'vitest';
import { parseStrict } from '../../parse.js';
import {
  canvasDeletePermanentChannel,
  canvasDeliveryUpdateChannel,
  canvasListChannel,
  canvasLoadAllChannel,
  canvasRestoreChannel,
} from './batch-07.js';

describe('Canvas lifecycle IPC contract', () => {
  it('exposes archive state on summary and full-list responses', () => {
    expect(
      parseStrict(
        canvasListChannel.schemas.response,
        [{ id: 'canvas-1', name: 'Archived', updatedAt: 20, archivedAt: 10 }],
        { name: 'canvas:list.response' },
      ),
    ).toEqual([{ id: 'canvas-1', name: 'Archived', updatedAt: 20, archivedAt: 10 }]);

    const archivedCanvas = {
      id: 'canvas-1',
      name: 'Archived',
      nodes: [],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
      notes: [],
      archivedAt: 10,
      createdAt: 1,
      updatedAt: 20,
    };
    expect(
      parseStrict(canvasLoadAllChannel.schemas.response, [archivedCanvas], {
        name: 'canvas:loadAll.response',
      }),
    ).toEqual([archivedCanvas]);
  });

  it.each([
    ['restore', canvasRestoreChannel],
    ['deletePermanent', canvasDeletePermanentChannel],
  ])('requires an id for canvas:%s', (_name, channel) => {
    expect(() =>
      parseStrict(channel.schemas.request, { id: '' }, { name: `${channel.channel}.request` }),
    ).toThrow();
    expect(
      parseStrict(channel.schemas.request, { id: 'canvas-1' }, { name: `${channel.channel}.request` }),
    ).toEqual({ id: 'canvas-1' });
  });
});

describe('Canvas delivery IPC contract', () => {
  const deliverySequence = {
    revision: 1,
    items: [
      {
        shotId: 'shot-1',
        selectedVideoHash: 'a'.repeat(64),
        trimInMs: 0,
        trimOutMs: 1_000,
        embeddedAudioEnabled: false,
      },
    ],
    updatedAt: 10,
  };

  it('accepts one exact CAS revision advance', () => {
    expect(
      parseStrict(
        canvasDeliveryUpdateChannel.schemas.request,
        { canvasId: 'canvas-1', expectedRevision: 0, deliverySequence },
        { name: 'canvasDelivery:update.request' },
      ),
    ).toEqual({ canvasId: 'canvas-1', expectedRevision: 0, deliverySequence });
  });

  it.each([-1, 1])('rejects expectedRevision %s for sequence revision 1', (expectedRevision) => {
    expect(() =>
      parseStrict(
        canvasDeliveryUpdateChannel.schemas.request,
        { canvasId: 'canvas-1', expectedRevision, deliverySequence },
        { name: 'canvasDelivery:update.request' },
      ),
    ).toThrow();
  });
});
