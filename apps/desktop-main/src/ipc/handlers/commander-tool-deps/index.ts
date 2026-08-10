import {
  mergePromptGuidesWithBuiltIns,
  EXCLUDED_TOOLS,
  makeGenerateImage,
  createRendererPushGateway,
  refimageStartChannel,
  refimageCompleteChannel,
  refimageFailedChannel,
  parsePresetId,
  type RendererPushGateway,
  type BrowserWindow,
  type PresetDefinition,
  type PresetCategory,
  type AgentToolRegistry,
  type ToolRegistrationDeps,
} from './helpers.js';
import { registerCanvasTools } from './canvas-tools.js';
import { registerEntityTools } from './entity-tools.js';
import { registerMediaTools } from './media-tools.js';
import { registerSystemTools } from './system-tools.js';
import { registerSessionTools } from './session-tools.js';
import type { CommanderPromptGuide } from '@lucid-fin/contracts';
import { ToolCatalog } from '@lucid-fin/application';

export { requireCanvas, touchCanvas, mergePromptGuidesWithBuiltIns } from './helpers.js';
export type { ToolRegistrationDeps } from './helpers.js';

export function registerAllTools(
  registry: AgentToolRegistry,
  deps: ToolRegistrationDeps,
  getWindow: () => BrowserWindow | null,
  promptGuides: CommanderPromptGuide[],
  compactRef?: {
    compact?: (
      instructions?: string,
    ) => Promise<{ freedChars: number; messageCount: number; toolCount: number }>;
  },
  sessionId?: string,
  defaultProviders?: Record<string, string>,
  pushGateway?: RendererPushGateway,
  processPromptGuides?: CommanderPromptGuide[],
): void {
  const mergedPromptGuides = mergePromptGuidesWithBuiltIns(promptGuides, processPromptGuides);
  const gateway = pushGateway ?? createRendererPushGateway({ getWindow });
  const generateImage = makeGenerateImage({
    ...deps,
    onStart: (jobId, provider, width, height) => {
      gateway.emit(refimageStartChannel, { jobId, provider, width, height });
    },
    onComplete: (jobId, assetHash) => {
      gateway.emit(refimageCompleteChannel, { jobId, assetHash });
    },
    onFailed: (jobId, error) => {
      gateway.emit(refimageFailedChannel, { jobId, error });
    },
  });

  const listCommanderPresets = async (category?: PresetCategory): Promise<PresetDefinition[]> => {
    return deps.presetLibrary.filter((preset) => !category || preset.category === category);
  };
  const persistCommanderPreset = async (preset: PresetDefinition): Promise<PresetDefinition> => {
    const existing = deps.presetLibrary.findIndex((entry) => entry.id === preset.id);
    if (existing >= 0) {
      deps.presetLibrary[existing] = preset;
    } else {
      deps.presetLibrary.push(preset);
    }
    deps.db.repos.presets.upsertOverride({
      id: preset.id,
      presetId: preset.id,
      category: preset.category,
      name: preset.name,
      description: preset.description ?? '',
      prompt: preset.prompt ?? '',
      params: preset.params as unknown[],
      defaults: preset.defaults as Record<string, unknown>,
      isUser: true,
      createdAt: preset.createdAt ?? Date.now(),
      updatedAt: Date.now(),
    });
    return preset;
  };
  const deleteCommanderPreset = async (presetId: string): Promise<void> => {
    const presetIndex = deps.presetLibrary.findIndex((entry) => entry.id === presetId);
    if (presetIndex === -1) {
      throw new Error(`Preset not found: ${presetId}`);
    }
    const preset = deps.presetLibrary[presetIndex];
    if (preset.builtIn) {
      throw new Error(`Only custom presets can be deleted: ${presetId}`);
    }
    deps.presetLibrary.splice(presetIndex, 1);
    deps.db.repos.presets.deleteOverride(parsePresetId(presetId));
  };

  registerCanvasTools(
    registry,
    deps,
    getWindow,
    gateway,
    listCommanderPresets,
    persistCommanderPreset,
    defaultProviders,
  );

  registerEntityTools(registry, deps, generateImage);

  registerSystemTools(
    registry,
    deps,
    gateway,
    mergedPromptGuides,
    listCommanderPresets,
    persistCommanderPreset,
    deleteCommanderPreset,
    generateImage,
    compactRef,
  );

  registerMediaTools(registry, deps, generateImage);

  registerSessionTools(registry, deps.db, sessionId);

  assertCommanderToolCoverage(registry);
}

/** Fail fast when a creative/app tool silently disappears from Commander. */
export function assertCommanderToolCoverage(registry: AgentToolRegistry): void {
  const missing = Object.keys(ToolCatalog.byKey).filter(
    (name) => !EXCLUDED_TOOLS.has(name) && !registry.get(name),
  );
  if (missing.length > 0) {
    throw new Error(`Commander tool registry is missing catalog tools: ${missing.join(', ')}`);
  }
}
