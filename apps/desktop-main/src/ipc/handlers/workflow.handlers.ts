import type { IpcMain } from 'electron';
import type { WorkflowEngine } from '@lucid-fin/application';

export function registerWorkflowHandlers(ipcMain: IpcMain, workflowEngine: WorkflowEngine): void {
  ipcMain.handle(
    'workflow:list',
    async (_event, args?: { projectId?: string; status?: string }) => {
      return workflowEngine.list(args);
    },
  );

  ipcMain.handle('workflow:get', async (_event, args: { id: string }) => {
    const workflow = workflowEngine.get(args.id);
    if (!workflow) {
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
        projectId: string;
        entityType: string;
        entityId?: string;
        triggerSource?: string;
        input?: Record<string, unknown>;
        metadata?: Record<string, unknown>;
      },
    ) => {
      const workflowRunId = workflowEngine.start(args);
      return { workflowRunId };
    },
  );

  ipcMain.handle('workflow:pause', async (_event, args: { id: string }) => {
    await workflowEngine.pause(args.id);
  });

  ipcMain.handle('workflow:resume', async (_event, args: { id: string }) => {
    await workflowEngine.resume(args.id);
  });

  ipcMain.handle('workflow:cancel', async (_event, args: { id: string }) => {
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
  });
}
