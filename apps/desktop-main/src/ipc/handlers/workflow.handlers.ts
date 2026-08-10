import type { IpcMain } from 'electron';
import type { WorkflowEngine } from '@lucid-fin/application';
import type {
  SelectVisualConstitutionCandidateInput,
  WorkflowApprovalGateKey,
  WorkflowDecisionFilter,
  UserRejectWorkflowGateInput,
  UserRequestWorkflowGateChangesInput,
} from '@lucid-fin/contracts';
import log from '../../logger.js';

export function registerWorkflowHandlers(
  ipcMain: IpcMain,
  workflowEngine: WorkflowEngine,
  options?: {
    requestCommanderContinuation?: (workflowRunId: string, reason: string) => void;
  },
): void {
  ipcMain.handle('workflow:list', async (_event, args?: { status?: string }) => {
    return workflowEngine.list(args);
  });

  ipcMain.handle('workflow:get', async (_event, args: { id: string }) => {
    const workflow = workflowEngine.get(args.id);
    if (!workflow) {
      log.error('Workflow not found', {
        category: 'workflow',
        workflowRunId: args.id,
      });
      throw new Error(`Workflow "${args.id}" not found`);
    }
    return workflow;
  });

  ipcMain.handle('workflow:getStages', async (_event, args: { workflowRunId: string }) => {
    return workflowEngine.getStages(args.workflowRunId);
  });

  ipcMain.handle('workflow:getTasks', async (_event, args: { workflowRunId: string }) => {
    return workflowEngine.getTasks(args.workflowRunId);
  });

  ipcMain.handle(
    'workflow:start',
    async (
      _event,
      args: {
        workflowType: string;
        entityType: string;
        entityId?: string;
        triggerSource?: string;
        input?: Record<string, unknown>;
        metadata?: Record<string, unknown>;
      },
    ) => {
      log.info('Workflow start requested', {
        category: 'workflow',
        workflowType: args.workflowType,
        entityType: args.entityType,
        entityId: args.entityId,
        triggerSource: args.triggerSource,
      });
      const workflowRunId = workflowEngine.start(args);
      log.info('Workflow started', {
        category: 'workflow',
        workflowRunId,
        workflowType: args.workflowType,
      });
      return { workflowRunId };
    },
  );

  ipcMain.handle('workflow:pause', async (_event, args: { id: string }) => {
    log.info('Workflow pause requested', {
      category: 'workflow',
      workflowRunId: args.id,
    });
    await workflowEngine.pause(args.id);
  });

  ipcMain.handle('workflow:resume', async (_event, args: { id: string }) => {
    log.info('Workflow resume requested', {
      category: 'workflow',
      workflowRunId: args.id,
    });
    await workflowEngine.resume(args.id);
    options?.requestCommanderContinuation?.(args.id, 'workflow-resumed');
  });

  ipcMain.handle('workflow:cancel', async (_event, args: { id: string }) => {
    log.info('Workflow cancel requested', {
      category: 'workflow',
      workflowRunId: args.id,
    });
    await workflowEngine.cancel(args.id);
  });

  ipcMain.handle('workflow:retryTask', async (_event, args: { taskRunId: string }) => {
    await workflowEngine.retryTask(args.taskRunId);
  });

  ipcMain.handle('workflow:retryStage', async (_event, args: { stageRunId: string }) => {
    await workflowEngine.retryStage(args.stageRunId);
  });

  ipcMain.handle('workflow:retryWorkflow', async (_event, args: { id: string }) => {
    await workflowEngine.retryWorkflow(args.id);
    options?.requestCommanderContinuation?.(args.id, 'workflow-retried');
  });

  ipcMain.handle(
    'workflow:getPendingApproval',
    async (_event, args: { workflowRunId: string }) =>
      workflowEngine.getPendingApprovalContext(args.workflowRunId) ?? null,
  );

  ipcMain.handle(
    'workflow:getVisualAuditions',
    async (_event, args: { workflowRunId: string }) =>
      workflowEngine.getVisualAuditionContext(args.workflowRunId) ?? null,
  );

  ipcMain.handle(
    'workflow:getFinalExport',
    async (_event, args: { workflowRunId: string }) =>
      workflowEngine.getFinalExportContext(args.workflowRunId) ?? null,
  );

  ipcMain.handle(
    'workflow:selectVisualCandidate',
    async (_event, args: SelectVisualConstitutionCandidateInput) => {
      log.info('Human visual candidate selection requested', {
        category: 'workflow',
        workflowRunId: args.workflowRunId,
        candidateId: args.candidateId,
        auditionRevision: args.expectedAuditionRevision,
      });
      return workflowEngine.selectVisualConstitutionCandidateFromUser({
        workflowRunId: args.workflowRunId,
        candidateId: args.candidateId,
        expectedRowVersion: args.expectedRowVersion,
        expectedAuditionRevision: args.expectedAuditionRevision,
        expectedAuditionHash: args.expectedAuditionHash,
      });
    },
  );

  ipcMain.handle(
    'workflow:approveGate',
    async (
      _event,
      args: {
        workflowRunId: string;
        gateKey: WorkflowApprovalGateKey;
        expectedRowVersion: number;
        expectedSubjectRevision: number;
        expectedSubjectHash: string;
      },
    ) => {
      log.info('Human workflow approval requested', {
        category: 'workflow',
        workflowRunId: args.workflowRunId,
        gateKey: args.gateKey,
        subjectRevision: args.expectedSubjectRevision,
      });
      const result = workflowEngine.approvePendingGateFromUser({
        workflowRunId: args.workflowRunId,
        gateKey: args.gateKey,
        expectedRowVersion: args.expectedRowVersion,
        expectedSubjectRevision: args.expectedSubjectRevision,
        expectedSubjectHash: args.expectedSubjectHash,
      });
      if (result.ok && result.code === 'approved') {
        await workflowEngine.waitForAutoPump();
        options?.requestCommanderContinuation?.(result.run.id, `gate-approved:${args.gateKey}`);
      }
      return result;
    },
  );

  ipcMain.handle(
    'workflow:requestChanges',
    async (_event, args: UserRequestWorkflowGateChangesInput) => {
      log.info('Human workflow changes requested', {
        category: 'workflow',
        workflowRunId: args.workflowRunId,
        gateKey: args.gateKey,
        subjectRevision: args.expectedSubjectRevision,
      });
      const result = workflowEngine.requestChangesPendingGateFromUser({
        workflowRunId: args.workflowRunId,
        gateKey: args.gateKey,
        expectedRowVersion: args.expectedRowVersion,
        expectedSubjectRevision: args.expectedSubjectRevision,
        expectedSubjectHash: args.expectedSubjectHash,
        reason: args.reason,
      });
      if (result.ok) {
        await workflowEngine.pump(args.workflowRunId);
        options?.requestCommanderContinuation?.(
          args.workflowRunId,
          `gate-changes-requested:${args.gateKey}`,
        );
      }
      return result;
    },
  );

  ipcMain.handle('workflow:rejectGate', async (_event, args: UserRejectWorkflowGateInput) => {
    log.info('Human workflow gate rejected', {
      category: 'workflow',
      workflowRunId: args.workflowRunId,
      gateKey: args.gateKey,
      subjectRevision: args.expectedSubjectRevision,
    });
    const result = workflowEngine.rejectPendingGateFromUser({
      workflowRunId: args.workflowRunId,
      gateKey: args.gateKey,
      expectedRowVersion: args.expectedRowVersion,
      expectedSubjectRevision: args.expectedSubjectRevision,
      expectedSubjectHash: args.expectedSubjectHash,
      reason: args.reason,
    });
    if (result.ok) {
      await workflowEngine.pump(args.workflowRunId);
      options?.requestCommanderContinuation?.(args.workflowRunId, `gate-rejected:${args.gateKey}`);
    }
    return result;
  });

  ipcMain.handle('workflow:listPendingDecisions', async (_event, args: WorkflowDecisionFilter) =>
    workflowEngine.listPendingDecisions(args),
  );
}
