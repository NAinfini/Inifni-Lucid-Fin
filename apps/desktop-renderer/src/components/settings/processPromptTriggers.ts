import { t } from '../../i18n.js';

const PROCESS_PROMPT_TRIGGER_TOOLS: Record<string, string[]> = {
  'character-ref-image-generation': [
    'character.generateRefImage',
    'character.setRefImage',
    'character.deleteRefImage',
    'character.setRefImageFromNode',
  ],
  'location-ref-image-generation': [
    'location.generateRefImage',
    'location.setRefImage',
    'location.deleteRefImage',
    'location.setRefImageFromNode',
  ],
  'equipment-ref-image-generation': [
    'equipment.generateRefImage',
    'equipment.setRefImage',
    'equipment.deleteRefImage',
    'equipment.setRefImageFromNode',
  ],
  'image-node-generation': ['canvas.generate'],
  'video-node-generation': ['canvas.generate'],
  'audio-voice': ['canvas.generate'],
  'audio-music': ['canvas.generate'],
  'audio-sfx': ['canvas.generate'],
  'node-preset-tracks': [
    'canvas.readNodePresetTracks',
    'canvas.writeNodePresetTracks',
    'canvas.writePresetTracksBatch',
    'canvas.addPresetEntry',
    'canvas.removePresetEntry',
    'canvas.updatePresetEntry',
  ],
  'preset-definition-management': ['preset.*'],
  'shot-template-management': ['canvas.applyShotTemplate', 'shotTemplate.*'],
  'color-style-management': ['colorStyle.*'],
  'character-management': ['character.create', 'character.update', 'character.delete'],
  'location-management': ['location.create', 'location.update', 'location.delete'],
  'equipment-management': ['equipment.create', 'equipment.update', 'equipment.delete'],
  'canvas-structure': [
    'canvas.addNode',
    'canvas.batchCreate',
    'canvas.duplicateNodes',
    'canvas.renameCanvas',
    'canvas.deleteCanvas',
    'canvas.addNote',
    'canvas.updateBackdrop',
  ],
  'canvas-graph-and-layout': [
    'canvas.connectNodes',
    'canvas.layout',
    'canvas.deleteEdge',
    'canvas.swapEdgeDirection',
    'canvas.disconnectNode',
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
  'provider-management': ['provider.list', 'provider.getCapabilities', 'provider.setActive'],
  'node-provider-selection': ['canvas.setNodeProvider', 'canvas.estimateCost'],
  'image-config': ['canvas.setImageParams'],
  'video-config': ['canvas.setVideoParams'],
  'audio-config': ['canvas.setAudioParams'],
  'script-development': ['script.read', 'script.write', 'script.import'],
  'vision-analysis': ['vision.describeImage'],
  'snapshot-and-rollback': ['snapshot.create', 'snapshot.list', 'snapshot.restore'],
  'render-and-export': ['render.start', 'render.cancel', 'render.exportBundle'],
  'workflow-orchestration': ['workflow.control', 'workflow.expandIdea'],
  'series-management': [
    'series.get',
    'series.update',
    'series.addEpisode',
    'series.reorderEpisodes',
  ],
  'prompt-template-management': ['prompt.get', 'prompt.setCustom'],
  'asset-library-management': ['asset.import', 'asset.list'],
  'job-control': ['job.list', 'job.control'],
};

const PROCESS_PROMPT_TRIGGER_NOTE_KEYS: Record<string, string | undefined> = {
  'image-node-generation': 'settings.processGuides.triggerNote.imageNode',
  'video-node-generation': 'settings.processGuides.triggerNote.videoNode',
  'audio-voice': 'settings.processGuides.triggerNote.audioVoice',
  'audio-music': 'settings.processGuides.triggerNote.audioMusic',
  'audio-sfx': 'settings.processGuides.triggerNote.audioSfx',
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
