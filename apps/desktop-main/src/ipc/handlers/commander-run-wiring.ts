import type { TaskExecutionEngine } from '@lucid-fin/application';

type ContextRecoveryReport = Parameters<TaskExecutionEngine['reportContextRecovery']>[0];

export function createCommanderRunWiring(
  args: { defaultCanvasId?: string; sessionId: string },
  taskExecutionEngine: Pick<TaskExecutionEngine, 'reportContextRecovery'>,
) {
  return {
    toolSessionId: args.sessionId,
    onContextRecoveryReport: (report: ContextRecoveryReport) =>
      taskExecutionEngine.reportContextRecovery(report),
  };
}
