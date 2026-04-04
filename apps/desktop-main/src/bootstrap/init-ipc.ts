import type { BrowserWindow } from 'electron';
import type { SqliteIndex } from '@lucid-fin/storage';
import { ProjectFS, CAS, Keychain, type PromptStore } from '@lucid-fin/storage';
import type { AdapterRegistry, LLMRegistry } from '@lucid-fin/adapters-ai';
import type { JobQueue, WorkflowEngine, AgentOrchestrator } from '@lucid-fin/application';
import { registerAllHandlers } from '../ipc/router.js';

export function initIpc(
  getWindow: () => BrowserWindow | null,
  db: SqliteIndex,
  projectFS: ProjectFS,
  cas: CAS,
  keychain: Keychain,
  registry: AdapterRegistry,
  jobQueue: JobQueue,
  llmRegistry: LLMRegistry,
  workflowEngine: WorkflowEngine,
  agent: AgentOrchestrator | null,
  promptStore: PromptStore,
): void {
  registerAllHandlers(
    getWindow,
    db,
    projectFS,
    cas,
    keychain,
    registry,
    jobQueue,
    llmRegistry,
    workflowEngine,
    agent,
    promptStore,
  );
}
