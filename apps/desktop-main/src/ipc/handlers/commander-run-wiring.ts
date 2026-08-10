import type { WorkflowEngine } from '@lucid-fin/application';

type ContextRecoveryReport = Parameters<WorkflowEngine['reportContextRecovery']>[0];

export function createCommanderRunWiring(
  args: { canvasId: string; sessionId?: string },
  workflowEngine: Pick<WorkflowEngine, 'reportContextRecovery'>,
) {
  return {
    toolSessionId: args.sessionId ?? args.canvasId,
    onContextRecoveryReport: (report: ContextRecoveryReport) =>
      workflowEngine.reportContextRecovery(report),
  };
}
