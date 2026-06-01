import { AgentToolRegistry } from './tool-registry.js';
import { registerToolModule } from './tool-module.js';
import { createScriptTools, type ScriptToolDeps } from './tools/script-tools.js';
import { createEntityTools, type EntityToolDeps } from './tools/entity-tools.js';
import { createCanvasTools, type CanvasToolDeps } from './tools/canvas-tools.js';
import { colorStyleToolModule, type ColorStyleToolDeps } from './tools/color-style-tools.js';
import { createPromptTools, type PromptToolDeps } from './tools/prompt-tools.js';
import { createPresetTools, type PresetToolDeps } from './tools/preset-tools.js';
import { createWorkflowTools, type WorkflowToolDeps } from './tools/workflow-tools.js';
import { createTextAnalyzeTools, type TextAnalyzeToolDeps } from './tools/text-analyze-tools.js';
import { createTodoTools } from './tools/todo-tools.js';
import { createMetaTools, type MetaToolDeps } from './tools/meta-tools.js';
import type { AgentTool } from './tool-registry.js';

/**
 * Tools excluded from the Commander AI registry.
 * These remain in the app for direct UI use but the AI should never see them.
 * See .trellis/tasks/05-18-commander-tool-consolidation/prd.md §"Removed from Commander AI".
 */
export const EXCLUDED_TOOLS: ReadonlySet<string> = new Set([
  // Canvas: file I/O, UI-only, destructive
  'canvas.importWorkflow',
  'canvas.exportWorkflow',
  'canvas.undo',
  'canvas.redo',
  'canvas.addNote',
  'canvas.updateNote',
  'canvas.deleteNote',
  'canvas.deleteCanvas',
  'canvas.setNodeLayout',
  // Provider: admin tasks involving API keys
  'provider.update',
  'provider.setKey',
  'provider.addCustom',
  'provider.removeCustom',
  // Script: file I/O
  'script.import',
  // Logger: developer debugging
  'logger.list',
  // Entire domains: human-only
  'series.get',
  'series.update',
  'series.listEpisodes',
  'series.addEpisode',
  'series.removeEpisode',
  'series.reorderEpisodes',
  'render.start',
  'render.cancel',
  'render.exportBundle',
  'job.list',
  'job.control',
  'asset.import',
  'asset.list',
]);

export function registerFiltered(registry: AgentToolRegistry, tools: AgentTool[]): void {
  for (const tool of tools) {
    if (!EXCLUDED_TOOLS.has(tool.name)) registry.register(tool);
  }
}

export interface AllToolDeps
  extends
    ScriptToolDeps,
    Omit<EntityToolDeps, 'getCanvas'>,
    CanvasToolDeps,
    ColorStyleToolDeps,
    PromptToolDeps,
    PresetToolDeps,
    WorkflowToolDeps,
    TextAnalyzeToolDeps,
    Partial<MetaToolDeps> {}

export function registerAgentTools(
  registry: AgentToolRegistry,
  deps: AllToolDeps,
): AgentToolRegistry {
  // Self-registering modules (colorStyle is discoverable-only)
  registerToolModule(registry, colorStyleToolModule, deps);

  // Filtered registration — excluded tools stay in app for UI
  registerFiltered(registry, createScriptTools(deps));
  registerFiltered(registry, createEntityTools(deps));
  registerFiltered(registry, createCanvasTools(deps));
  registerFiltered(registry, createPromptTools(deps));
  registerFiltered(registry, createPresetTools(deps));
  registerFiltered(registry, createWorkflowTools(deps));
  registerFiltered(registry, createTextAnalyzeTools(deps));
  registerFiltered(registry, createTodoTools());
  for (const tool of createMetaTools(registry, { promptGuides: deps.promptGuides ?? [] }))
    if (!EXCLUDED_TOOLS.has(tool.name)) registry.register(tool);
  return registry;
}
