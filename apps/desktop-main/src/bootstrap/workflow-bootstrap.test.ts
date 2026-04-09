import { describe, expect, it, vi } from 'vitest';
import type { WorkflowEngine, AgentOrchestrator } from '@lucid-fin/application';
import type { PromptStore } from '@lucid-fin/storage';
import { initIpc } from './init-ipc.js';
import { registerAllHandlers, type AppDeps } from '../ipc/router.js';

vi.mock('../ipc/router.js', () => ({
  registerAllHandlers: vi.fn(),
}));

describe('initIpc workflow bootstrap', () => {
  it('passes the workflow engine and agent through to the ipc router registration', () => {
    const getWindow = () => null;
    const workflowEngine = {} as WorkflowEngine;
    const agent = {} as AgentOrchestrator;
    const promptStore = {} as PromptStore;
    const deps = {
      db: {} as never,
      projectFS: {} as never,
      cas: {} as never,
      keychain: {} as never,
      registry: {} as never,
      jobQueue: {} as never,
      llmRegistry: {} as never,
      workflowEngine,
      agent,
      promptStore,
    } satisfies AppDeps;

    initIpc(getWindow, deps);

    expect(registerAllHandlers).toHaveBeenCalledWith(getWindow, deps);
  });
});
