import {
  mergePromptGuidesWithBuiltIns,
  createRendererPushGateway,
  type RendererPushGateway,
  type BrowserWindow,
  type PresetDefinition,
  type PresetCategory,
  type ToolRegistry,
  type ToolRegistrationDeps,
} from './helpers.js';
import { registerCanvasTools } from './canvas-tools.js';
import { registerEntityTools } from './entity-tools.js';
import { registerMediaTools } from './media-tools.js';
import { registerSystemTools } from './system-tools.js';
import { registerSessionTools } from './session-tools.js';
import type { CommanderPromptGuide } from '@lucid-fin/contracts';

export {
  requireCanvas,
  requireAuthorizedCanvas,
  requireAuthorizedNode,
  requireDefaultCanvasId,
  touchCanvas,
  mergePromptGuidesWithBuiltIns,
} from './helpers.js';
export type { ToolRegistrationDeps } from './helpers.js';

export function registerAllTools(
  registry: ToolRegistry,
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

  const listCommanderPresets = async (category?: PresetCategory): Promise<PresetDefinition[]> => {
    return deps.presetCatalog.list({ category });
  };
  const persistCommanderPreset = async (preset: PresetDefinition): Promise<PresetDefinition> => {
    return deps.presetCatalog.save(preset);
  };
  const deleteCommanderPreset = async (presetId: string): Promise<void> => {
    const preset = deps.presetCatalog.list().find((entry) => entry.id === presetId);
    if (!preset) {
      throw new Error(`Preset not found: ${presetId}`);
    }
    if (preset.builtIn) {
      throw new Error(`Only custom presets can be deleted: ${presetId}`);
    }
    deps.presetCatalog.delete(presetId);
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

  registerEntityTools(registry, deps);

  registerSystemTools(
    registry,
    deps,
    gateway,
    mergedPromptGuides,
    listCommanderPresets,
    persistCommanderPreset,
    deleteCommanderPreset,
    compactRef,
  );

  registerMediaTools(registry, deps);

  registerSessionTools(registry, deps.db, sessionId);

}
