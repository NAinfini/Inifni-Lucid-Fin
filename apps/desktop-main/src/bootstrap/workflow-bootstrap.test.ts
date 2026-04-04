import { describe, expect, it, vi } from 'vitest';
import type { WorkflowEngine, AgentOrchestrator } from '@lucid-fin/application';
import type { PromptStore } from '@lucid-fin/storage';
import { initIpc } from './init-ipc.js';
import { registerAllHandlers } from '../ipc/router.js';

vi.mock('../ipc/router.js', () => ({
  registerAllHandlers: vi.fn(),
}));

describe('initIpc workflow bootstrap', () => {
  it('passes the workflow engine and agent through to the ipc router registration', () => {
    const getWindow = () => null;
    const workflowEngine = {} as WorkflowEngine;
    const agent = {} as AgentOrchestrator;
    const promptStore = {} as PromptStore;

    initIpc(
      getWindow,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      workflowEngine,
      agent,
      promptStore,
    );

    expect(registerAllHandlers).toHaveBeenCalledWith(
      getWindow,
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
      workflowEngine,
      agent,
      promptStore,
    );
  });
});
