import { ToolCatalog } from './tool-catalog.js';

export type ProcessCategory =
  | 'entity-ref-image-generation'
  | 'image-node-generation'
  | 'video-node-generation'
  | 'audio-generation'
  | 'node-preset-tracks'
  | 'preset-definition-management'
  | 'shot-template-management'
  | 'color-style-management'
  | 'entity-management'
  | 'canvas-structure'
  | 'canvas-graph-and-layout'
  | 'canvas-node-editing'
  | 'provider-management'
  | 'node-provider-selection'
  | 'media-config'
  | 'script-development'
  | 'vision-analysis'
  | 'snapshot-and-rollback'
  | 'render-and-export'
  | 'workflow-orchestration'
  | 'series-management'
  | 'prompt-template-management'
  | 'asset-library-management'
  | 'job-control'
  | 'canvas-settings';

const PROCESS_CATEGORY_NAMES: Record<ProcessCategory, string> = {
  'entity-ref-image-generation': 'Entity Reference Image Generation',
  'image-node-generation': 'Image Node Generation',
  'video-node-generation': 'Video Node Generation',
  'audio-generation': 'Audio Generation',
  'node-preset-tracks': 'Node Preset Tracks',
  'preset-definition-management': 'Preset Definition Management',
  'shot-template-management': 'Shot Template Management',
  'color-style-management': 'Color Style Management',
  'entity-management': 'Entity Management',
  'canvas-structure': 'Canvas Structure',
  'canvas-graph-and-layout': 'Canvas Graph And Layout',
  'canvas-node-editing': 'Canvas Node Editing',
  'provider-management': 'Provider Management',
  'node-provider-selection': 'Node Provider Selection',
  'media-config': 'Media Config',
  'script-development': 'Script Development',
  'vision-analysis': 'Vision Analysis',
  'snapshot-and-rollback': 'Snapshot And Rollback',
  'render-and-export': 'Render And Export',
  'workflow-orchestration': 'Workflow Orchestration',
  'series-management': 'Series Management',
  'prompt-template-management': 'Prompt Template Management',
  'asset-library-management': 'Asset Library Management',
  'job-control': 'Job Control',
  'canvas-settings': 'Canvas Settings',
};

function normalizeNodeType(args?: Record<string, unknown>): 'image' | 'video' | 'audio' | null {
  const raw = typeof args?.nodeType === 'string' ? args.nodeType.trim().toLowerCase() : '';
  if (raw === 'image' || raw === 'video' || raw === 'audio') return raw;
  return null;
}


export function detectProcess(
  toolName: string,
  args?: Record<string, unknown>,
): ProcessCategory | null {
  // canvas.generation is the one dynamic override — its process depends on
  // runtime node-type argument. Keep the explicit branch.
  if (toolName === 'canvas.generation') {
    const nodeType = normalizeNodeType(args);
    if (nodeType === 'video') return 'video-node-generation';
    if (nodeType === 'audio') return 'audio-generation';
    return 'image-node-generation';
  }

  const byKey = ToolCatalog.byKey as Readonly<
    Record<string, { process: string; category: string }>
  >;
  const entry = byKey[toolName];
  if (!entry) return null;
  // Meta tools (`tool.*`, `guide.*`, `commander.askUser`) don't belong to any
  // domain process — callers expect `null` so they can skip process framing.
  if (entry.category === 'meta') return null;
  return entry.process as ProcessCategory;
}

export function getProcessCategoryName(processKey: ProcessCategory): string {
  return PROCESS_CATEGORY_NAMES[processKey];
}
