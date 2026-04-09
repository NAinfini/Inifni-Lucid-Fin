export type { CanvasToolDeps } from './canvas-tool-utils.js';
import type { CanvasToolDeps } from './canvas-tool-utils.js';
import type { AgentTool } from '../tool-registry.js';

import { createCanvasMetaTools } from './canvas-meta-tools.js';
import { createCanvasCoreTools } from './canvas-core-tools.js';
import { createCanvasGenerationTools } from './canvas-generation-tools.js';
import { createCanvasReferenceTools } from './canvas-reference-tools.js';
import { createCanvasPresetTools } from './canvas-preset-tools.js';
import { createCanvasBackdropTools } from './canvas-backdrop-tools.js';
import { createCanvasSettingsTools } from './canvas-settings-tools.js';

export function createCanvasTools(deps: CanvasToolDeps): AgentTool[] {
  const { tools: coreTools } = createCanvasCoreTools(deps);

  return [
    ...coreTools,
    ...createCanvasGenerationTools(deps),
    ...createCanvasReferenceTools(deps),
    ...createCanvasPresetTools(deps),
    ...createCanvasBackdropTools(deps),
    ...createCanvasMetaTools(deps),
    ...createCanvasSettingsTools(deps),
  ];
}
