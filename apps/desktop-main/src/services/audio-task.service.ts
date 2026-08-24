import type {
  AudioTaskSubtype,
  AudioTaskView,
  PromptAssemblyOutputV1,
  TaskArtifact,
  TaskExecutionAttempt,
} from '@lucid-fin/contracts';
import type { TaskExecutionEngine } from '@lucid-fin/application';
import type { SqliteIndex } from '@lucid-fin/storage';
import { parseTaskId } from '@lucid-fin/contracts-parse';
import type { ProviderConfigOverride } from '../ipc/handlers/generation-types.js';
import type { PromptAssemblyService } from './prompt-assembly.service.js';
import log from '../logger.js';

export interface StartAudioTaskInput {
  canvasId: string;
  commanderSessionId: string;
  subtype: AudioTaskSubtype;
  prompt: string;
  providerId: string;
  model?: string;
  duration?: number;
  params?: Record<string, unknown>;
  providerConfig?: ProviderConfigOverride;
}

export interface SubmitAudioPromptInput {
  taskListId: string;
  promptAssemblyId: string;
  promptAssemblyOutput: PromptAssemblyOutputV1;
}

export interface AudioTaskService {
  start(input: StartAudioTaskInput): Promise<AudioTaskView>;
  list(canvasId?: string): AudioTaskView[];
  get(taskListId: string): AudioTaskView;
  submitPrompt(
    input: SubmitAudioPromptInput,
    author: { providerId: string; model?: string },
  ): Promise<AudioTaskView>;
  retry(taskListId: string): Promise<AudioTaskView>;
  resumePending(): void;
  stop(): void;
}

