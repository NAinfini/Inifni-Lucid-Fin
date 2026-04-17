/**
 * Agent namespace barrel — Phase C-1 (runtime side).
 *
 * Exposes `createCatalog` alongside re-exports of the underlying `defineTool`
 * factory and its associated types so tool-registry consumers can import from
 * a single surface.
 */

export { createCatalog } from './catalog.js';

export { defineTool } from '../tools.js';
export type { ToolDef, ToolRunContext, ToolEvent } from '../tools.js';
