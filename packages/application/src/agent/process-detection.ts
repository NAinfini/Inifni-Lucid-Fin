export type ProcessCategory =
  | 'ref-image-generation'
  | 'image-node-generation'
  | 'video-node-generation'
  | 'audio-generation'
  | 'preset-and-style'
  | 'entity-management'
  | 'canvas-workflow'
  | 'provider-and-config'
  | 'script-development'
  | 'vision-analysis'
  | 'snapshot-and-rollback'
  | 'render-and-export'
  | 'workflow-orchestration';

const PROCESS_CATEGORY_NAMES: Record<ProcessCategory, string> = {
  'ref-image-generation': '参考图生成',
  'image-node-generation': '图像节点生成',
  'video-node-generation': '视频节点生成',
  'audio-generation': '音频生成',
  'preset-and-style': '预设与风格',
  'entity-management': '实体管理',
  'canvas-workflow': '画布工作流',
  'provider-and-config': '供应商与配置',
  'script-development': '脚本开发',
  'vision-analysis': '视觉分析',
  'snapshot-and-rollback': '快照与回滚',
  'render-and-export': '渲染与导出',
  'workflow-orchestration': '工作流编排',
};

const REF_IMAGE_TOOLS = new Set([
  'character.generateRefImage',
  'location.generateRefImage',
  'equipment.generateRefImage',
]);

const PRESET_PREFIXES = ['preset.', 'colorStyle.', 'shotTemplate.'];
const PRESET_TOOLS = new Set([
  'canvas.applyShotTemplate',
  'canvas.addPresetEntry',
  'canvas.writeNodePresetTracks',
]);

const ENTITY_TOOLS = new Set([
  'character.create',
  'character.update',
  'location.create',
  'location.update',
  'equipment.create',
  'equipment.update',
]);

const CANVAS_WORKFLOW_TOOLS = new Set([
  'canvas.addNode',
  'canvas.batchCreate',
  'canvas.connectNodes',
  'canvas.layout',
  'canvas.duplicateNodes',
]);

const PROVIDER_TOOLS = new Set([
  'canvas.setNodeProvider',
  'canvas.setImageParams',
  'canvas.setVideoParams',
  'canvas.setAudioParams',
  'canvas.estimateCost',
]);

const SCRIPT_TOOLS = new Set([
  'script.read',
  'script.write',
  'script.import',
]);

const VISION_TOOLS = new Set(['vision.describeImage']);

const SNAPSHOT_TOOLS = new Set([
  'snapshot.create',
  'snapshot.list',
  'snapshot.restore',
]);

const RENDER_TOOLS = new Set([
  'render.start',
  'render.cancel',
  'render.exportBundle',
]);

const WORKFLOW_TOOLS = new Set([
  'workflow.control',
  'workflow.expandIdea',
]);

function normalizeNodeType(args?: Record<string, unknown>): 'image' | 'video' | 'audio' | null {
  const raw = typeof args?.nodeType === 'string' ? args.nodeType.trim().toLowerCase() : '';
  if (raw === 'image' || raw === 'video' || raw === 'audio') return raw;
  return null;
}

export function detectProcess(
  toolName: string,
  args?: Record<string, unknown>,
): ProcessCategory | null {
  if (REF_IMAGE_TOOLS.has(toolName)) return 'ref-image-generation';

  if (toolName === 'canvas.generate') {
    const nodeType = normalizeNodeType(args);
    if (nodeType === 'video') return 'video-node-generation';
    if (nodeType === 'audio') return 'audio-generation';
    return 'image-node-generation';
  }

  if (PRESET_TOOLS.has(toolName) || PRESET_PREFIXES.some((prefix) => toolName.startsWith(prefix))) {
    return 'preset-and-style';
  }

  if (ENTITY_TOOLS.has(toolName)) return 'entity-management';

  if (CANVAS_WORKFLOW_TOOLS.has(toolName)) return 'canvas-workflow';

  if (PROVIDER_TOOLS.has(toolName) || toolName.startsWith('provider.')) {
    return 'provider-and-config';
  }

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
