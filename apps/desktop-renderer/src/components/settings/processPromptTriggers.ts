const PROCESS_PROMPT_TRIGGER_TOOLS: Record<string, string[]> = {
  'ref-image-generation': [
    'character.generateRefImage',
    'location.generateRefImage',
    'equipment.generateRefImage',
  ],
  'image-node-generation': ['canvas.generate'],
  'video-node-generation': ['canvas.generate'],
  'audio-generation': ['canvas.generate'],
  'preset-and-style': [
    'canvas.applyShotTemplate',
    'canvas.addPresetEntry',
    'canvas.writeNodePresetTracks',
    'preset.*',
    'colorStyle.*',
    'shotTemplate.*',
  ],
  'entity-management': [
    'character.create',
    'character.update',
    'location.create',
    'location.update',
    'equipment.create',
    'equipment.update',
  ],
  'canvas-workflow': [
    'canvas.addNode',
    'canvas.batchCreate',
    'canvas.connectNodes',
    'canvas.layout',
    'canvas.duplicateNodes',
  ],
  'provider-and-config': [
    'canvas.setNodeProvider',
    'canvas.setImageParams',
    'canvas.setVideoParams',
    'canvas.setAudioParams',
    'canvas.estimateCost',
    'provider.*',
  ],
  'script-development': [
    'script.read',
    'script.write',
    'script.import',
  ],
  'vision-analysis': ['vision.describeImage'],
  'snapshot-and-rollback': [
    'snapshot.create',
    'snapshot.list',
    'snapshot.restore',
  ],
  'render-and-export': [
    'render.start',
    'render.cancel',
    'render.exportBundle',
  ],
  'workflow-orchestration': [
    'workflow.control',
    'workflow.expandIdea',
  ],
};

const PROCESS_PROMPT_TRIGGER_NOTES: Record<string, string | undefined> = {
  'image-node-generation': 'nodeType !== video/audio',
  'video-node-generation': 'nodeType === video',
  'audio-generation': 'nodeType === audio',
};

export function getProcessPromptTriggerTools(processKey: string): string[] {
  return PROCESS_PROMPT_TRIGGER_TOOLS[processKey] ?? [];
}

export function getProcessPromptTriggerNote(processKey: string): string | null {
  return PROCESS_PROMPT_TRIGGER_NOTES[processKey] ?? null;
}
