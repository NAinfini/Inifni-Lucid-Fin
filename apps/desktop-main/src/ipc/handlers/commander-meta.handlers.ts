import type { IpcMain } from 'electron';
import type { TaskExecutionEngine } from '@lucid-fin/application';
import { getCommanderSessionId } from '@lucid-fin/contracts';
import type { CommanderToolActionResponse } from '@lucid-fin/contracts';
import log from '../../logger.js';
import { runningSessions } from './commander-registry.js';

export function registerCommanderMetaHandlers(
  ipcMain: IpcMain,
  deps?: {
    taskExecutionEngine: TaskExecutionEngine;
    requestTaskContinuation?: (taskListId: string, reason: string) => void;
    recoveryReady?: Promise<void>;
  },
): void {
  const logger = log.scoped('commander', { surface: 'meta' });

  ipcMain.handle(
    'commander:tool:decision',
    async (
      _event,
      args: { runId: string; sessionId: string; toolCallId: string; approved: boolean },
    ): Promise<CommanderToolActionResponse> => {
      await deps?.recoveryReady;
      if (!args || typeof args.runId !== 'string' || !args.runId.trim())
        throw new Error('runId is required');
      if (typeof args.sessionId !== 'string' || !args.sessionId.trim())
        throw new Error('sessionId is required');
      if (typeof args.toolCallId !== 'string' || !args.toolCallId.trim())
        throw new Error('toolCallId is required');
      const session = runningSessions.get(args.runId);
      if (!session?.orchestrator?.confirmTool) {
        logger.warn('Commander tool decision received with no active session', {
          runId: args.runId,
          sessionId: args.sessionId,
          toolCallId: args.toolCallId,
          approved: !!args.approved,
        });
        return {
          accepted: false,
          code: hasActiveSession(args.sessionId) ? 'stale_run' : 'no_active_session',
        };
      }
      if (session.sessionId !== args.sessionId) {
        logger.warn('Commander tool decision received for a stale run', {
          runId: args.runId,
          sessionId: args.sessionId,
          activeSessionId: session.sessionId,
          toolCallId: args.toolCallId,
        });
        return { accepted: false, code: 'stale_run' };
      }
      logger.info('Commander tool decision received', {
        runId: args.runId,
        sessionId: args.sessionId,
        toolCallId: args.toolCallId,
        approved: !!args.approved,
      });
      return session.orchestrator.confirmTool(args.toolCallId, !!args.approved)
        ? { accepted: true, delivery: 'active_run' }
        : { accepted: false, code: 'not_pending' };
    },
  );

  ipcMain.handle(
    'commander:tool:answer',
    async (
      _event,
      args: { runId: string; sessionId: string; toolCallId: string; answer: string },
    ): Promise<CommanderToolActionResponse> => {
      await deps?.recoveryReady;
      if (!args || typeof args.runId !== 'string' || !args.runId.trim())
        throw new Error('runId is required');
      if (typeof args.sessionId !== 'string' || !args.sessionId.trim())
        throw new Error('sessionId is required');
      if (typeof args.toolCallId !== 'string' || !args.toolCallId.trim())
        throw new Error('toolCallId is required');
      if (typeof args.answer !== 'string') throw new Error('answer is required');
      const session = runningSessions.get(args.runId);
      if (!session && hasActiveSession(args.sessionId)) {
        logger.warn('Commander tool answer received for a stale run', {
          runId: args.runId,
          sessionId: args.sessionId,
          toolCallId: args.toolCallId,
          answerChars: args.answer.length,
        });
        return { accepted: false, code: 'stale_run' };
      }
      if (session && session.sessionId !== args.sessionId) {
        logger.warn('Commander tool answer received for a stale run', {
          runId: args.runId,
          sessionId: args.sessionId,
          activeSessionId: session.sessionId,
          toolCallId: args.toolCallId,
          answerChars: args.answer.length,
        });
        return { accepted: false, code: 'stale_run' };
      }
      const hasActiveRun = Boolean(session?.orchestrator);
      const hasPendingQuestion =
        session?.orchestrator?.hasPendingQuestion?.(args.toolCallId) ?? false;
      const matchingDecisions =
        deps?.taskExecutionEngine
          .listPendingDecisions()
          .filter((decision) => decision.questionId === args.toolCallId) ?? [];
      const ownedDecisions = matchingDecisions.filter(
        (decision) =>
          getCommanderSessionId(deps?.taskExecutionEngine.get(decision.taskListId)?.metadata) ===
          args.sessionId,
      );
      if (matchingDecisions.length > 0 && ownedDecisions.length !== 1) {
        logger.warn('Commander tool answer received for another session decision', {
          runId: args.runId,
          sessionId: args.sessionId,
          toolCallId: args.toolCallId,
        });
        return { accepted: false, code: 'stale_run' };
      }
      const durableDecision = ownedDecisions[0];
      if (!hasPendingQuestion && !durableDecision) {
        logger.warn(
          hasActiveRun
            ? 'Commander tool answer received for a question that is not pending'
            : 'Commander tool answer received with no active session',
          {
            runId: args.runId,
            sessionId: args.sessionId,
            toolCallId: args.toolCallId,
            answerChars: args.answer.length,
          },
        );
        return {
          accepted: false,
          code: hasActiveRun ? 'not_pending' : 'no_active_session',
        };
      }
      if (durableDecision && !hasActiveRun && !deps?.requestTaskContinuation) {
        return { accepted: false, code: 'no_active_session' };
      }
      const durable = durableDecision
        ? deps?.taskExecutionEngine.answerAskUserDecisionFromUser({
            canvasId: durableDecision.canvasId,
            questionId: args.toolCallId,
            answer: args.answer,
            status: 'answered',
          })
        : undefined;
      if (durable) {
        if (!durable.answered) {
          return { accepted: false, code: 'already_resolved' };
        }
        if (session?.orchestrator?.answerQuestion) {
          logger.info('Task decision answer persisted and resumed', {
            canvasId: durableDecision?.canvasId,
            runId: args.runId,
            sessionId: args.sessionId,
            taskListId: durable.decision.taskListId,
            questionId: args.toolCallId,
            answerChars: args.answer.length,
          });
          if (session.orchestrator.answerQuestion(args.toolCallId, args.answer)) {
            return {
              accepted: true,
              delivery: 'active_run',
              taskListId: durable.decision.taskListId,
            };
          }
          if (deps?.requestTaskContinuation) {
            deps.requestTaskContinuation(durable.decision.taskListId, 'durable-question-answered');
            return {
              accepted: true,
              delivery: 'task_list_continuation',
              taskListId: durable.decision.taskListId,
            };
          }
          return { accepted: false, code: 'not_pending' };
        } else if (deps?.requestTaskContinuation) {
          logger.info('Task decision answer persisted for a new Commander continuation', {
            canvasId: durableDecision?.canvasId,
            runId: args.runId,
            sessionId: args.sessionId,
            taskListId: durable.decision.taskListId,
            questionId: args.toolCallId,
            answerChars: args.answer.length,
          });
          deps.requestTaskContinuation(durable.decision.taskListId, 'durable-question-answered');
          return {
            accepted: true,
            delivery: 'task_list_continuation',
            taskListId: durable.decision.taskListId,
          };
        }
      }
      if (!session?.orchestrator?.answerQuestion) {
        logger.warn('Commander tool answer received with no active session', {
          runId: args.runId,
          sessionId: args.sessionId,
          toolCallId: args.toolCallId,
          answerChars: args.answer.length,
        });
        return { accepted: false, code: 'no_active_session' };
      }
      logger.info('Commander tool answer received', {
        runId: args.runId,
        sessionId: args.sessionId,
        toolCallId: args.toolCallId,
        answerChars: args.answer.length,
      });
      return session.orchestrator.answerQuestion(args.toolCallId, args.answer)
        ? { accepted: true, delivery: 'active_run' }
        : { accepted: false, code: 'not_pending' };
    },
  );

  ipcMain.handle('commander:compact', async (_event, args: { runId: string }) => {
    await deps?.recoveryReady;
    if (!args || typeof args.runId !== 'string' || !args.runId.trim()) {
      throw new Error('runId is required');
    }
    const session = runningSessions.get(args.runId);
    if (!session?.orchestrator?.compactNow) {
      // Normal race condition — compact requested after session ended. Silent no-op.
      return { freedChars: 0, messageCount: 0, toolCount: 0 };
    }
    const result = await session.orchestrator.compactNow();
    logger.info('Commander compact executed', {
      runId: args.runId,
      sessionId: session.sessionId,
      ...result,
    });
    return result;
  });
}

function hasActiveSession(sessionId: string): boolean {
  for (const session of runningSessions.values()) {
    if (session.sessionId === sessionId && session.orchestrator) return true;
  }
  return false;
}
