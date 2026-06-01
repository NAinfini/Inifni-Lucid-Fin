import { WorkflowEngine } from './workflow-engine.js';

export class WorkflowRecovery {
  constructor(private readonly engine: WorkflowEngine) {}

  async recover(workflowRunId?: string): Promise<number> {
    return this.engine.recover(workflowRunId);
  }
}
