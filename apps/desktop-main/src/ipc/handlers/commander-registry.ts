import type { AgentToolRegistry } from '@lucid-fin/application';

export type RunningCommanderSession = {
  aborted: boolean;
  canvasId: string;
  orchestrator?: import('@lucid-fin/application').AgentOrchestrator;
};

export const runningSessions = new Map<string, RunningCommanderSession>();
export let lastToolRegistry: AgentToolRegistry | null = null;

export function setLastToolRegistry(registry: AgentToolRegistry): void {
  lastToolRegistry = registry;
}
