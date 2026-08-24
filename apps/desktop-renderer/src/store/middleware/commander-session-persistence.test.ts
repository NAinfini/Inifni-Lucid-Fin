// @vitest-environment jsdom

import { configureStore } from '@reduxjs/toolkit';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createCommanderSession } from '../../commander/state/helpers.js';
import { getAPI } from '../../utils/api.js';
import { addUserMessage, commanderSlice, newSession, renameSession } from '../slices/commander.js';
import { loggerSlice } from '../slices/logger.js';
import { toastSlice } from '../slices/toast.js';
import {
  commanderSessionPersistenceMiddleware,
  flushPendingCommanderSessionSaves,
} from './commander-session-persistence.js';

vi.mock('../../utils/api.js', () => ({ getAPI: vi.fn() }));

describe('Commander session SQLite persistence', () => {
  afterEach(() => vi.clearAllMocks());

  it('serializes transcript snapshots per session without dropping a newer update', async () => {
    let releaseFirstSave: (() => void) | undefined;
    const firstSave = new Promise<void>((resolve) => {
      releaseFirstSave = resolve;
    });
    const upsert = vi.fn().mockReturnValueOnce(firstSave).mockResolvedValue(undefined);
    vi.mocked(getAPI).mockReturnValue({ session: { upsert } } as never);

    const session = createCommanderSession('session-1', null, 1);
    const store = configureStore({
      reducer: {
        commander: commanderSlice.reducer,
        logger: loggerSlice.reducer,
        toast: toastSlice.reducer,
      },
      middleware: (defaults) => defaults().concat(commanderSessionPersistenceMiddleware),
      preloadedState: {
        commander: {
          ...commanderSlice.getInitialState(),
          sessions: [session],
          activeSessionId: session.id,
        },
      },
    });

    store.dispatch(addUserMessage({ sessionId: session.id, content: 'first' }));
    store.dispatch(addUserMessage({ sessionId: session.id, content: 'second' }));

    expect(upsert).toHaveBeenCalledTimes(1);
    expect(JSON.parse(upsert.mock.calls[0]![0].messages)).toHaveLength(1);

    releaseFirstSave?.();
    await flushPendingCommanderSessionSaves();

    expect(upsert).toHaveBeenCalledTimes(2);
    expect(JSON.parse(upsert.mock.calls[1]![0].messages)).toHaveLength(2);
  });

  it('persists a newly created empty chat before it can be moved or restarted', async () => {
    const upsert = vi.fn().mockResolvedValue(undefined);
    vi.mocked(getAPI).mockReturnValue({ session: { upsert } } as never);
    const store = configureStore({
      reducer: {
        commander: commanderSlice.reducer,
        logger: loggerSlice.reducer,
        toast: toastSlice.reducer,
      },
      middleware: (defaults) => defaults().concat(commanderSessionPersistenceMiddleware),
    });

    store.dispatch(newSession('canvas-a'));
    await flushPendingCommanderSessionSaves();

    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ defaultCanvasId: 'canvas-a', messages: '[]' }),
    );
  });

  it('never overwrites a lazy transcript with its unloaded placeholder', async () => {
    const upsert = vi.fn().mockResolvedValue(undefined);
    vi.mocked(getAPI).mockReturnValue({ session: { upsert } } as never);
    const session = { ...createCommanderSession('session-lazy', null, 1), messageCount: 3 };
    const store = configureStore({
      reducer: {
        commander: commanderSlice.reducer,
        logger: loggerSlice.reducer,
        toast: toastSlice.reducer,
      },
      middleware: (defaults) => defaults().concat(commanderSessionPersistenceMiddleware),
      preloadedState: {
        commander: {
          ...commanderSlice.getInitialState(),
          sessions: [session],
          activeSessionId: null,
        },
      },
    });

    store.dispatch(renameSession({ id: session.id, title: 'Renamed' }));
    await flushPendingCommanderSessionSaves();

    expect(upsert).not.toHaveBeenCalled();
  });
});
