export type {
  CanvasToolDeps,
  MediaProviderConfig,
  MediaTaskView,
  PrepareMediaTaskInput,
  SubmitMediaPromptInput,
} from './canvas-tool-utils.js';
import type { CanvasToolDeps } from './canvas-tool-utils.js';
import type { ToolDefinition } from '../tool-registry.js';

import { createCanvasMetaTools } from './canvas-meta-tools.js';
import { createCanvasCoreTools } from './canvas-core-tools.js';
import { createCanvasGenerationTools } from './canvas-generation-tools.js';
import { createCanvasPresetTools } from './canvas-preset-tools.js';

export function createCanvasTools(deps: CanvasToolDeps): ToolDefinition[] {
  const { tools: coreTools } = createCanvasCoreTools(deps);

  return [
    ...coreTools,
    ...createCanvasGenerationTools(deps),
    ...createCanvasPresetTools(deps),
    ...createCanvasMetaTools(deps),
  ];
}
