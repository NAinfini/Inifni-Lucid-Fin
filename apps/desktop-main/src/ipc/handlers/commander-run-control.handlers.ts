import type { IpcMain } from 'electron';
import type { TaskExecutionEngine } from '@lucid-fin/application';
import type {
  CommanderRunControlRequest,
  CommanderRunControlResponse,
  CommanderRunRecord,
  CommanderRunTreeRequest,
  CommanderRunTreeResponse,
} from '@lucid-fin/contracts';
import {
  commanderRunControlChannel,
  commanderRunTreeChannel,
} from '@lucid-fin/contracts-parse';
import { cancelOwnedNonterminalTaskLists } from './commander-task-list-lifecycle.js';
import { runningSessions } from './commander-registry.js';

type RunStore = {
  get(runId: string): CommanderRunRecord | undefined;
  listRunHeadsForSession(sessionId: string): CommanderRunRecord[];
};

export interface CommanderRunControlResult {
  response: CommanderRunControlResponse;
  cancelStepEscalated?: boolean;
}

export interface CommanderRunController {
  dispatch(request: CommanderRunControlRequest): Promise<CommanderRunControlResult>;
  tree(request: CommanderRunTreeRequest): CommanderRunTreeResponse;
}

export function createCommanderRunController(deps: {
  runs: RunStore;
  taskExecutionEngine: TaskExecutionEngine;
  retryRun: (source: CommanderRunRecord) => Promise<string | undefined>;
  toPublicRun: (run: CommanderRunRecord) => CommanderRunRecord;
}): CommanderRunController {
  const reject = (
    request: CommanderRunControlRequest,
    code: Extract<CommanderRunControlResponse, { accepted: false }>['code'],
  ): CommanderRunControlResult => ({
    response: {
      accepted: false,
      action: request.action,
      runId: request.runId,
      affectedRunIds: [],
      code,
    },
  });

  return {
    async dispatch(request) {
      const run = deps.runs.get(request.runId);
      if (!run) return reject(request, 'run_not_found');

      const runs = deps.runs.listRunHeadsForSession(run.sessionId);
      const subtree = collectSubtree(runs, run.id);
      const activeSubtree = subtree.filter((candidate) => isActive(candidate.status));

      if (request.action === 'retry') {
        if (isActive(run.status)) return reject(request, 'invalid_state');
        if (run.workType === 'tool_program') {
          return reject(request, 'invalid_state');
        }
        if (
          !run.parentRunId &&
          runs.some(
            (candidate) =>
              candidate.id !== run.id && !candidate.parentRunId && isActive(candidate.status),
          )
        ) {
          return reject(request, 'invalid_state');
        }
        const retryRunId = await deps.retryRun(run);
        if (!retryRunId) return reject(request, 'invalid_state');
        return {
          response: {
            accepted: true,
            action: request.action,
            runId: request.runId,
            affectedRunIds: [request.runId],
            retryRunId,
          },
        };
      }

      if (request.action === 'message') {
        if (!isActive(run.status)) return reject(request, 'invalid_state');
        const runtime = runningSessions.get(run.id)?.orchestrator;
        if (!runtime?.injectMessage) return reject(request, 'runtime_unavailable');
        runtime.injectMessage(request.message);
        return accepted(request, [run.id]);
      }

      if (request.action === 'cancel_step') {
        if (!isActive(run.status)) return reject(request, 'invalid_state');
        if (run.status === 'paused') return reject(request, 'invalid_state');
        const session = runningSessions.get(run.id);
        if (!session?.orchestrator?.cancelCurrentStep) {
          return reject(request, 'runtime_unavailable');
        }
        const result = session.orchestrator.cancelCurrentStep();
        if (result.escalated) session.aborted = true;
        return {
          ...accepted(request, [run.id]),
          cancelStepEscalated: result.escalated,
        };
      }

      if (activeSubtree.length === 0) return reject(request, 'invalid_state');
      const sessions = activeSubtree.map((candidate) => runningSessions.get(candidate.id));
      if (sessions.some((session) => !session?.orchestrator)) {
        return reject(request, 'runtime_unavailable');
      }

      if (request.action === 'pause') {
        if (activeSubtree.some((candidate) => candidate.status === 'paused')) {
          return reject(request, 'invalid_state');
        }
        const acceptedPause = sessions.every((session) => session!.orchestrator!.pause());
        return acceptedPause
          ? accepted(request, activeSubtree.map((candidate) => candidate.id))
          : reject(request, 'invalid_state');
      }

      if (request.action === 'resume') {
        if (activeSubtree.some((candidate) => candidate.status !== 'paused')) {
          return reject(request, 'invalid_state');
        }
        const acceptedResume = sessions.every((session) => session!.orchestrator!.resume());
        return acceptedResume
          ? accepted(request, activeSubtree.map((candidate) => candidate.id))
          : reject(request, 'invalid_state');
      }

      for (const session of sessions) {
        session!.aborted = true;
        session!.orchestrator!.cancel();
      }
      if (!run.parentRunId) {
        await cancelOwnedNonterminalTaskLists(deps.taskExecutionEngine, run.sessionId);
      }
      return accepted(request, activeSubtree.map((candidate) => candidate.id));
    },

    tree(request) {
      if (!request?.sessionId?.trim()) throw new Error('sessionId is required');
      return {
        sessionId: request.sessionId,
        runs: deps.runs
          .listRunHeadsForSession(request.sessionId)
          .map((run) => deps.toPublicRun(run)),
      };
    },
  };
}

