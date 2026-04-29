import type { AgentToolRegistry } from '@lucid-fin/application';

export type RunningCommanderSession = {
  aborted: boolean;
  canvasId: string;
  orchestrator?: import('@lucid-fin/application').AgentOrchestrator;
  lastActivity: number;
};

export const runningSessions = new Map<string, RunningCommanderSession>();
export let lastToolRegistry: AgentToolRegistry | null = null;

export function setLastToolRegistry(registry: AgentToolRegistry): void {
  lastToolRegistry = registry;
}

const SESSION_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
let cleanupTimer: ReturnType<typeof setInterval> | null = null;

export function startSessionCleanup(): void {
  if (cleanupTimer) return;
  cleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [id, session] of runningSessions) {
      if (!session.aborted && now - session.lastActivity > SESSION_TIMEOUT_MS) {
        session.aborted = true;
        runningSessions.delete(id);
        console.warn(
          `Commander session ${id} timed out after ${SESSION_TIMEOUT_MS / 1000}s inactivity`,
        );
      }
    }
  }, 60_000); // Check every minute
}

export function stopSessionCleanup(): void {
  if (cleanupTimer) {
    clearInterval(cleanupTimer);
    cleanupTimer = null;
  }
}

export function touchSession(canvasId: string): void {
  const session = runningSessions.get(canvasId);
  if (session) session.lastActivity = Date.now();
}
