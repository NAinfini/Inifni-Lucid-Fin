import {
  createProviderTools,
  createPresetTools,
  createTaskListTools,
  createMetaTools,
  registerToolModule,
  EXCLUDED_TOOLS,
  colorStyleToolModule,
  getCachedProviders,
  settingsProviderKeyUpdatedChannel,
  commanderSettingsDispatchChannel,
  requireAuthorizedCanvas,
  requireDefaultCanvasId,
  type ToolRegistrationDeps,
  type RendererPushGateway,
  type PresetDefinition,
  type ToolRegistry,
} from './helpers.js';
import { getCommanderSessionId } from '@lucid-fin/contracts';
import { createStyleAuditionService } from '../style-audition.service.js';

export function registerSystemTools(
  registry: ToolRegistry,
  deps: ToolRegistrationDeps,
  gateway: RendererPushGateway,
  mergedPromptGuides: Array<{ id: string; name: string; content: string; autoInject?: boolean }>,
  listCommanderPresets: (
    category?: import('@lucid-fin/contracts').PresetCategory,
  ) => Promise<PresetDefinition[]>,
  persistCommanderPreset: (preset: PresetDefinition) => Promise<PresetDefinition>,
  deleteCommanderPreset: (presetId: string) => Promise<void>,
  compactRef?: {
    compact?: (
      instructions?: string,
    ) => Promise<{ freedChars: number; messageCount: number; toolCount: number }>;
  },
): void {
  const commanderSessionId = deps.commanderContinuation?.sessionId;
  const requireOwnedTaskList = (taskListId: string) => {
    const taskList = deps.taskExecutionEngine.get(taskListId);
    if (
      !commanderSessionId ||
      !taskList ||
      getCommanderSessionId(taskList.metadata) !== commanderSessionId
    ) {
      throw new Error('Task List is not bound to the current Commander session');
    }
    if (taskList.entityType === 'canvas' && taskList.entityId) {
      requireAuthorizedCanvas(deps, taskList.entityId);
    }
    return taskList;
  };
  const createVisualAuditions = createStyleAuditionService({
    taskExecutionEngine: deps.taskExecutionEngine,
    promptAssemblyService: deps.promptAssemblyService,
    adapterRegistry: deps.adapterRegistry,
    db: deps.db,
    mediaGenerationService: deps.mediaGenerationService,
    resolveProcessPrompt: deps.resolveProcessPrompt,
    ...(deps.activeLLMAdapter
      ? {
          commanderAuthor: {
            providerId: deps.activeLLMAdapter.id,
            model: deps.activeLLMAdapter.name,
          },
        }
      : {}),
  });
  const getBoundAudioTask = (taskListId: string) => {
    requireOwnedTaskList(taskListId);
    const view = deps.audioTaskService.get(taskListId);
    requireAuthorizedCanvas(deps, view.canvasId);
    return view;
  };
  const projectMediaResult = (
    result: Awaited<ReturnType<typeof deps.productionMediaService.produce>>,
    completion: unknown,
  ) => ({
    taskListId: result.taskListId,
    canvasId: result.canvasId,
    nodeId: result.nodeId,
    status: result.status,
    nextAction: result.nextAction,
    message: result.message,
    steps: result.steps,
    promptAssembly: result.promptAssembly
      ? {
          id: result.promptAssembly.id,
          status: result.promptAssembly.status,
          inputHash: result.promptAssembly.inputHash,
          input: result.promptAssembly.input,
          output: result.promptAssembly.output,
          parentAssemblyId: result.promptAssembly.parentAssemblyId,
          sourceAttemptId: result.promptAssembly.sourceAttemptId,
          error: result.promptAssembly.error,
        }
      : undefined,
    attempt: result.attempt
      ? {
          id: result.attempt.id,
          attempt: result.attempt.attempt,
          status: result.attempt.status,
          mediaType: result.attempt.mediaType,
          specHash: result.attempt.specHash,
          promptHash: result.attempt.promptHash,
          promptAssemblyId:
            result.attempt.promptAssemblyId ?? result.attempt.generationSpec.promptAssemblyId,
          providerId: result.attempt.providerId,
          model: result.attempt.model,
          seed: result.attempt.seed,
          estimatedCostUsd: result.attempt.estimatedCostUsd,
          reportedActualCostUsd: result.attempt.reportedActualCostUsd,
          assetHash: result.attempt.assetHash,
          repairDelta: result.attempt.repairDelta,
          error: result.attempt.error,
        }
      : undefined,
    evaluation: result.evaluation
      ? {
          rubricVersion: result.evaluation.rubricVersion,
          total: result.evaluation.total,
          verdict: result.evaluation.verdict,
          scores: result.evaluation.scores,
          strengths: result.evaluation.strengths,
          risks: result.evaluation.risks,
          evidence: result.evaluation.evidence,
          repairDelta: result.evaluation.repairDelta,
          frameEvidence: result.evaluation.frameEvidence,
        }
      : undefined,
    completion,
  });
  // job.* tools are excluded from Commander AI (human/UI only)
  // registerToolModule(registry, jobToolModule, {...}) — skipped

  registerToolModule(registry, colorStyleToolModule, {
    listColorStyles: async () => deps.db.repos.colorStyles.list(),
    saveColorStyle: async (style: Record<string, unknown>) => {
      if (
        typeof style.id !== 'string' ||
        typeof style.name !== 'string' ||
        style.id.trim().length === 0 ||
        style.name.trim().length === 0
      ) {
        throw new Error('style.id and style.name are required');
      }
      deps.db.repos.colorStyles.upsert(
        style as unknown as Parameters<typeof deps.db.repos.colorStyles.upsert>[0],
      );
    },
    deleteColorStyle: async (id: string) => {
      deps.db.repos.colorStyles.delete(id);
    },
  });

  for (const tool of createProviderTools({
    listProviders: async (group: string) => {
      return getCachedProviders(group).map((p) => ({
        id: p.id,
        name: p.name,
        baseUrl: p.baseUrl,
        model: p.model,
        isCustom: p.isCustom,
        hasKey: p.hasKey,
      }));
    },
    getActiveProvider: async (group: string) => {
      const providers = getCachedProviders(group);
      return providers[0]?.id ?? null;
    },
    setActiveProvider: async (group: string, providerId: string) => {
      if (group === 'llm') {
        gateway.emit(commanderSettingsDispatchChannel, {
          action: 'setProviderId',
          payload: { providerId },
        });
        return;
      }
      throw new Error(
        `Global active provider is no longer supported for ${group}; select the provider in the generation UI instead.`,
      );
    },
    setProviderBaseUrl: async (group: string, providerId: string, baseUrl: string) => {
      gateway.emit(commanderSettingsDispatchChannel, {
        action: 'setProviderBaseUrl',
        payload: { group, provider: providerId, baseUrl },
      });
    },
    setProviderModel: async (group: string, providerId: string, model: string) => {
      gateway.emit(commanderSettingsDispatchChannel, {
        action: 'setProviderModel',
        payload: { group, provider: providerId, model },
      });
    },
    setProviderName: async (group: string, providerId: string, name: string) => {
      gateway.emit(commanderSettingsDispatchChannel, {
        action: 'setProviderName',
        payload: { group, provider: providerId, name },
      });
    },
    addCustomProvider: async (
      group: string,
      id: string,
      name: string,
      baseUrl?: string,
      model?: string,
    ) => {
      gateway.emit(commanderSettingsDispatchChannel, {
        action: 'addCustomProvider',
        payload: { group, id, name, baseUrl, model },
      });
    },
    removeCustomProvider: async (group: string, providerId: string) => {
      gateway.emit(commanderSettingsDispatchChannel, {
        action: 'removeCustomProvider',
        payload: { group, provider: providerId },
      });
    },
    setProviderApiKey: async (providerId: string, apiKey: string) => {
      const mediaAdapter =
        deps.adapterRegistry.get(providerId) ??
        deps.adapterRegistry.resolve?.(providerId, 'image') ??
        deps.adapterRegistry.resolve?.(providerId, 'video');
      if (mediaAdapter) mediaAdapter.configure(apiKey);
      const llmProvider = deps.llmRegistry.list().find((a) => a.id === providerId);
      if (llmProvider) llmProvider.configure(apiKey);
      await deps.keychain.setKey(providerId, apiKey);
      gateway.emit(settingsProviderKeyUpdatedChannel, {
        group: 'provider',
        providerId,
        hasKey: true,
      });
    },
  })) {
    if (!EXCLUDED_TOOLS.has(tool.name)) registry.register(tool);
  }

  for (const tool of createPresetTools({
    listPresets: listCommanderPresets,
    savePreset: persistCommanderPreset,
    deletePreset: deleteCommanderPreset,
    resetPreset: async (presetId: string) => {
      return deps.presetCatalog.reset({ id: presetId });
    },
    getPreset: async (presetId: string) => {
      return deps.presetCatalog.list().find((p) => p.id === presetId) ?? null;
    },
  })) {
    if (!EXCLUDED_TOOLS.has(tool.name)) registry.register(tool);
  }

  for (const tool of createTaskListTools({
    pauseTaskList: async (id: string) => {
      requireOwnedTaskList(id);
      await deps.taskExecutionEngine.pause(id);
    },
    resumeTaskList: async (id: string) => {
      requireOwnedTaskList(id);
      await deps.taskExecutionEngine.resume(id);
    },
    cancelTaskList: async (id: string) => {
      requireOwnedTaskList(id);
      await deps.taskExecutionEngine.cancel(id);
    },
    retryTaskList: async (id: string) => {
      requireOwnedTaskList(id);
      await deps.taskExecutionEngine.retryTaskList(id);
    },
    decidePendingGate: async (decision) => deps.decidePendingGate(decision),
    prepareAudioTask: async (input) => {
      if (!commanderSessionId) {
        throw new Error('Commander session binding is unavailable for audio generation');
      }
      return deps.audioTaskService.start({
        ...input,
        canvasId: requireDefaultCanvasId(deps),
        commanderSessionId,
      });
    },
    getAudioTask: async (taskListId) => getBoundAudioTask(taskListId),
    submitAudioPrompt: async (input) => {
      getBoundAudioTask(input.taskListId);
      if (!deps.activeLLMAdapter) {
        throw new Error('Commander LLM author binding is unavailable for audio Prompt Assembly');
      }
      return deps.audioTaskService.submitPrompt(input, {
        providerId: deps.activeLLMAdapter.id,
        model: deps.activeLLMAdapter.name,
      });
    },
    createProductionPlan: async (input) => {
      if (!deps.commanderContinuation) {
        throw new Error(
          'Persistent production requires a stable Commander session and keyless provider binding',
        );
      }
      requireAuthorizedCanvas(deps, input.canvasId);
      return deps.taskExecutionEngine.createProductionPlan({
        ...input,
        commanderContinuation: deps.commanderContinuation,
      });
    },
    reviseProductionPlan: async (input) => {
      requireOwnedTaskList(input.taskListId);
      requireAuthorizedCanvas(deps, input.canvasId);
      return deps.taskExecutionEngine.reviseProductionPlan(input);
    },
    completeCreativeTask: async (input) => {
      requireOwnedTaskList(input.taskListId);
      requireAuthorizedCanvas(deps, input.canvasId);
      return deps.taskExecutionEngine.completeCreativeTask(input);
    },
    createVisualAuditions: async (input) => {
      requireOwnedTaskList(input.taskListId);
      requireAuthorizedCanvas(deps, input.canvasId);
      return createVisualAuditions(input);
    },
    produceMedia: async (input) => {
      requireOwnedTaskList(input.taskListId);
      requireAuthorizedCanvas(deps, input.canvasId);
      const result = await deps.productionMediaService.produce(input, {
        preferredLLMAdapter: deps.activeLLMAdapter,
        deferEvaluation: true,
      });
      const task = deps.taskExecutionEngine
        .getTasks(input.taskListId)
        .find((candidate) => candidate.id === input.taskId);
      const completion =
        result.status === 'accepted' &&
        result.attempt &&
        task?.input.taskRole === 'production_media'
          ? await deps.taskExecutionEngine.completeProductionMediaTask({
              canvasId: input.canvasId,
              taskListId: input.taskListId,
              taskId: input.taskId,
              expectedRowVersion: input.expectedRowVersion,
              nodeId: input.nodeId,
              attemptId: result.attempt.id,
            })
          : undefined;
      return projectMediaResult(result, completion);
    },
    refineMedia: async (input) => {
      requireOwnedTaskList(input.taskListId);
      requireAuthorizedCanvas(deps, input.canvasId);
      const result = await deps.productionMediaService.refine(input, {
        preferredLLMAdapter: deps.activeLLMAdapter,
        deferEvaluation: true,
      });
      const taskId = result.attempt?.generationSpec.task.id;
      const task = taskId
        ? deps.taskExecutionEngine
            .getTasks(input.taskListId)
            .find((candidate) => candidate.id === taskId)
        : undefined;
      const completion =
        result.status === 'accepted' &&
        result.attempt &&
        taskId &&
        task?.input.taskRole === 'production_media'
          ? await deps.taskExecutionEngine.completeProductionMediaTask({
              canvasId: input.canvasId,
              taskListId: input.taskListId,
              taskId,
              expectedRowVersion: result.taskListRowVersion ?? input.expectedRowVersion,
              nodeId: input.nodeId,
              attemptId: result.attempt.id,
            })
          : undefined;
      return projectMediaResult(result, completion);
    },
    prepareDelivery: async (input) => {
      requireOwnedTaskList(input.taskListId);
      requireAuthorizedCanvas(deps, input.canvasId);
      return deps.taskExecutionEngine.prepareDeliveryManifest(input);
    },
  })) {
    if (!EXCLUDED_TOOLS.has(tool.name)) registry.register(tool);
  }

  for (const tool of createMetaTools(registry, {
    promptGuides: mergedPromptGuides,
    context: 'canvas',
    compactContext: compactRef
      ? async (instructions?: string) => {
          if (!compactRef.compact) return { freedChars: 0, messageCount: 0, toolCount: 0 };
          return compactRef.compact(instructions);
        }
      : undefined,
  })) {
    if (!EXCLUDED_TOOLS.has(tool.name)) registry.register(tool);
  }
}
