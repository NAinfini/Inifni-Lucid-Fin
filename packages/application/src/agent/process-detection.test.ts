import { describe, expect, it } from 'vitest';
import { detectProcess, getProcessCategoryName } from './process-detection.js';

describe('detectProcess', () => {
  it('maps entity ref-image tools and maintenance tools to split ref-image process prompts', () => {
    expect(detectProcess('character.generateRefImage')).toBe('character-ref-image-generation');
    expect(detectProcess('character.setRefImage')).toBe('character-ref-image-generation');
    expect(detectProcess('character.deleteRefImage')).toBe('character-ref-image-generation');
    expect(detectProcess('character.setRefImageFromNode')).toBe(
      'character-ref-image-generation',
    );

    expect(detectProcess('location.generateRefImage')).toBe('location-ref-image-generation');
    expect(detectProcess('location.setRefImage')).toBe('location-ref-image-generation');
    expect(detectProcess('location.deleteRefImage')).toBe('location-ref-image-generation');
    expect(detectProcess('location.setRefImageFromNode')).toBe(
      'location-ref-image-generation',
    );

    expect(detectProcess('equipment.generateRefImage')).toBe(
      'equipment-ref-image-generation',
    );
    expect(detectProcess('equipment.setRefImage')).toBe('equipment-ref-image-generation');
    expect(detectProcess('equipment.deleteRefImage')).toBe(
      'equipment-ref-image-generation',
    );
    expect(detectProcess('equipment.setRefImageFromNode')).toBe(
      'equipment-ref-image-generation',
    );
  });

  it('maps canvas.generate by node type', () => {
    expect(detectProcess('canvas.generate', { nodeType: 'image' })).toBe(
      'image-node-generation',
    );
    expect(detectProcess('canvas.generate', { nodeType: 'video' })).toBe(
      'video-node-generation',
    );
    expect(detectProcess('canvas.generate', { nodeType: 'audio' })).toBe('audio-generation');
  });

  it('defaults canvas.generate to image-node-generation when nodeType is missing or unknown', () => {
    expect(detectProcess('canvas.generate')).toBe('image-node-generation');
    expect(detectProcess('canvas.generate', { nodeType: 'unknown' })).toBe(
      'image-node-generation',
    );
  });

  it('maps preset, style, and template tools into split preset categories', () => {
    expect(detectProcess('canvas.readNodePresetTracks')).toBe('node-preset-tracks');
    expect(detectProcess('canvas.writeNodePresetTracks')).toBe('node-preset-tracks');
    expect(detectProcess('canvas.writePresetTracksBatch')).toBe('node-preset-tracks');
    expect(detectProcess('canvas.addPresetEntry')).toBe('node-preset-tracks');
    expect(detectProcess('canvas.removePresetEntry')).toBe('node-preset-tracks');
    expect(detectProcess('canvas.updatePresetEntry')).toBe('node-preset-tracks');
    expect(detectProcess('canvas.applyShotTemplate')).toBe('shot-template-management');
    expect(detectProcess('preset.list')).toBe('preset-definition-management');
    expect(detectProcess('preset.update')).toBe('preset-definition-management');
    expect(detectProcess('colorStyle.save')).toBe('color-style-management');
    expect(detectProcess('shotTemplate.update')).toBe('shot-template-management');
  });

  it('maps entity and series tools into domain-specific management categories', () => {
    expect(detectProcess('character.create')).toBe('character-management');
    expect(detectProcess('character.update')).toBe('character-management');
    expect(detectProcess('character.delete')).toBe('character-management');
    expect(detectProcess('location.create')).toBe('location-management');
    expect(detectProcess('location.update')).toBe('location-management');
    expect(detectProcess('location.delete')).toBe('location-management');
    expect(detectProcess('equipment.create')).toBe('equipment-management');
    expect(detectProcess('equipment.update')).toBe('equipment-management');
    expect(detectProcess('equipment.delete')).toBe('equipment-management');
    expect(detectProcess('series.get')).toBe('series-management');
    expect(detectProcess('series.update')).toBe('series-management');
    expect(detectProcess('series.addEpisode')).toBe('series-management');
    expect(detectProcess('series.reorderEpisodes')).toBe('series-management');
  });

  it('maps canvas tools into split workflow categories', () => {
    expect(detectProcess('canvas.addNode')).toBe('canvas-structure');
    expect(detectProcess('canvas.batchCreate')).toBe('canvas-structure');
    expect(detectProcess('canvas.renameCanvas')).toBe('canvas-structure');
    expect(detectProcess('canvas.deleteCanvas')).toBe('canvas-structure');
    expect(detectProcess('canvas.addNote')).toBe('canvas-structure');
    expect(detectProcess('canvas.updateBackdrop')).toBe('canvas-structure');

    expect(detectProcess('canvas.connectNodes')).toBe('canvas-graph-and-layout');
    expect(detectProcess('canvas.layout')).toBe('canvas-graph-and-layout');
    expect(detectProcess('canvas.deleteEdge')).toBe('canvas-graph-and-layout');
    expect(detectProcess('canvas.swapEdgeDirection')).toBe('canvas-graph-and-layout');
    expect(detectProcess('canvas.disconnectNode')).toBe('canvas-graph-and-layout');
    expect(detectProcess('canvas.setVideoFrames')).toBe('canvas-graph-and-layout');

    expect(detectProcess('canvas.updateNodes')).toBe('canvas-node-editing');
    expect(detectProcess('canvas.setNodeLayout')).toBe('canvas-node-editing');
    expect(detectProcess('canvas.setNodeRefs')).toBe('canvas-node-editing');
    expect(detectProcess('canvas.selectVariant')).toBe('canvas-node-editing');
    expect(detectProcess('canvas.undo')).toBe('canvas-node-editing');
    expect(detectProcess('canvas.redo')).toBe('canvas-node-editing');
  });

  it('maps provider and media config tools into split provider categories', () => {
    expect(detectProcess('provider.list')).toBe('provider-management');
    expect(detectProcess('provider.getCapabilities')).toBe('provider-management');
    expect(detectProcess('provider.setActive')).toBe('provider-management');
    expect(detectProcess('canvas.setNodeProvider')).toBe('node-provider-selection');
    expect(detectProcess('canvas.estimateCost')).toBe('node-provider-selection');
    expect(detectProcess('canvas.setImageParams')).toBe('image-config');
    expect(detectProcess('canvas.setVideoParams')).toBe('video-config');
    expect(detectProcess('canvas.setAudioParams')).toBe('audio-config');
  });

  it('maps prompt, asset, job, vision, snapshot, render, and workflow tools', () => {
    expect(detectProcess('prompt.get')).toBe('prompt-template-management');
    expect(detectProcess('prompt.setCustom')).toBe('prompt-template-management');
    expect(detectProcess('asset.import')).toBe('asset-library-management');
    expect(detectProcess('asset.list')).toBe('asset-library-management');
    expect(detectProcess('job.list')).toBe('job-control');
    expect(detectProcess('job.control')).toBe('job-control');
    expect(detectProcess('script.read')).toBe('script-development');
    expect(detectProcess('script.write')).toBe('script-development');
    expect(detectProcess('script.import')).toBe('script-development');
    expect(detectProcess('vision.describeImage')).toBe('vision-analysis');
    expect(detectProcess('snapshot.create')).toBe('snapshot-and-rollback');
    expect(detectProcess('snapshot.list')).toBe('snapshot-and-rollback');
    expect(detectProcess('snapshot.restore')).toBe('snapshot-and-rollback');
    expect(detectProcess('render.start')).toBe('render-and-export');
    expect(detectProcess('render.cancel')).toBe('render-and-export');
    expect(detectProcess('render.exportBundle')).toBe('render-and-export');
    expect(detectProcess('workflow.control')).toBe('workflow-orchestration');
    expect(detectProcess('workflow.expandIdea')).toBe('workflow-orchestration');
  });

  it('returns null for unrelated or nonexistent tools', () => {
    expect(detectProcess('tool.get')).toBeNull();
    expect(detectProcess('guide.list')).toBeNull();
    expect(detectProcess('scene.create')).toBeNull();
  });

  it('exposes stable display names for split ref-image guides', () => {
    expect(getProcessCategoryName('character-ref-image-generation')).toBe(
      'Character Reference Image Generation',
    );
    expect(getProcessCategoryName('location-ref-image-generation')).toBe(
      'Location Reference Image Generation',
    );
    expect(getProcessCategoryName('equipment-ref-image-generation')).toBe(
      'Equipment Reference Image Generation',
    );
  });

  it('exposes stable display names for new injected process guides', () => {
    expect(getProcessCategoryName('node-preset-tracks')).toBe('Node Preset Tracks');
    expect(getProcessCategoryName('canvas-node-editing')).toBe('Canvas Node Editing');
    expect(getProcessCategoryName('provider-management')).toBe('Provider Management');
    expect(getProcessCategoryName('series-management')).toBe('Series Management');
    expect(getProcessCategoryName('prompt-template-management')).toBe(
      'Prompt Template Management',
    );
  });
});
