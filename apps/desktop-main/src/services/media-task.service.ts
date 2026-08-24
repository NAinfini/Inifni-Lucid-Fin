import { getCommanderSessionId } from '@lucid-fin/contracts';
import type {
  ProductionMediaTaskAttempt,
  PromptAssemblyOutputV1,
  PromptAssemblyRecord,
  Task,
  TaskArtifact,
  TaskEvaluation,
  TaskList,
  TaskListId,
} from '@lucid-fin/contracts';
import type { TaskExecutionEngine } from '@lucid-fin/application';
import type { SqliteIndex } from '@lucid-fin/storage';
import type { ProviderConfigOverride } from '../ipc/handlers/generation-types.js';
import type { CanvasStore } from '../ipc/handlers/canvas.handlers.js';
import log from '../logger.js';
import type { MediaEvaluationService } from './media-evaluation.service.js';
import { PRODUCTION_MEDIA_RUBRIC_VERSION } from './media-evaluation.service.js';
import type { MediaGenerationService } from './media-generation.service.js';
import type { PromptAssemblyService } from './prompt-assembly.service.js';

export interface StartMediaTaskInput {
  canvasId: string;
  nodeId: string;
  commanderSessionId: string;
  providerId?: string;
  providerConfig?: ProviderConfigOverride;
  seed?: number;
  commanderIntent?: string;
  parentAttemptId?: string;
  feedback?: string;
}

export interface SubmitMediaPromptInput {
  taskListId: string;
  promptAssemblyId: string;
  promptAssemblyOutput: PromptAssemblyOutputV1;
}

export interface MediaTaskView extends Record<string, unknown> {
  id: string;
  canvasId: string;
  nodeId: string;
  status: TaskList['status'];
  taskStatus: Task['status'];
  progress: number;
  currentStep?: string;
  error?: string;
  promptAssembly?: PromptAssemblyRecord;
  attempt?: ProductionMediaTaskAttempt;
  evaluation?: TaskEvaluation;
  artifact?: TaskArtifact;
  createdAt: number;
  updatedAt: number;
}

export interface MediaTaskService {
  start(input: StartMediaTaskInput): Promise<MediaTaskView>;
  list(canvasId?: string): MediaTaskView[];
  get(taskListId: string): MediaTaskView;
  submitPrompt(
    input: SubmitMediaPromptInput,
    author: { providerId: string; model?: string },
  ): Promise<MediaTaskView>;
  /** Retry only the visual evaluation; the provider submission is never repeated. */
  retryEvaluation(taskListId: string, commanderSessionId: string): Promise<MediaTaskView>;
  cancel(taskListId: string): Promise<MediaTaskView>;
  cancelForNode(
    canvasId: string,
    nodeId: string,
    commanderSessionId: string,
  ): Promise<MediaTaskView | null>;
  retryForNode(
    canvasId: string,
    nodeId: string,
    commanderSessionId: string,
    providerId?: string,
  ): Promise<MediaTaskView>;
  resumePending(): void;
  stop(): void;
}

