export interface ProjectSession {
  id: string;
  projectId: string;
  projectPath: string;
  openedAt: number;
}

const sessions = new Map<string, ProjectSession>();

export function openProjectSession(projectId: string, projectPath: string): ProjectSession {
  const session: ProjectSession = {
    id: crypto.randomUUID(),
    projectId,
    projectPath,
    openedAt: Date.now(),
  };
  sessions.set(session.id, session);
  return session;
}

export function getProjectSession(sessionId: string): ProjectSession | undefined {
  return sessions.get(sessionId);
}

export function closeProjectSession(sessionId: string): void {
  sessions.delete(sessionId);
}

export function getActiveProjectSession(): ProjectSession | undefined {
  // Returns the most recently opened session — backward compat
  let latest: ProjectSession | undefined;
  for (const session of sessions.values()) {
    if (!latest || session.openedAt > latest.openedAt) latest = session;
  }
  return latest;
}
