import { randomUUID } from 'node:crypto';
import log from '../../logger.js';
import type {
  TaskListCommanderContinuationConfig,
  TaskExecutionEngine,
} from '@lucid-fin/application';
import { getCommanderSessionId, isTaskListTerminalStatus } from '@lucid-fin/contracts';
import type {
  CommanderStartRequest,
  LLMProviderRuntimeConfig,
  TaskListId,
} from '@lucid-fin/contracts';
import type { SqliteIndex } from '@lucid-fin/storage';
import type { CanvasStore } from './canvas.handlers.js';
import { buildPersistentTaskListContext } from './commander-context.service.js';

const CONTINUATION_PASSES_PER_TASK = 4;
const MIN_CHAINED_CONTINUATIONS = 16;
const EXECUTABLE_PHASES = new Set([
  'production_plan_revision',
  'style_exploration',
  'preproduction',
  'media_generation',
  'assembly',
  'delivery_preparation',
]);

export interface CommanderTaskContinuationController {
  request(taskListId: string, reason: string): void;
  recoverPending(): void;
  recoverPendingVisualEvaluations(canvasId: string): void;
  recoverPendingMediaEvaluations(canvasId: string): void;
}

export function buildTaskListCommanderContinuation(
  args: CommanderStartRequest,
  sourceRunId?: string,
): TaskListCommanderContinuationConfig | undefined {
  const sessionId = cleanString(args.sessionId);
  const provider = args.customLLMProvider;
  if (!sessionId || !provider) return undefined;

  const defaultProviders = Object.fromEntries(
    Object.entries(args.defaultProviders ?? {}).flatMap(([kind, id]) => {
      const normalized = cleanString(id);
      return normalized && ['image', 'video', 'audio'].includes(kind) ? [[kind, normalized]] : [];
    }),
  );
  const safeProvider: LLMProviderRuntimeConfig = {
    id: provider.id,
    name: provider.name,
    baseUrl: provider.baseUrl,
    model: provider.model,
    protocol: provider.protocol,
    authStyle: provider.authStyle,
    ...(typeof provider.supportsModelOverride === 'boolean'
      ? { supportsModelOverride: provider.supportsModelOverride }
      : {}),
    ...(typeof provider.supportsReasoningEffort === 'boolean'
      ? { supportsReasoningEffort: provider.supportsReasoningEffort }
      : {}),
    ...(provider.reasoningEffortsByModel
      ? {
          reasoningEffortsByModel: Object.fromEntries(
            Object.entries(provider.reasoningEffortsByModel).map(([model, efforts]) => [
              model,
              [...efforts],
            ]),
          ),
        }
      : {}),
    ...(provider.reasoningEffort ? { reasoningEffort: provider.reasoningEffort } : {}),
    ...(provider.credentialMode ? { credentialMode: provider.credentialMode } : {}),
    ...(provider.oauthTarget
      ? {
          oauthTarget: {
            provider: provider.oauthTarget.provider,
            capability: provider.oauthTarget.capability,
          },
        }
      : {}),
    ...(typeof provider.supportsVision === 'boolean'
      ? { supportsVision: provider.supportsVision }
      : {}),
    ...(typeof provider.contextWindow === 'number' && Number.isFinite(provider.contextWindow)
      ? { contextWindow: provider.contextWindow }
      : {}),
  };
  return {
    version: 1,
    sessionId,
    provider: safeProvider,
    permissionMode: args.permissionMode ?? 'normal',
    ...(cleanString(args.locale) ? { locale: cleanString(args.locale) } : {}),
    ...(args.resourceBudget ? { resourceBudget: { ...args.resourceBudget } } : {}),
    ...(cleanString(sourceRunId) ? { lastRunId: cleanString(sourceRunId) } : {}),
    ...(typeof args.temperature === 'number' && Number.isFinite(args.temperature)
      ? { temperature: args.temperature }
      : {}),
    ...(positiveFinite(args.contextWindowTokens)
      ? { contextWindowTokens: args.contextWindowTokens }
      : {}),
    ...(positiveFinite(args.maxOutputTokens) ? { maxOutputTokens: args.maxOutputTokens } : {}),
    ...(Object.keys(defaultProviders).length > 0 ? { defaultProviders } : {}),
    ...(args.processSettings
      ? {
          processSettings: {
            ...(args.processSettings.qualityGateBehavior
              ? { qualityGateBehavior: args.processSettings.qualityGateBehavior }
              : {}),
            ...(typeof args.processSettings.requireStylePlateBeforeRefImage === 'boolean'
              ? {
                  requireStylePlateBeforeRefImage:
                    args.processSettings.requireStylePlateBeforeRefImage,
                }
              : {}),
          },
        }
      : {}),
  };
}

