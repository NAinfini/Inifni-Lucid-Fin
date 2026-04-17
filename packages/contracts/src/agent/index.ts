/**
 * Agent namespace barrel — Phase C-1.
 *
 * Exposes the pure-type aggregator (`ToolCatalog`) and re-exports the
 * underlying `ToolDefinitionType` / `UiEffect` shapes so consumers can import
 * everything tool-registry-related from a single surface.
 *
 * Zero runtime — runtime `createCatalog` / `defineTool` live in
 * `@lucid-fin/contracts-parse/src/agent`.
 */

export type {
  ToolCatalog,
  ToolKey,
  ProcessCategory,
} from './tool-catalog-type.js';

export type { ToolDefinitionType, UiEffect } from '../types/tool-types.js';

export { ENTITY_REFRESH_TOOL_ENTITY } from './entity-refresh-map.js';
