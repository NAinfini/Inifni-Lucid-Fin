export type CommanderCooperativeRuntime = {
  cancel(): void;
  pause(): boolean;
  resume(): boolean;
  cancelCurrentStep?: () => { escalated: boolean };
  injectMessage?: (content: string) => void;
  confirmTool?: (toolCallId: string, approved: boolean) => boolean;
  answerQuestion?: (toolCallId: string, answer: string) => boolean;
  hasPendingQuestion?: (toolCallId: string) => boolean;
  compactNow?: (
    instructions?: string,
  ) => Promise<{ freedChars: number; messageCount: number; toolCount: number }>;
};

export type RunningCommanderSession = {
  aborted: boolean;
  sessionId: string;
  defaultCanvasId?: string;
  authorizedCanvasIds: string[];
  runId: string;
  orchestrator?: CommanderCooperativeRuntime;
  lastActivity: number;
};

export const runningSessions = new Map<string, RunningCommanderSession>();

const SESSION_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
let cleanupTimer: ReturnType<typeof setInterval> | null = null;

export function startSessionCleanup(): void {
  if (cleanupTimer) return;
  cleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [id, session] of runningSessions) {
      if (!session.aborted && now - session.lastActivity > SESSION_TIMEOUT_MS) {
        session.aborted = true;
        session.orchestrator?.cancel();
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

export function touchSession(runId: string): void {
  const session = runningSessions.get(runId);
  if (session) session.lastActivity = Date.now();
}
