import { AgentToolRegistry } from './tool-registry.js';
import { createScriptTools, type ScriptToolDeps } from './tools/script-tools.js';
import { createCharacterTools, type CharacterToolDeps } from './tools/character-tools.js';
import { createSceneTools, type SceneToolDeps } from './tools/scene-tools.js';
import { createSegmentTools, type SegmentToolDeps } from './tools/segment-tools.js';
import { createStoryboardTools, type StoryboardToolDeps } from './tools/storyboard-tools.js';
import { createCanvasTools, type CanvasToolDeps } from './tools/canvas-tools.js';
import { createLocationTools, type LocationToolDeps } from './tools/location-tools.js';
import { createJobTools, type JobToolDeps } from './tools/job-tools.js';
import {
  createOrchestrationTools,
  type OrchestrationToolDeps,
} from './tools/orchestration-tools.js';
import { createSeriesTools, type SeriesToolDeps } from './tools/series-tools.js';
import { createColorStyleTools, type ColorStyleToolDeps } from './tools/color-style-tools.js';
import { createEquipmentTools, type EquipmentToolDeps } from './tools/equipment-tools.js';
import { createAssetTools, type AssetToolDeps } from './tools/asset-tools.js';
import { createPromptTools, type PromptToolDeps } from './tools/prompt-tools.js';
import { createProjectTools, type ProjectToolDeps } from './tools/project-tools.js';
import { createRenderTools, type RenderToolDeps } from './tools/render-tools.js';
import { createPresetTools, type PresetToolDeps } from './tools/preset-tools.js';
import { createWorkflowTools, type WorkflowToolDeps } from './tools/workflow-tools.js';
import { createMetaTools, type MetaToolDeps } from './tools/meta-tools.js';

export interface AllToolDeps
  extends ScriptToolDeps,
    Omit<CharacterToolDeps, 'getCanvas'>,
    Omit<SceneToolDeps, 'getCanvas'>,
    SegmentToolDeps,
    StoryboardToolDeps,
    CanvasToolDeps,
    LocationToolDeps,
    JobToolDeps,
    OrchestrationToolDeps,
    SeriesToolDeps,
    ColorStyleToolDeps,
    Omit<EquipmentToolDeps, 'getCanvas'>,
    AssetToolDeps,
    PromptToolDeps,
    ProjectToolDeps,
    RenderToolDeps,
    PresetToolDeps,
    WorkflowToolDeps,
    Partial<MetaToolDeps> {}

export function registerAgentTools(
  registry: AgentToolRegistry,
  deps: AllToolDeps,
): AgentToolRegistry {
  for (const tool of createScriptTools(deps)) registry.register(tool);
  for (const tool of createCharacterTools(deps)) registry.register(tool);
  for (const tool of createSceneTools(deps)) registry.register(tool);
  for (const tool of createSegmentTools(deps)) registry.register(tool);
  for (const tool of createStoryboardTools(deps)) registry.register(tool);
  for (const tool of createCanvasTools(deps)) registry.register(tool);
  for (const tool of createLocationTools(deps)) registry.register(tool);
  for (const tool of createJobTools(deps)) registry.register(tool);
  for (const tool of createOrchestrationTools(deps)) registry.register(tool);
  for (const tool of createSeriesTools(deps)) registry.register(tool);
  for (const tool of createColorStyleTools(deps)) registry.register(tool);
  for (const tool of createEquipmentTools(deps)) registry.register(tool);
  for (const tool of createAssetTools(deps)) registry.register(tool);
  for (const tool of createPromptTools(deps)) registry.register(tool);
  for (const tool of createProjectTools(deps)) registry.register(tool);
  for (const tool of createRenderTools(deps)) registry.register(tool);
  for (const tool of createPresetTools(deps)) registry.register(tool);
  for (const tool of createWorkflowTools(deps)) registry.register(tool);
  for (const tool of createMetaTools(registry, { promptGuides: deps.promptGuides })) registry.register(tool);
  return registry;
}
