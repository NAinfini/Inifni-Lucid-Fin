import type { IpcMain } from 'electron';
import type { TaskExecutionEngine } from '@lucid-fin/application';
import type {
  SelectVisualConstitutionCandidateInput,
  PlanApprovalGateKey,
  RequestVisualAuditionChangesInput,
  TaskDecisionFilter,
  UserRejectPlanGateInput,
  UserRequestPlanGateChangesInput,
} from '@lucid-fin/contracts';
import log from '../../logger.js';
import type { MediaTaskService } from '../../services/media-task.service.js';
import type { PromptAssemblyService } from '../../services/prompt-assembly.service.js';

export function registerTaskListHandlers(
  ipcMain: IpcMain,
  taskExecutionEngine: TaskExecutionEngine,
  options?: {
    requestCommanderContinuation?: (taskListId: string, reason: string) => void;
    mediaTaskService?: MediaTaskService;
    promptAssemblyService?: PromptAssemblyService;
  },
): void {
  ipcMain.handle(
    'taskList:list',
    async (_event, args?: { status?: string; taskListType?: string; entityType?: string }) => {
      return taskExecutionEngine.listSummaries(args);
    },
  );

  ipcMain.handle('taskList:get', async (_event, args: { id: string }) => {
    const taskList = taskExecutionEngine.getSummary(args.id);
    if (!taskList) {
      log.error('Task list not found', {
        category: 'task-list',
        taskListId: args.id,
      });
      throw new Error(`Task list "${args.id}" not found`);
    }
    return taskList;
  });

  ipcMain.handle('taskList:getTasks', async (_event, args: { taskListId: string }) => {
    return taskExecutionEngine.getTasks(args.taskListId);
  });

  ipcMain.handle(
    'taskList:startMedia',
    async (
      _event,
      args: {
        canvasId: string;
        nodeId: string;
        commanderSessionId: string;
        providerId?: string;
        seed?: number;
        commanderIntent?: string;
      },
    ) => {
      if (!options?.mediaTaskService) throw new Error('Media Task service is unavailable');
      const view = await options.mediaTaskService.start(args);
      if (!view.promptAssembly) {
        throw new Error('Media Task did not prepare a Prompt Assembly');
      }
      return { taskListId: view.id, promptAssemblyId: view.promptAssembly.id };
    },
  );

  ipcMain.handle(
    'taskList:cancelMedia',
    async (_event, args: { canvasId: string; nodeId: string; commanderSessionId: string }) => {
      if (!options?.mediaTaskService) throw new Error('Media Task service is unavailable');
      const view = await options.mediaTaskService.cancelForNode(
        args.canvasId,
        args.nodeId,
        args.commanderSessionId,
      );
      return view
        ? { ok: true as const, taskListId: view.id, status: view.status }
        : { ok: false as const, code: 'no_active_task' as const };
    },
  );

  ipcMain.handle(
    'taskList:retryMediaEvaluation',
    async (_event, args: { taskListId: string; commanderSessionId: string }) => {
      if (!options?.mediaTaskService) throw new Error('Media Task service is unavailable');
      const view = await options.mediaTaskService.retryEvaluation(
        args.taskListId,
        args.commanderSessionId,
      );
      return { taskListId: view.id, status: view.status };
    },
  );

  ipcMain.handle(
    'taskList:retryMedia',
    async (
      _event,
      args: { canvasId: string; nodeId: string; commanderSessionId: string; providerId?: string },
    ) => {
      if (!options?.mediaTaskService) throw new Error('Media Task service is unavailable');
      const view = await options.mediaTaskService.retryForNode(
        args.canvasId,
        args.nodeId,
        args.commanderSessionId,
        args.providerId,
      );
      if (!view.promptAssembly)
        throw new Error('Retried media Task did not prepare a Prompt Assembly');
      return { taskListId: view.id, promptAssemblyId: view.promptAssembly.id };
    },
  );

  ipcMain.handle('promptAssembly:get', async (_event, args: { id: string }) => {
    if (!options?.promptAssemblyService) throw new Error('Prompt Assembly service is unavailable');
    return options.promptAssemblyService.get(args.id) ?? null;
  });

  ipcMain.handle(
    'taskList:getPendingApproval',
    async (_event, args: { taskListId: string }) =>
      taskExecutionEngine.getPendingApprovalContext(args.taskListId) ?? null,
  );

  ipcMain.handle(
    'taskList:getVisualAuditions',
    async (_event, args: { taskListId: string }) =>
      taskExecutionEngine.getVisualAuditionContext(args.taskListId) ?? null,
  );

  ipcMain.handle(
    'taskList:getDelivery',
    async (_event, args: { taskListId: string }) =>
      taskExecutionEngine.getDeliveryContext(args.taskListId) ?? null,
  );

  ipcMain.handle(
    'taskList:selectVisualCandidate',
    async (_event, args: SelectVisualConstitutionCandidateInput) => {
      log.info('Human visual candidate selection requested', {
        category: 'task-list',
        taskListId: args.taskListId,
        candidateId: args.candidateId,
        auditionRevision: args.expectedAuditionRevision,
      });
      return taskExecutionEngine.selectVisualConstitutionCandidateFromUser({
        taskListId: args.taskListId,
        candidateId: args.candidateId,
        expectedRowVersion: args.expectedRowVersion,
        expectedAuditionRevision: args.expectedAuditionRevision,
        expectedAuditionHash: args.expectedAuditionHash,
      });
    },
  );

  ipcMain.handle(
    'taskList:requestVisualAuditionChanges',
    async (_event, args: RequestVisualAuditionChangesInput) => {
      log.info('Human visual audition replacement requested', {
        category: 'task-list',
        taskListId: args.taskListId,
        auditionRevision: args.expectedAuditionRevision,
      });
      const result = taskExecutionEngine.requestVisualAuditionChangesFromUser(args);
      options?.requestCommanderContinuation?.(
        result.taskList.id,
        'visual-audition-changes-requested',
      );
      return result;
    },
  );

  ipcMain.handle(
    'taskList:approveGate',
    async (
      _event,
      args: {
        taskListId: string;
        gateKey: PlanApprovalGateKey;
        expectedRowVersion: number;
        expectedSubjectRevision: number;
        expectedSubjectHash: string;
      },
    ) => {
      log.info('Human task-list approval requested', {
        category: 'task-list',
        taskListId: args.taskListId,
        gateKey: args.gateKey,
        subjectRevision: args.expectedSubjectRevision,
      });
      const result = taskExecutionEngine.approvePendingGateFromUser({
        taskListId: args.taskListId,
        gateKey: args.gateKey,
        expectedRowVersion: args.expectedRowVersion,
        expectedSubjectRevision: args.expectedSubjectRevision,
        expectedSubjectHash: args.expectedSubjectHash,
      });
      if (result.ok && result.code === 'approved') {
        await taskExecutionEngine.waitForAutoPump();
        options?.requestCommanderContinuation?.(
          result.taskList.id,
          `gate-approved:${args.gateKey}`,
        );
      }
      return result;
    },
  );

  ipcMain.handle(
    'taskList:requestChanges',
    async (_event, args: UserRequestPlanGateChangesInput) => {
      log.info('Human task-list changes requested', {
        category: 'task-list',
        taskListId: args.taskListId,
        gateKey: args.gateKey,
        subjectRevision: args.expectedSubjectRevision,
      });
      const result = taskExecutionEngine.requestChangesPendingGateFromUser({
        taskListId: args.taskListId,
        gateKey: args.gateKey,
        expectedRowVersion: args.expectedRowVersion,
        expectedSubjectRevision: args.expectedSubjectRevision,
        expectedSubjectHash: args.expectedSubjectHash,
        reason: args.reason,
      });
      if (result.ok) {
        await taskExecutionEngine.pump(args.taskListId);
        options?.requestCommanderContinuation?.(
          args.taskListId,
          `gate-changes-requested:${args.gateKey}`,
        );
      }
      return result;
    },
  );

  ipcMain.handle('taskList:rejectGate', async (_event, args: UserRejectPlanGateInput) => {
    log.info('Human task-list gate rejected', {
      category: 'task-list',
      taskListId: args.taskListId,
      gateKey: args.gateKey,
      subjectRevision: args.expectedSubjectRevision,
    });
    const result = taskExecutionEngine.rejectPendingGateFromUser({
      taskListId: args.taskListId,
      gateKey: args.gateKey,
      expectedRowVersion: args.expectedRowVersion,
      expectedSubjectRevision: args.expectedSubjectRevision,
      expectedSubjectHash: args.expectedSubjectHash,
      reason: args.reason,
    });
    if (result.ok) {
      await taskExecutionEngine.pump(args.taskListId);
      options?.requestCommanderContinuation?.(args.taskListId, `gate-rejected:${args.gateKey}`);
    }
    return result;
  });

  ipcMain.handle('taskList:listPendingDecisions', async (_event, args: TaskDecisionFilter) =>
    taskExecutionEngine.listPendingDecisions(args),
  );
}
