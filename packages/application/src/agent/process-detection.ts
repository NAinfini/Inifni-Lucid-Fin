export type ProcessCategory =
  | 'character-ref-image-generation'
  | 'location-ref-image-generation'
  | 'equipment-ref-image-generation'
  | 'image-node-generation'
  | 'video-node-generation'
  | 'audio-generation'
  | 'node-preset-tracks'
  | 'preset-definition-management'
  | 'shot-template-management'
  | 'color-style-management'
  | 'character-management'
  | 'location-management'
  | 'equipment-management'
  | 'canvas-structure'
  | 'canvas-graph-and-layout'
  | 'canvas-node-editing'
  | 'provider-management'
  | 'node-provider-selection'
  | 'image-config'
  | 'video-config'
  | 'audio-config'
  | 'script-development'
  | 'vision-analysis'
  | 'snapshot-and-rollback'
  | 'render-and-export'
  | 'workflow-orchestration'
  | 'series-management'
  | 'prompt-template-management'
  | 'asset-library-management'
  | 'job-control';

const PROCESS_CATEGORY_NAMES: Record<ProcessCategory, string> = {
  'character-ref-image-generation': 'Character Reference Image Generation',
  'location-ref-image-generation': 'Location Reference Image Generation',
  'equipment-ref-image-generation': 'Equipment Reference Image Generation',
  'image-node-generation': 'Image Node Generation',
  'video-node-generation': 'Video Node Generation',
  'audio-generation': 'Audio Generation',
  'node-preset-tracks': 'Node Preset Tracks',
  'preset-definition-management': 'Preset Definition Management',
  'shot-template-management': 'Shot Template Management',
  'color-style-management': 'Color Style Management',
  'character-management': 'Character Management',
  'location-management': 'Location Management',
  'equipment-management': 'Equipment Management',
  'canvas-structure': 'Canvas Structure',
  'canvas-graph-and-layout': 'Canvas Graph And Layout',
  'canvas-node-editing': 'Canvas Node Editing',
  'provider-management': 'Provider Management',
  'node-provider-selection': 'Node Provider Selection',
  'image-config': 'Image Config',
  'video-config': 'Video Config',
  'audio-config': 'Audio Config',
  'script-development': 'Script Development',
  'vision-analysis': 'Vision Analysis',
  'snapshot-and-rollback': 'Snapshot And Rollback',
  'render-and-export': 'Render And Export',
  'workflow-orchestration': 'Workflow Orchestration',
  'series-management': 'Series Management',
  'prompt-template-management': 'Prompt Template Management',
  'asset-library-management': 'Asset Library Management',
  'job-control': 'Job Control',
};

const CHARACTER_REF_IMAGE_TOOLS = new Set([
  'character.generateRefImage',
  'character.setRefImage',
  'character.deleteRefImage',
  'character.setRefImageFromNode',
]);

const LOCATION_REF_IMAGE_TOOLS = new Set([
  'location.generateRefImage',
  'location.setRefImage',
  'location.deleteRefImage',
  'location.setRefImageFromNode',
]);

const EQUIPMENT_REF_IMAGE_TOOLS = new Set([
  'equipment.generateRefImage',
  'equipment.setRefImage',
  'equipment.deleteRefImage',
  'equipment.setRefImageFromNode',
]);

const NODE_PRESET_TRACK_TOOLS = new Set([
  'canvas.readNodePresetTracks',
  'canvas.writeNodePresetTracks',
  'canvas.writePresetTracksBatch',
  'canvas.addPresetEntry',
  'canvas.removePresetEntry',
  'canvas.updatePresetEntry',
]);

const SHOT_TEMPLATE_TOOLS = new Set(['canvas.applyShotTemplate']);

const CANVAS_STRUCTURE_TOOLS = new Set([
  'canvas.addNode',
  'canvas.batchCreate',
  'canvas.duplicateNodes',
  'canvas.renameCanvas',
  'canvas.deleteCanvas',
  'canvas.addNote',
  'canvas.updateBackdrop',
  'canvas.importWorkflow',
  'canvas.exportWorkflow',
]);

const CANVAS_GRAPH_AND_LAYOUT_TOOLS = new Set([
  'canvas.connectNodes',
  'canvas.layout',
  'canvas.deleteEdge',
  'canvas.swapEdgeDirection',
  'canvas.disconnectNode',
  'canvas.setVideoFrames',
]);