export function createCommanderTaskContinuationController(options: {
  taskExecutionEngine: TaskExecutionEngine;
  db: SqliteIndex;
  canvasStore: CanvasStore;
  isCanvasBusy: (canvasId: string) => boolean;
  runCommander: (args: CommanderStartRequest) => Promise<{ runId: string; succeeded: boolean }>;
  evaluatePendingVisualAudition?: (
    taskListId: string,
    canvasId: string,
  ) => Promise<'idle' | 'commander_required' | 'complete'>;
  evaluatePendingProductionMedia?: (
    taskListId: string,
    canvasId: string,
  ) => Promise<'idle' | 'pending' | 'commander_required' | 'progressed'>;
}): CommanderTaskContinuationController {
  const queued = new Set<string>();
  const claimOwnerId = randomUUID();
  let tail = Promise.resolve();

  const request = (taskListId: string, reason: string): void => {
    if (!taskListId || queued.has(taskListId)) return;
    queued.add(taskListId);
    tail = tail
      .catch(() => undefined)
      .then(async () => {
        try {
          await continueTaskList(taskListId, reason);
        } catch (error) {
          log.error('Commander Task List continuation failed', {
            category: 'task-list',
            taskListId,
            reason,
            error: error instanceof Error ? error.message : String(error),
          });
        } finally {
          queued.delete(taskListId);
        }
      });
  };

  const continueTaskList = async (taskListId: string, reason: string): Promise<void> => {
    await options.taskExecutionEngine.waitForAutoPump();
    for (let index = 0; ; index += 1) {
      const taskList = options.taskExecutionEngine.get(taskListId);
      if (
        !taskList ||
        taskList.taskListType !== 'movie.production.v2' ||
        taskList.entityType !== 'canvas' ||
        !taskList.entityId ||
        taskList.currentGate ||
        taskList.status === 'paused' ||
        isTaskListTerminalStatus(taskList.status) ||
        !taskList.currentTaskId
      ) {
        return;
      }
      const maxContinuations = maxChainedContinuations(taskList.totalTasks);
      if (index >= maxContinuations) {
        log.warn('Commander Task List continuation reached its chain bound', {
          category: 'task-list',
          taskListId,
          maxContinuations,
        });
        return;
      }
      const canvasId = taskList.entityId;
      const commanderSessionId = getCommanderSessionId(taskList.metadata);
      if (!commanderSessionId) return;
      if (!options.canvasStore.get(canvasId) || options.isCanvasBusy(canvasId)) return;
      const evaluationOutcome = await options.evaluatePendingVisualAudition?.(taskListId, canvasId);
      if (evaluationOutcome === 'complete') return;
      const mediaEvaluationOutcome = await options.evaluatePendingProductionMedia?.(
        taskListId,
        canvasId,
      );
      if (mediaEvaluationOutcome === 'pending') return;
      if (mediaEvaluationOutcome === 'progressed') continue;
      const task = options.taskExecutionEngine
        .getTasks(taskListId)
        .find((candidate) => candidate.id === taskList.currentTaskId);
      if (!task || task.status !== 'ready' || task.input.executionMode !== 'external') {
        return;
      }

      const policy = buildPersistentTaskListContext(
        options.db,
        canvasId,
        commanderSessionId,
      ).taskListToolPolicy;
      if (!policy || policy.taskListId !== taskListId || !EXECUTABLE_PHASES.has(policy.phase)) {
        return;
      }
      const claimKey = `${task.id}:${policy.phase}:${policy.subjectRevision ?? 0}`;
      const claimed = options.taskExecutionEngine.claimCommanderContinuation({
        taskListId,
        taskId: task.id,
        claimKey,
        claimOwnerId,
        expectedRowVersion: taskList.rowVersion ?? 0,
      });
      if (!claimed.ok) return;
      if (claimed.continuation.sessionId !== commanderSessionId) {
        log.error('Commander Task List continuation session binding changed unexpectedly', {
          category: 'task-list',
          taskListId,
          canvasId,
        });
        return;
      }

      log.info('Commander Task List continuation started', {
        category: 'task-list',
        taskListId,
        canvasId,
        taskId: task.id,
        taskRole: task.input.taskRole,
        phase: policy.phase,
        reason,
      });
      const commanderRun = await options.runCommander({
        defaultCanvasId: canvasId,
        authorizedCanvasIds: [canvasId],
        sessionId: claimed.continuation.sessionId,
        intent: { kind: 'user_message', message: continuationMessage() },
        selectedNodes: [],
        promptGuides: [],
        customLLMProvider: claimed.continuation.provider,
        permissionMode: claimed.continuation.permissionMode,
        ...(claimed.continuation.locale ? { locale: claimed.continuation.locale } : {}),
        ...(claimed.continuation.resourceBudget
          ? { resourceBudget: { ...claimed.continuation.resourceBudget } }
          : {}),
        ...(claimed.continuation.lastRunId
          ? { continuationOfRunId: claimed.continuation.lastRunId }
          : {}),
        ...(claimed.continuation.temperature !== undefined
          ? { temperature: claimed.continuation.temperature }
          : {}),
        ...(claimed.continuation.contextWindowTokens !== undefined
          ? { contextWindowTokens: claimed.continuation.contextWindowTokens }
          : {}),
        ...(claimed.continuation.maxOutputTokens !== undefined
          ? { maxOutputTokens: claimed.continuation.maxOutputTokens }
          : {}),
        ...(claimed.continuation.defaultProviders
          ? { defaultProviders: claimed.continuation.defaultProviders }
          : {}),
        ...(claimed.continuation.processSettings
          ? { processSettings: claimed.continuation.processSettings }
          : {}),
      });
      await options.taskExecutionEngine.waitForAutoPump();

      const nextTaskList = options.taskExecutionEngine.get(taskListId);
      if (!nextTaskList) return;
      const nextTask = options.taskExecutionEngine
        .getTasks(taskListId)
        .find((candidate) => candidate.id === nextTaskList.currentTaskId);
      const taskProgressed =
        Boolean(nextTaskList.currentGate) ||
        isTaskListTerminalStatus(nextTaskList.status) ||
        nextTaskList.currentTaskId !== task.id ||
        nextTask?.status !== 'ready';
      const yieldedForVisualEvaluation =
        commanderRun.succeeded &&
        !taskProgressed &&
        Boolean(options.evaluatePendingVisualAudition) &&
        hasPendingVisualEvaluation(options.taskExecutionEngine, taskListId);
      const outcome = taskProgressed ? 'completed' : 'failed';
      const outcomeReason = !commanderRun.succeeded
        ? 'Commander run failed before the continuation could finish cleanly.'
        : yieldedForVisualEvaluation
          ? 'Commander yielded at a durable visual evaluation boundary.'
          : !taskProgressed
            ? 'Commander run ended before the durable current task was completed.'
            : undefined;
      const finished = options.taskExecutionEngine.finishCommanderContinuationClaim({
        taskListId,
        claimKey,
        claimOwnerId,
        expectedRowVersion: nextTaskList.rowVersion ?? 0,
        outcome,
        runId: commanderRun.runId,
        ...(outcomeReason ? { reason: outcomeReason } : {}),
      });
      if (!finished) {
        log.warn('Commander Task List continuation claim could not be finalized', {
          category: 'task-list',
          taskListId,
          taskId: task.id,
          claimKey,
        });
        return;
      }
      if (yieldedForVisualEvaluation) continue;
      if (!commanderRun.succeeded || !taskProgressed) {
        log.error('Commander Task List continuation stopped before task completion', {
          category: 'task-list',
          taskListId,
          taskId: task.id,
          reason: outcomeReason,
        });
        return;
      }
      if (nextTaskList.currentGate || isTaskListTerminalStatus(nextTaskList.status)) {
        return;
      }
    }
  };

  return {
    request,
    recoverPending() {
      for (const taskList of options.taskExecutionEngine.list({
        taskListType: 'movie.production.v2',
        entityType: 'canvas',
      })) {
        request(taskList.id, 'application-recovery');
      }
    },
    recoverPendingVisualEvaluations(canvasId) {
      for (const taskList of options.taskExecutionEngine.list({
        taskListType: 'movie.production.v2',
        entityType: 'canvas',
      })) {
        if (
          taskList.entityId === canvasId &&
          hasPendingVisualEvaluation(options.taskExecutionEngine, taskList.id)
        ) {
          request(taskList.id, 'style-audition-evaluation-pending');
        }
      }
    },
    recoverPendingMediaEvaluations(canvasId) {
      for (const taskList of options.taskExecutionEngine.list({
        taskListType: 'movie.production.v2',
        entityType: 'canvas',
      })) {
        if (
          taskList.entityId === canvasId &&
          hasPendingProductionMediaEvaluation(options.db, taskList.id)
        ) {
          request(taskList.id, 'production-media-evaluation-pending');
        }
      }
    },
  };
}