export function createAudioTaskService(deps: {
  db: SqliteIndex;
  taskExecutionEngine: TaskExecutionEngine;
  promptAssemblyService: PromptAssemblyService;
  pollIntervalMs?: number;
}): AudioTaskService {
  const get = (taskListId: string): AudioTaskView => projectAudioTask(deps, taskListId);
  const activeTaskListIds = new Set<string>();
  const pollIntervalMs = deps.pollIntervalMs ?? 3_000;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;

  const isTerminal = (view: AudioTaskView): boolean =>
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

  const poll = async (): Promise<void> => {
    for (const taskListId of [...activeTaskListIds]) {
      try {
        await deps.taskExecutionEngine.recover(taskListId);
        const view = get(taskListId);
        if (isTerminal(view) || view.promptAssembly?.status === 'prepared') {
          activeTaskListIds.delete(taskListId);
        }
      } catch (error) {
        activeTaskListIds.delete(taskListId);
        log.error('Audio Task List provider poll failed', {
          category: 'audio-task',
          taskListId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    const next = activeTaskListIds.values().next();
    if (!next.done) schedule(next.value);
  };

  return {
    async start(input) {
      const canvasId = requireString(input.canvasId, 'canvasId');
      const commanderSessionId = requireString(input.commanderSessionId, 'commanderSessionId');
      const providerId = requireString(input.providerId, 'providerId');
      const prompt = requireString(input.prompt, 'prompt');
      if (!['voice', 'music', 'sfx'].includes(input.subtype)) {
        throw new Error('subtype must be voice, music, or sfx');
      }
      if (input.duration !== undefined && (!Number.isFinite(input.duration) || input.duration <= 0)) {
        throw new Error('duration must be a positive number');
      }
      const taskListId = deps.taskExecutionEngine.start({
        taskListType: 'audio.production.v1',
        entityType: 'canvas',
        entityId: canvasId,
        triggerSource: 'commander',
        input: {
          subtype: input.subtype,
          prompt,
          providerId,
          ...(input.model ? { model: input.model } : {}),
          ...(input.duration !== undefined ? { duration: input.duration } : {}),
          ...(input.params ? { params: input.params } : {}),
          ...(input.providerConfig ? { providerConfig: input.providerConfig } : {}),
        },
        metadata: {
          commanderSessionId,
          displayCategory: 'Audio',
          displayLabel: `${input.subtype}: ${prompt.slice(0, 60)}`,
          relatedEntityLabel: prompt.slice(0, 100),
        },
      });
      await deps.taskExecutionEngine.waitForAutoPump();
      return get(taskListId);
    },

    list(canvasId) {
      return deps.taskExecutionEngine
        .list({ taskListType: 'audio.production.v1', entityType: 'canvas' })
        .filter((taskList) => !canvasId || taskList.entityId === canvasId)
        .map((taskList) => get(taskList.id));
    },

    get,

    async submitPrompt(input, author) {
      const view = get(input.taskListId);
      const assembly = deps.promptAssemblyService.get(input.promptAssemblyId);
      if (!assembly) {
        throw new Error('Prompt Assembly is not bound to this audio Task List');
      }
      const authority = assembly.input.authority;
      if (authority.kind !== 'task-list' || authority.taskListId !== view.id) {
        throw new Error('Prompt Assembly is not bound to this audio Task List');
      }
      const task = deps.taskExecutionEngine
        .getTasks(view.id)
        .find((candidate) => candidate.id === authority.taskId);
      if (!task || task.taskListId !== view.id) {
        throw new Error('Prompt Assembly task binding is stale');
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

    async retry(taskListId) {
      const view = get(taskListId);
      await deps.taskExecutionEngine.retryTaskList(view.id);
      await deps.taskExecutionEngine.pump(view.id);
      const result = get(view.id);
      if (!isTerminal(result) && result.promptAssembly?.status !== 'prepared') schedule(view.id);
      return result;
    },

    resumePending() {
      stopped = false;
      for (const taskList of deps.taskExecutionEngine.list({
        taskListType: 'audio.production.v1',
        entityType: 'canvas',
      })) {
        const view = get(taskList.id);
        if (!isTerminal(view) && view.promptAssembly?.status !== 'prepared') {
          schedule(view.id);
        }
      }
    },

    stop() {
      stopped = true;
      activeTaskListIds.clear();
      if (timer) clearTimeout(timer);
      timer = undefined;
    },
  };
}

function projectAudioTask(
  deps: {
    db: SqliteIndex;
    taskExecutionEngine: TaskExecutionEngine;
    promptAssemblyService: PromptAssemblyService;
  },
  taskListId: string,
): AudioTaskView {
  const taskList = deps.taskExecutionEngine.get(taskListId);
  if (!taskList || taskList.taskListType !== 'audio.production.v1' || !taskList.entityId) {
    throw new Error(`Audio Task List not found: ${taskListId}`);
  }
  const task = deps.taskExecutionEngine.getTasks(taskList.id)[0];
  if (!task) throw new Error(`Audio Task List ${taskList.id} has no task`);
  const subtype = task.input.subtype;
  if (subtype !== 'voice' && subtype !== 'music' && subtype !== 'sfx') {
    throw new Error(`Audio Task List ${taskList.id} has an invalid subtype`);
  }
  const prompt = requireString(task.input.prompt, 'stored prompt');
  const providerId = requireString(task.input.providerId, 'stored providerId');
  const attempt = deps.db.repos.taskLists
    .listTaskAttempts(parseTaskId(task.id))
    .at(-1);
  const assemblyId = attempt ? optionalString(attempt.metadata.promptAssemblyId) : undefined;
  const artifact = selectAudioArtifact(
    deps.db.repos.taskLists.listArtifactsByTask(parseTaskId(task.id)),
  );
  return {
    id: taskList.id,
    canvasId: taskList.entityId,
    subtype,
    prompt,
    providerId,
    status: taskList.status,
    taskStatus: task.status,
    progress: task.progress,
    ...(task.currentStep ? { currentStep: task.currentStep } : {}),
    ...(task.error ? { error: task.error } : {}),
    ...(attempt ? { attempt: projectAttempt(attempt) } : {}),
    ...(assemblyId
      ? { promptAssembly: deps.promptAssemblyService.get(assemblyId) }
      : {}),
    ...(artifact ? { artifact } : {}),
    createdAt: taskList.createdAt,
    updatedAt: taskList.updatedAt,
  };
}

function projectAttempt(attempt: TaskExecutionAttempt): NonNullable<AudioTaskView['attempt']> {
  return {
    id: attempt.id,
    status: attempt.status,
    ...(attempt.providerJobId ? { providerJobId: attempt.providerJobId } : {}),
    ...(attempt.assetHash ? { assetHash: attempt.assetHash } : {}),
    ...(attempt.error ? { error: attempt.error } : {}),
    createdAt: attempt.createdAt,
    updatedAt: attempt.updatedAt,
  };
}

function selectAudioArtifact(
  artifacts: TaskArtifact[],
): AudioTaskView['artifact'] | undefined {
  const artifact = [...artifacts].reverse().find((candidate) => candidate.artifactType === 'audio');
  const assetEntryId = optionalString(artifact?.metadata.assetEntryId);
  const format = optionalString(artifact?.metadata.format);
  if (!artifact?.assetHash || !assetEntryId || !format) return undefined;
  return {
    assetEntryId,
    assetHash: artifact.assetHash,
    format,
    ...(artifact.path ? { path: artifact.path } : {}),
  };
}

function requireString(value: unknown, field: string): string {
  const normalized = optionalString(value);
  if (!normalized) throw new Error(`${field} is required`);
  return normalized;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
