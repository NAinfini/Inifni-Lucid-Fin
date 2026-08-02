import {
  createProviderTools,
  createPresetTools,
  createWorkflowTools,
  createMetaTools,
  registerToolModule,
  EXCLUDED_TOOLS,
  colorStyleToolModule,
  getCachedProviders,
  settingsProviderKeyUpdatedChannel,
  commanderSettingsDispatchChannel,
  type ToolRegistrationDeps,
  type RendererPushGateway,
  type PresetDefinition,
  type AgentToolRegistry,
} from './helpers.js';
import {
  createStyleAuditionService,
  createVisualPreviewGrader,
} from '../style-audition.service.js';

export function registerSystemTools(
  registry: AgentToolRegistry,
  deps: ToolRegistrationDeps,
  gateway: RendererPushGateway,
  mergedPromptGuides: Array<{ id: string; name: string; content: string; autoInject?: boolean }>,
  listCommanderPresets: (
    category?: import('@lucid-fin/contracts').PresetCategory,
  ) => Promise<PresetDefinition[]>,
  persistCommanderPreset: (preset: PresetDefinition) => Promise<PresetDefinition>,
  deleteCommanderPreset: (presetId: string) => Promise<void>,
  generateImage: ReturnType<typeof import('./helpers.js').makeGenerateImage>,
  compactRef?: {
    compact?: (
      instructions?: string,
    ) => Promise<{ freedChars: number; messageCount: number; toolCount: number }>;
  },
): void {
  const createVisualAuditions = createStyleAuditionService({
    workflowEngine: deps.workflowEngine,
    generateImage,
    gradeImage: createVisualPreviewGrader({ cas: deps.cas, keychain: deps.keychain }),
  });
  // job.* tools are excluded from Commander AI (human/UI only)
  // registerToolModule(registry, jobToolModule, {...}) — skipped

  // series.* tools are excluded from Commander AI (human-decided project structure)
  // registerToolModule(registry, seriesToolModule, {...}) — skipped

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
      const mediaAdapter = deps.adapterRegistry.get(providerId);
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
      const original = deps.presetLibrary.find((p) => p.id === presetId);
      if (!original) throw new Error(`Preset not found: ${presetId}`);
      const idx = deps.presetLibrary.findIndex((p) => p.id === presetId);
      const reset: PresetDefinition = { ...original, modified: false, updatedAt: Date.now() };
      if (idx >= 0) deps.presetLibrary[idx] = reset;
      return reset;
    },
    getPreset: async (presetId: string) => {
      return deps.presetLibrary.find((p) => p.id === presetId) ?? null;
    },
  })) {
    if (!EXCLUDED_TOOLS.has(tool.name)) registry.register(tool);
  }

  for (const tool of createWorkflowTools({
    pauseWorkflow: async (id: string) => {
      await deps.workflowEngine.pause(id);
    },
    resumeWorkflow: async (id: string) => {
      await deps.workflowEngine.resume(id);
    },
    cancelWorkflow: async (id: string) => {
      await deps.workflowEngine.cancel(id);
    },
    retryWorkflow: async (id: string) => {
      await deps.workflowEngine.retryWorkflow(id);
    },
    createProductionPlan: async (input) => deps.workflowEngine.createProductionPlan(input),
    createVisualAuditions,
    produceMedia: async (input) => {
      const result = await deps.productionMediaService.produce(input);
      return {
        workflowRunId: result.workflowRunId,
        canvasId: result.canvasId,
        nodeId: result.nodeId,
        status: result.status,
        nextAction: result.nextAction,
        message: result.message,
        attempt: result.attempt
          ? {
              id: result.attempt.id,
              attempt: result.attempt.attempt,
              status: result.attempt.status,
              mediaType: result.attempt.mediaType,
              specHash: result.attempt.specHash,
              promptHash: result.attempt.promptHash,
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
      };
    },
    prepareFinalExport: async (input) => deps.workflowEngine.prepareFinalExportManifest(input),
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