const CANVAS_NODE_EDITING_TOOLS = new Set([
  'canvas.updateNodes',
  'canvas.setNodeLayout',
  'canvas.setNodeRefs',
  'canvas.selectVariant',
  'canvas.undo',
  'canvas.redo',
]);

const NODE_PROVIDER_SELECTION_TOOLS = new Set([
  'canvas.setNodeProvider',
  'canvas.estimateCost',
]);

const IMAGE_CONFIG_TOOLS = new Set(['canvas.setImageParams']);
const VIDEO_CONFIG_TOOLS = new Set(['canvas.setVideoParams']);
const AUDIO_CONFIG_TOOLS = new Set(['canvas.setAudioParams']);

const SCRIPT_TOOLS = new Set(['script.read', 'script.write', 'script.import']);
const VISION_TOOLS = new Set(['vision.describeImage']);
const SNAPSHOT_TOOLS = new Set(['snapshot.create', 'snapshot.list', 'snapshot.restore']);
const RENDER_TOOLS = new Set(['render.start', 'render.cancel', 'render.exportBundle']);
const WORKFLOW_TOOLS = new Set(['workflow.control', 'workflow.expandIdea']);

function normalizeNodeType(args?: Record<string, unknown>): 'image' | 'video' | 'audio' | null {
  const raw = typeof args?.nodeType === 'string' ? args.nodeType.trim().toLowerCase() : '';
  if (raw === 'image' || raw === 'video' || raw === 'audio') return raw;
  return null;
}

export function detectProcess(
  toolName: string,
  args?: Record<string, unknown>,
): ProcessCategory | null {
  if (CHARACTER_REF_IMAGE_TOOLS.has(toolName)) return 'character-ref-image-generation';
  if (LOCATION_REF_IMAGE_TOOLS.has(toolName)) return 'location-ref-image-generation';
  if (EQUIPMENT_REF_IMAGE_TOOLS.has(toolName)) return 'equipment-ref-image-generation';

  if (toolName === 'canvas.generate') {
    const nodeType = normalizeNodeType(args);
    if (nodeType === 'video') return 'video-node-generation';
    if (nodeType === 'audio') return 'audio-generation';
    return 'image-node-generation';
  }

  if (NODE_PRESET_TRACK_TOOLS.has(toolName)) return 'node-preset-tracks';
  if (toolName.startsWith('preset.')) return 'preset-definition-management';
  if (SHOT_TEMPLATE_TOOLS.has(toolName) || toolName.startsWith('shotTemplate.')) {
    return 'shot-template-management';
  }
  if (toolName.startsWith('colorStyle.')) return 'color-style-management';

  if (toolName.startsWith('character.')) return 'character-management';
  if (toolName.startsWith('location.')) return 'location-management';
  if (toolName.startsWith('equipment.')) return 'equipment-management';

  if (CANVAS_STRUCTURE_TOOLS.has(toolName)) return 'canvas-structure';
  if (CANVAS_GRAPH_AND_LAYOUT_TOOLS.has(toolName)) return 'canvas-graph-and-layout';
  if (CANVAS_NODE_EDITING_TOOLS.has(toolName)) return 'canvas-node-editing';

  if (toolName.startsWith('provider.')) return 'provider-management';
  if (NODE_PROVIDER_SELECTION_TOOLS.has(toolName)) return 'node-provider-selection';
  if (IMAGE_CONFIG_TOOLS.has(toolName)) return 'image-config';
  if (VIDEO_CONFIG_TOOLS.has(toolName)) return 'video-config';
  if (AUDIO_CONFIG_TOOLS.has(toolName)) return 'audio-config';

  if (toolName.startsWith('series.')) return 'series-management';
  if (toolName.startsWith('prompt.')) return 'prompt-template-management';
  if (toolName.startsWith('asset.')) return 'asset-library-management';
  if (toolName.startsWith('job.')) return 'job-control';

  if (SCRIPT_TOOLS.has(toolName)) return 'script-development';
  if (VISION_TOOLS.has(toolName)) return 'vision-analysis';
  if (SNAPSHOT_TOOLS.has(toolName)) return 'snapshot-and-rollback';
  if (RENDER_TOOLS.has(toolName)) return 'render-and-export';
  if (WORKFLOW_TOOLS.has(toolName)) return 'workflow-orchestration';

  return null;
}

export function getProcessCategoryName(processKey: ProcessCategory): string {
  return PROCESS_CATEGORY_NAMES[processKey];
}
