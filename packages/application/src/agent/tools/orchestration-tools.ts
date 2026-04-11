import type { AgentTool } from '../tool-registry.js';

export interface OrchestrationListEntry {
  id: string;
  sceneId: string;
  sceneTitle: string;
  motion?: string;
  camera?: string;
  mood?: string;
  duration?: number;
}

export interface OrchestrationToolDeps {
  listOrchestrations: () => Promise<OrchestrationListEntry[]>;
  deleteOrchestration: (id: string) => Promise<void>;
}

export function createOrchestrationTools(_deps: OrchestrationToolDeps): AgentTool[] {
  return [];
}