export function createMediaTaskService(deps: {
  db: SqliteIndex;
  canvasStore: CanvasStore;
  taskExecutionEngine: TaskExecutionEngine;
  promptAssemblyService: PromptAssemblyService;
  mediaGenerationService: Pick<MediaGenerationService, 'cancel'>;
  mediaEvaluationService: Pick<MediaEvaluationService, 'evaluate'>;
  pollIntervalMs?: number;
}): MediaTaskService {
  const activeTaskListIds = new Set<string>();
  const pollIntervalMs = deps.pollIntervalMs ?? 3_000;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;

  const get = (taskListId: string): MediaTaskView => projectMediaTask(deps, taskListId);
  const isTerminal = (view: MediaTaskView): boolean =>
    ['completed', 'completed_with_errors', 'failed', 'cancelled', 'dead'].includes(view.status);

  const schedule = (taskListId: string): void => {
    if (stopped) return;
    activeTaskListIds.add(taskListId);
    if (timer) return;
    timer = setTimeout(() => {
      timer = undefined;
      void poll();
    }, pollIntervalMs);
  };

  const evaluateReadyAttempt = async (
    view: MediaTaskView,
  ): Promise<{ view: MediaTaskView; pending: boolean }> => {
    if (!view.attempt || (view.attempt.status !== 'asset_ready' && view.attempt.status !== 'evaluating')) {
      return { view, pending: false };
    }
    const canvas = deps.canvasStore.get(view.canvasId);
    const node = canvas?.nodes.find((candidate) => candidate.id === view.nodeId);
    const task = deps.taskExecutionEngine.getTasks(view.id)[0];
    const taskList = deps.taskExecutionEngine.get(view.id);
    if (!canvas || !node || !task || !taskList) {
      throw new Error('Media Task List lost its Canvas or Task binding before evaluation');
    }
    const evaluation = await deps.mediaEvaluationService.evaluate({
      attempt: view.attempt,
      productionPlan: {
        intent: optionalString(task.input.commanderIntent) ?? node.title,
      },
      visualConstitution: {
        canvasSettings: canvas.settings,
      },
      rubricVersion: PRODUCTION_MEDIA_RUBRIC_VERSION,
      validateAuthority: (attempt) =>
        attempt.scope === 'canvas' &&
        attempt.taskListId === taskList.id &&
        attempt.taskId === task.id &&
        attempt.generationSpec.authority.kind === 'task-list',
      validateNodeRevision: (attempt) => node.updatedAt === attempt.generationSpec.nodeUpdatedAt,
      getVerdictBounds: () => ({ canRetry: false, budgetExceeded: false }),
    });
    if (evaluation.status === 'evaluation_pending') {
      return { view: get(view.id), pending: true };
    }
    await deps.taskExecutionEngine.recover(view.id);
    return { view: get(view.id), pending: false };
  };

  const poll = async (): Promise<void> => {
    for (const taskListId of [...activeTaskListIds]) {
      try {
        await deps.taskExecutionEngine.recover(taskListId);
        let view = get(taskListId);
        if (view.attempt?.status === 'asset_ready' || view.attempt?.status === 'evaluating') {
          const evaluated = await evaluateReadyAttempt(view);
          view = evaluated.view;
          if (evaluated.pending) {
            activeTaskListIds.delete(taskListId);
            continue;
          }
        }
        if (isTerminal(view) || view.promptAssembly?.status === 'prepared') {
          activeTaskListIds.delete(taskListId);
        }
      } catch (error) {
        activeTaskListIds.delete(taskListId);
        log.error('Media Task List background recovery failed', {
          category: 'media-task',
          taskListId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    const next = activeTaskListIds.values().next();
    if (!next.done) schedule(next.value);
  };

  const service: MediaTaskService = {
    async start(input) {
      const canvasId = requiredString(input.canvasId, 'canvasId');
      const nodeId = requiredString(input.nodeId, 'nodeId');
      const commanderSessionId = requiredString(input.commanderSessionId, 'commanderSessionId');
      const canvas = deps.canvasStore.get(canvasId);
      const node = canvas?.nodes.find((candidate) => candidate.id === nodeId);
      if (!canvas || !node) throw new Error('Canvas media node not found');
      if (node.type !== 'image' && node.type !== 'video' && node.type !== 'backdrop') {
        throw new Error('media.generation.v1 supports image and video nodes only');
      }
      if (input.seed !== undefined && !Number.isInteger(input.seed)) {
        throw new Error('seed must be an integer');
      }
      if (input.providerConfig?.apiKey) {
        throw new Error('Inline API keys cannot be persisted; configure this provider in Settings');
      }
      if (
        input.providerConfig &&
        (!optionalString(input.providerConfig.baseUrl) ||
          !optionalString(input.providerConfig.model))
      ) {
        throw new Error('Custom media providers require both baseUrl and model');
      }
      if (
        (optionalString(input.parentAttemptId) && !optionalString(input.feedback)) ||
        (!optionalString(input.parentAttemptId) && optionalString(input.feedback))
      ) {
        throw new Error('parentAttemptId and feedback are required together for refinement');
      }

      const active = findActiveEquivalent(deps, input);
      if (active) return get(active.id);
      const taskListId = deps.taskExecutionEngine.start({
        taskListType: 'media.generation.v1',
        entityType: 'canvas',
        entityId: canvasId,
        triggerSource: 'commander',
        input: {
          nodeId,
          ...(optionalString(input.providerId) ? { providerId: optionalString(input.providerId) } : {}),
          ...(input.providerConfig ? { providerConfig: input.providerConfig } : {}),
          ...(input.seed !== undefined ? { seed: input.seed } : {}),
          ...(optionalString(input.commanderIntent)
            ? { commanderIntent: optionalString(input.commanderIntent) }
            : {}),
          ...(optionalString(input.parentAttemptId)
            ? {
                parentAttemptId: optionalString(input.parentAttemptId),
                feedback: optionalString(input.feedback),
              }
            : {}),
        },
        metadata: {
          commanderSessionId,
          displayCategory: 'Media',
          displayLabel: `Generate ${node.title}`,
          relatedEntityType: 'canvas-node',
          relatedEntityId: node.id,
          relatedEntityLabel: node.title,
        },
      });
      await deps.taskExecutionEngine.waitForAutoPump();
      return get(taskListId);
    },

    list(canvasId) {
      return deps.taskExecutionEngine
        .list({ taskListType: 'media.generation.v1', entityType: 'canvas' })
        .filter((taskList) => !canvasId || taskList.entityId === canvasId)
        .map((taskList) => get(taskList.id));
    },

    get,

    async submitPrompt(input, author) {
      const view = get(input.taskListId);
      const assembly = deps.promptAssemblyService.get(input.promptAssemblyId);
      if (!assembly) throw new Error('Prompt Assembly is not bound to this media Task List');
      const authority = assembly.input.authority;
      if (
        authority.kind !== 'task-list' ||
        authority.taskListId !== view.id ||
        !deps.taskExecutionEngine
          .getTasks(view.id)
          .some((task) => task.id === authority.taskId)
      ) {
        throw new Error('Prompt Assembly is not bound to this media Task List');
      }
      deps.promptAssemblyService.submitCommanderOutput(
        input.promptAssemblyId,
        input.promptAssemblyOutput,
        author,
      );
      await deps.taskExecutionEngine.recover(view.id);
      const result = get(view.id);
      if (!isTerminal(result)) schedule(view.id);
      return result;
    },

    async cancel(taskListId) {
      const view = get(taskListId);
      if (view.attempt && !isAttemptTerminal(view.attempt)) {
        await deps.mediaGenerationService.cancel(view.attempt.id);
      }
      await deps.taskExecutionEngine.cancel(view.id);
      activeTaskListIds.delete(view.id);
      return get(view.id);
    },

    async cancelForNode(canvasId, nodeId, commanderSessionId) {
      const sessionId = requiredString(commanderSessionId, 'commanderSessionId');
      const matches = service
        .list(canvasId)
        .filter(
          (view) =>
            view.nodeId === nodeId &&
            getCommanderSessionId(deps.taskExecutionEngine.get(view.id)?.metadata ?? {}) === sessionId,
        )
        .sort((left, right) => right.updatedAt - left.updatedAt);
      const active = matches.find((view) => !isTerminal(view));
      if (active) return service.cancel(active.id);
      return matches[0]?.status === 'cancelled' ? matches[0] : null;
    },

    async retryForNode(canvasId, nodeId, commanderSessionId, providerId) {
      const sessionId = requiredString(commanderSessionId, 'commanderSessionId');
      const previous = service
        .list(canvasId)
        .filter(
          (view) =>
            view.nodeId === nodeId &&
            view.attempt?.status === 'failed' &&
            getCommanderSessionId(deps.taskExecutionEngine.get(view.id)?.metadata ?? {}) === sessionId,
        )
        .sort((left, right) => right.updatedAt - left.updatedAt)[0];
      if (!previous?.attempt) {
        throw new Error('Media Task List has no definitively failed attempt to retry');
      }
      return service.start({
        canvasId,
        nodeId,
        commanderSessionId: sessionId,
        providerId: providerId ?? previous.attempt.providerId,
        parentAttemptId: previous.attempt.id,
        feedback: 'Retry the same creative request after the failed provider attempt.',
        commanderIntent: 'Retry the failed media request without changing its creative intent.',
      });
    },

    async retryEvaluation(taskListId, commanderSessionId) {
      const taskList = deps.taskExecutionEngine.get(taskListId);
      if (
        getCommanderSessionId(taskList?.metadata ?? {}) !==
        requiredString(commanderSessionId, 'commanderSessionId')
      ) {
        throw new Error('Media Task List is not bound to the current Commander session');
      }
      const view = get(taskListId);
      if (!view.attempt || (view.attempt.status !== 'asset_ready' && view.attempt.status !== 'evaluating')) {
        throw new Error('Media Task List has no pending visual evaluation');
      }
      activeTaskListIds.delete(view.id);
      return (await evaluateReadyAttempt(view)).view;
    },

    resumePending() {
      stopped = false;
      for (const taskList of deps.taskExecutionEngine.list({
        taskListType: 'media.generation.v1',
        entityType: 'canvas',
      })) {
        const view = get(taskList.id);
        if (!isTerminal(view) && view.promptAssembly?.status !== 'prepared') schedule(view.id);
      }
    },

    stop() {
      stopped = true;
      activeTaskListIds.clear();
      if (timer) clearTimeout(timer);
      timer = undefined;
    },
  };
  return service;
}

function projectMediaTask(
  deps: {
    db: SqliteIndex;
    taskExecutionEngine: TaskExecutionEngine;
    promptAssemblyService: PromptAssemblyService;
  },
  taskListId: string,
): MediaTaskView {
  const taskList = deps.taskExecutionEngine.get(taskListId);
  if (!taskList || taskList.taskListType !== 'media.generation.v1' || !taskList.entityId) {
    throw new Error(`Media Task List not found: ${taskListId}`);
  }
  const task = deps.taskExecutionEngine.getTasks(taskList.id)[0];
  if (!task) throw new Error(`Media Task List ${taskList.id} has no task`);
  const nodeId = requiredString(task.input.nodeId, 'stored nodeId');
  const attempt = deps.db.repos.taskLists.getLatestProductionMediaAttempt(
    taskList.id as TaskListId,
    nodeId,
  );
  const assemblyId =
    attempt?.promptAssemblyId ?? optionalString(task.output.promptAssemblyId);
  const evaluation = attempt
    ? deps.db.repos.taskLists.getTaskEvaluation(attempt.id)
    : undefined;
  const artifact = attempt
    ? deps.db.repos.taskLists.getArtifactByAttempt(attempt.id, 'media_output')
    : undefined;
  return {
    id: taskList.id,
    canvasId: taskList.entityId,
    nodeId,
    status: taskList.status,
    taskStatus: task.status,
    progress: task.progress,
    ...(task.currentStep ? { currentStep: task.currentStep } : {}),
    ...(task.error ? { error: task.error } : {}),
    ...(assemblyId ? { promptAssembly: deps.promptAssemblyService.get(assemblyId) } : {}),
    ...(attempt ? { attempt } : {}),
    ...(evaluation ? { evaluation } : {}),
    ...(artifact ? { artifact } : {}),
    createdAt: taskList.createdAt,
    updatedAt: taskList.updatedAt,
  };
}

function findActiveEquivalent(
  deps: { taskExecutionEngine: TaskExecutionEngine },
  input: StartMediaTaskInput,
): TaskList | undefined {
  const activeStatuses = new Set(['pending', 'ready', 'running', 'awaiting_provider']);
  return deps.taskExecutionEngine
    .list({ taskListType: 'media.generation.v1', entityType: 'canvas' })
    .find((taskList) => {
      if (taskList.entityId !== input.canvasId || !activeStatuses.has(taskList.status)) return false;
      if (getCommanderSessionId(taskList.metadata) !== input.commanderSessionId) return false;
      const task = deps.taskExecutionEngine.getTasks(taskList.id)[0];
      return (
        task?.input.nodeId === input.nodeId &&
        optionalString(task.input.providerId) === optionalString(input.providerId) &&
        optionalString(task.input.parentAttemptId) === optionalString(input.parentAttemptId) &&
        optionalString(task.input.feedback) === optionalString(input.feedback)
      );
    });
}

function isAttemptTerminal(attempt: ProductionMediaTaskAttempt): boolean {
  return [
    'accepted',
    'repair_required',
    'regenerate_required',
    'human_review',
    'failed',
    'ambiguous',
    'cancelled',
  ].includes(attempt.status);
}

function requiredString(value: unknown, field: string): string {
  const normalized = optionalString(value);
  if (!normalized) throw new Error(`${field} is required`);
  return normalized;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