export function registerCommanderRunControlHandlers(
  ipcMain: IpcMain,
  controller: CommanderRunController,
  recoveryReady: Promise<void> = Promise.resolve(),
): void {
  ipcMain.handle('commander:run:control', async (_event, request: unknown) => {
    await recoveryReady;
    const parsed = commanderRunControlChannel.schemas.request.parse(request);
    const response = (await controller.dispatch(parsed)).response;
    return commanderRunControlChannel.schemas.response.parse(response);
  });
  ipcMain.handle('commander:run:tree', async (_event, request: unknown) => {
    await recoveryReady;
    const parsed = commanderRunTreeChannel.schemas.request.parse(request);
    return commanderRunTreeChannel.schemas.response.parse(controller.tree(parsed));
  });

  ipcMain.handle('commander:cancel', async (_event, request: { runId: string }) => {
    await recoveryReady;
    requireRunId(request);
    await controller.dispatch({ runId: request.runId, action: 'cancel' });
  });
  ipcMain.handle('commander:cancel-step', async (_event, request: { runId: string }) => {
    await recoveryReady;
    requireRunId(request);
    const result = await controller.dispatch({ runId: request.runId, action: 'cancel_step' });
    return { escalated: result.cancelStepEscalated ?? false };
  });
  ipcMain.handle(
    'commander:inject-message',
    async (_event, request: { runId: string; message: string }) => {
      await recoveryReady;
      requireRunId(request);
      if (typeof request.message !== 'string' || !request.message.trim()) {
        throw new Error('message is required');
      }
      const result = await controller.dispatch({
        runId: request.runId,
        action: 'message',
        message: request.message,
      });
      if (!result.response.accepted) throw new Error('Commander has no active session');
    },
  );
}

function accepted(
  request: CommanderRunControlRequest,
  affectedRunIds: string[],
): CommanderRunControlResult {
  return {
    response: {
      accepted: true,
      action: request.action,
      runId: request.runId,
      affectedRunIds,
    },
  };
}

function isActive(status: CommanderRunRecord['status']): boolean {
  return status === 'accepted' || status === 'running' || status === 'paused';
}

function collectSubtree(runs: CommanderRunRecord[], rootId: string): CommanderRunRecord[] {
  const children = new Map<string, CommanderRunRecord[]>();
  for (const run of runs) {
    if (!run.parentRunId) continue;
    const siblings = children.get(run.parentRunId) ?? [];
    siblings.push(run);
    children.set(run.parentRunId, siblings);
  }
  const byId = new Map(runs.map((run) => [run.id, run]));
  const root = byId.get(rootId);
  if (!root) return [];
  const result: CommanderRunRecord[] = [];
  const pending = [root];
  while (pending.length > 0) {
    const current = pending.shift()!;
    result.push(current);
    pending.unshift(...(children.get(current.id) ?? []));
  }
  return result;
}

function requireRunId(request: { runId: string }): void {
  if (!request || typeof request.runId !== 'string' || !request.runId.trim()) {
    throw new Error('runId is required');
  }
}
