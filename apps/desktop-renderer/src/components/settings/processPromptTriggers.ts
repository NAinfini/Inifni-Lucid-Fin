import { t } from '../../i18n.js';

const PROCESS_PROMPT_TRIGGER_TOOLS: Record<string, string[]> = {
  'entity-ref-image-generation': [
    'entity.generateRefImage',
    'entity.setRefImage',
    'entity.deleteRefImage',
    'entity.setRefImageFromNode',
  ],
  'image-node-generation': ['canvas.generation'],
  'video-node-generation': ['canvas.generation'],
  'audio-generation': ['canvas.generation'],
  'node-preset-tracks': ['canvas.presetTracks'],
  'preset-definition-management': ['preset.manage'],
  'shot-template-management': ['shotTemplate.manage'],
  'color-style-management': ['colorStyle.manage'],
  'entity-management': [
    'entity.create',
    'entity.update',
    'entity.delete',
  ],
  'canvas-structure': [
    'canvas.createNodes',
    'canvas.duplicateNodes',
    'canvas.manage',
    'canvas.deleteCanvas',
    'canvas.addNote',
  ],
  'canvas-graph-and-layout': [
    'canvas.connectNodes',
    'canvas.layout',
    'canvas.manageEdge',
    'canvas.setVideoFrames',
  ],
  'canvas-node-editing': [
    'canvas.updateNodes',
    'canvas.setNodeLayout',
    'canvas.setNodeRefs',
    'canvas.selectVariant',
    'canvas.undo',
    'canvas.redo',
  ],
  'provider-management': ['provider.manage'],
  'node-provider-selection': ['canvas.configureNode', 'canvas.generation'],
  'media-config': ['canvas.setMediaParams'],
  'script-development': ['script.manage', 'script.import'],
  'vision-analysis': ['text.analyze'],
  'snapshot-and-rollback': ['snapshot.create', 'snapshot.list', 'snapshot.restore'],
  'render-and-export': ['render.start', 'render.cancel', 'render.exportBundle'],
  'workflow-orchestration': ['workflow.manage'],
  'series-management': [
    'series.get',
    'series.update',
    'series.addEpisode',
    'series.reorderEpisodes',
  ],
  'prompt-template-management': ['prompt.get', 'prompt.setCustom'],
  'asset-library-management': ['asset.import', 'asset.list'],
  'job-control': ['job.list', 'job.control'],
  'canvas-settings': ['canvas.getInfo', 'canvas.setSettings'],
};

const PROCESS_PROMPT_TRIGGER_NOTE_KEYS: Record<string, string | undefined> = {
  'image-node-generation': 'settings.processGuides.triggerNote.imageNode',
  'video-node-generation': 'settings.processGuides.triggerNote.videoNode',
  'audio-generation': 'settings.processGuides.triggerNote.audioGeneration',
};

export function getProcessPromptTriggerTools(processKey: string): string[] {
  return PROCESS_PROMPT_TRIGGER_TOOLS[processKey] ?? [];
}

export function getProcessPromptTriggerNote(processKey: string): string | null {
  const key = PROCESS_PROMPT_TRIGGER_NOTE_KEYS[processKey];
  if (!key) return null;
  const translated = t(key);
  return translated === key ? null : translated;
}
