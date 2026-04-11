/** Shared mutable state for the current project context across IPC handlers */
import { getActiveProjectSession } from './project-session.js';

let currentProjectId: string | null = null;
let currentProjectPath: string | null = null;

export function setCurrentProject(id: string, projectPath: string): void {
  currentProjectId = id;
  currentProjectPath = projectPath;
}

export function getCurrentProjectId(): string | null {
  return currentProjectId ?? getActiveProjectSession()?.projectId ?? null;
}

export function getCurrentProjectPath(): string | null {
  return currentProjectPath ?? getActiveProjectSession()?.projectPath ?? null;
}

export function clearCurrentProject(): void {
  currentProjectId = null;
  currentProjectPath = null;
}
