import { describe, expect, it } from 'vitest';
import { sessionListChannel, sessionMoveChannel } from './batch-10.js';

describe('session IPC channels', () => {
  it('requires messageCount in list summaries', () => {
    const summary = {
      id: 'session-1',
      defaultCanvasId: null,
      title: 'Story direction',
      messageCount: 3,
      createdAt: 1,
      updatedAt: 2,
    };
    expect(sessionListChannel.schemas.response.parse([summary])).toEqual([summary]);
    expect(() =>
      sessionListChannel.schemas.response.parse([{ ...summary, messageCount: -1 }]),
    ).toThrow();
  });

  it('accepts one explicit nullable Canvas move request', () => {
    expect(
      sessionMoveChannel.schemas.request.parse({
        id: 'session-1',
        defaultCanvasId: 'canvas-2',
      }),
    ).toEqual({ id: 'session-1', defaultCanvasId: 'canvas-2' });
    expect(
      sessionMoveChannel.schemas.request.parse({ id: 'session-1', defaultCanvasId: null }),
    ).toEqual({ id: 'session-1', defaultCanvasId: null });
    expect(() => sessionMoveChannel.schemas.request.parse({ id: 'session-1' })).toThrow();
    expect(() =>
      sessionMoveChannel.schemas.request.parse({ id: 'session-1', defaultCanvasId: '' }),
    ).toThrow();
  });
});
