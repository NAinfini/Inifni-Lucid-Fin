import { AgentToolRegistry } from './tool-registry.js';
import { registerToolModule } from './tool-module.js';
import { createScriptTools, type ScriptToolDeps } from './tools/script-tools.js';
import { createCharacterTools, type CharacterToolDeps } from './tools/character-tools.js';
import { createCanvasTools, type CanvasToolDeps } from './tools/canvas-tools.js';
import { createLocationTools, type LocationToolDeps } from './tools/location-tools.js';
import { jobToolModule, type JobToolDeps } from './tools/job-tools.js';
import { seriesToolModule, type SeriesToolDeps } from './tools/series-tools.js';
import { colorStyleToolModule, type ColorStyleToolDeps } from './tools/color-style-tools.js';
import { createEquipmentTools, type EquipmentToolDeps } from './tools/equipment-tools.js';
import { createAssetTools, type AssetToolDeps } from './tools/asset-tools.js';
import { createPromptTools, type PromptToolDeps } from './tools/prompt-tools.js';
import { createRenderTools, type RenderToolDeps } from './tools/render-tools.js';
import { createPresetTools, type PresetToolDeps } from './tools/preset-tools.js';
import { createWorkflowTools, type WorkflowToolDeps } from './tools/workflow-tools.js';
import { createMetaTools, type MetaToolDeps } from './tools/meta-tools.js';
import { WORKFLOW_GUIDES } from './tools/workflow-guides.js';

export interface AllToolDeps
  extends ScriptToolDeps,
    Omit<CharacterToolDeps, 'getCanvas'>,
    CanvasToolDeps,
    Omit<LocationToolDeps, 'getCanvas'>,
    JobToolDeps,
    SeriesToolDeps,
    ColorStyleToolDeps,
    Omit<EquipmentToolDeps, 'getCanvas'>,
    AssetToolDeps,
    PromptToolDeps,
    RenderToolDeps,
    PresetToolDeps,
    WorkflowToolDeps,
    Partial<MetaToolDeps> {}

export function registerAgentTools(
  registry: AgentToolRegistry,
  deps: AllToolDeps,
): AgentToolRegistry {
  // Self-registering modules
  registerToolModule(registry, jobToolModule, deps);
  registerToolModule(registry, seriesToolModule, deps);
  registerToolModule(registry, colorStyleToolModule, deps);

  // Legacy manual registration (to be converted later)
  for (const tool of createScriptTools(deps)) registry.register(tool);
  for (const tool of createCharacterTools(deps)) registry.register(tool);
  for (const tool of createCanvasTools(deps)) registry.register(tool);
  for (const tool of createLocationTools(deps)) registry.register(tool);
  for (const tool of createEquipmentTools(deps)) registry.register(tool);
  for (const tool of createAssetTools(deps)) registry.register(tool);
  for (const tool of createPromptTools(deps)) registry.register(tool);
  for (const tool of createRenderTools(deps)) registry.register(tool);
  for (const tool of createPresetTools(deps)) registry.register(tool);
  for (const tool of createWorkflowTools(deps)) registry.register(tool);
  const allGuides = [...(deps.promptGuides ?? []), ...WORKFLOW_GUIDES];
  for (const tool of createMetaTools(registry, { promptGuides: allGuides })) registry.register(tool);
  return registry;
}