function hasPendingProductionMediaEvaluation(db: SqliteIndex, taskListId: string): boolean {
  return db.repos.taskLists
    .listProductionMediaAttempts(taskListId as TaskListId)
    .some((attempt) => attempt.status === 'asset_ready' || attempt.status === 'evaluating');
}

function hasPendingVisualEvaluation(
  taskExecutionEngine: TaskExecutionEngine,
  taskListId: string,
): boolean {
  const document = taskExecutionEngine.getLatestVisualAudition(taskListId);
  const content = document?.content as
    | {
        status?: unknown;
        candidates?: Array<{
          status?: unknown;
          attempts?: Array<{ status?: unknown; assetHash?: unknown; grade?: unknown }>;
        }>;
      }
    | undefined;
  return (
    content?.status === 'evaluation_pending' &&
    Boolean(
      content.candidates?.some(
        (candidate) =>
          candidate.status === 'evaluation_pending' &&
          candidate.attempts?.some(
            (attempt) =>
              attempt.status === 'evaluation_pending' &&
              typeof attempt.assetHash === 'string' &&
              !attempt.grade,
          ),
      ),
    )
  );
}

function continuationMessage(): string {
  return 'Continue the active persistent movie Task List. Complete only the current durable task described by the SQLite task contract, persist every required evidence item through the named tools, and then stop. Use tool.get when you need schema details. Stop immediately at a human gate, durable question, paused/recovery state, or terminal state. Never treat chat text as approval.';
}

function maxChainedContinuations(totalTasks: number): number {
  const taskCount = Number.isSafeInteger(totalTasks) && totalTasks > 0 ? totalTasks : 1;
  return Math.max(MIN_CHAINED_CONTINUATIONS, taskCount * CONTINUATION_PASSES_PER_TASK);
}

function cleanString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function positiveFinite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}
