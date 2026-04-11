import { beforeEach, describe, expect, it, vi } from 'vitest';

const randomUUIDMock = vi.hoisted(() => vi.fn());

async function loadModule() {
  vi.resetModules();
  vi.stubGlobal('crypto', {
    randomUUID: randomUUIDMock,
  });
  return import('./project-session.js');
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe('project sessions', () => {
  it('opens a session and makes it retrievable by id', async () => {
    randomUUIDMock.mockReturnValue('session-1');
    vi.spyOn(Date, 'now').mockReturnValue(101);

    const { getProjectSession, openProjectSession } = await loadModule();
    const session = openProjectSession('project-1', 'C:/projects/project-1');

    expect(session).toEqual({
      id: 'session-1',
      projectId: 'project-1',
      projectPath: 'C:/projects/project-1',
      openedAt: 101,
    });
    expect(getProjectSession('session-1')).toEqual(session);
  });

  it('closes sessions so they are no longer retrievable', async () => {
    randomUUIDMock.mockReturnValue('session-1');
    vi.spyOn(Date, 'now').mockReturnValue(101);

    const { closeProjectSession, getProjectSession, openProjectSession } = await loadModule();
    const session = openProjectSession('project-1', 'C:/projects/project-1');

    closeProjectSession(session.id);

    expect(getProjectSession(session.id)).toBeUndefined();
  });

  it('returns the most recently opened session as the active session', async () => {
    randomUUIDMock.mockReturnValueOnce('session-1').mockReturnValueOnce('session-2');
    vi.spyOn(Date, 'now').mockReturnValueOnce(101).mockReturnValueOnce(202);

    const { getActiveProjectSession, openProjectSession } = await loadModule();

    openProjectSession('project-1', 'C:/projects/project-1');
    const latest = openProjectSession('project-2', 'C:/projects/project-2');

    expect(getActiveProjectSession()).toEqual(latest);
  });
});
