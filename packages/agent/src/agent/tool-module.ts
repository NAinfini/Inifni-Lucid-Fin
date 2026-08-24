import type { ToolDefinition, ToolRegistry } from './tool-registry.js';

/**
 * A self-contained tool module that declares its own dependencies
 * and handles its own registration.
 *
 * Usage: each tool file exports a ToolModule. The registry can
 * collect and register them without knowing their deps types.
 */
export interface ToolModule<TDeps = unknown> {
  /** Unique module name for identification and debugging */
  readonly name: string;
  /** Factory: given deps, returns the tool definitions */
  createTools(deps: TDeps): ToolDefinition[];
}

/**
 * Helper to define a ToolModule with full type inference.
 * Usage:
 *   export const jobToolModule = defineToolModule({
 *     name: 'job',
 *     createTools(deps: JobToolDeps): ToolDefinition[] { ... }
 *   });
 */
export function defineToolModule<TDeps>(module: ToolModule<TDeps>): ToolModule<TDeps> {
  return module;
}

/**
 * Register a single tool module: create its tools and add them to the registry.
 */
export function registerToolModule<TDeps>(
  registry: ToolRegistry,
  module: ToolModule<TDeps>,
  deps: TDeps,
): void {
  for (const tool of module.createTools(deps)) {
    registry.register(tool);
  }
}
