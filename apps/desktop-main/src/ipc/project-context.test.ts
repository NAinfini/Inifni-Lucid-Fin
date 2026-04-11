import { beforeEach, describe, expect, it, vi } from 'vitest';

const getActiveProjectSessionMock = vi.hoisted(() => vi.fn());

vi.mock('./project-session.js', () => ({
  getActiveProjectSession: getActiveProjectSessionMock,
}));

async function loadModule() {
  vi.resetModules();
  return import('./project-context.js');
}

beforeEach(() => {
  vi.clearAllMocks();
  getActiveProjectSessionMock.mockReturnValue(undefined);
});

describe('project context', () => {
  it('returns null when there is no explicit project and no active session', async () => {
    const { getCurrentProjectId, getCurrentProjectPath } = await loadModule();

    expect(getCurrentProjectId()).toBeNull();
    expect(getCurrentProjectPath()).toBeNull();
  });

  it('gets the explicitly set current project values', async () => {
    const { getCurrentProjectId, getCurrentProjectPath, setCurrentProject } = await loadModule();

    getActiveProjectSessionMock.mockReturnValue({
      projectId: 'session-project',
      projectPath: 'C:/session',
    });

    setCurrentProject('project-1', 'C:/projects/project-1');

    expect(getCurrentProjectId()).toBe('project-1');
    expect(getCurrentProjectPath()).toBe('C:/projects/project-1');
  });

  it('clears explicit values and falls back to the active project session', async () => {
    const { clearCurrentProject, getCurrentProjectId, getCurrentProjectPath, setCurrentProject } =
      await loadModule();

    setCurrentProject('project-1', 'C:/projects/project-1');
    clearCurrentProject();

    expect(getCurrentProjectId()).toBeNull();
    expect(getCurrentProjectPath()).toBeNull();

    getActiveProjectSessionMock.mockReturnValue({
      projectId: 'session-project',
      projectPath: 'C:/session',
    });

    expect(getCurrentProjectId()).toBe('session-project');
    expect(getCurrentProjectPath()).toBe('C:/session');
  });
});
