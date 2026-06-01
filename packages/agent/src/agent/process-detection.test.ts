import { describe, expect, it } from 'vitest';
import { detectProcess, getProcessCategoryName } from './process-detection.js';

describe('detectProcess', () => {
  it('maps entity ref-image tools to unified entity-ref-image-generation process prompt', () => {
    expect(detectProcess('entity.generateRefImage')).toBe('entity-ref-image-generation');
    expect(detectProcess('entity.setRefImage')).toBe('entity-ref-image-generation');
    expect(detectProcess('entity.deleteRefImage')).toBe('entity-ref-image-generation');
    expect(detectProcess('entity.setRefImageFromNode')).toBe('entity-ref-image-generation');
  });

  it('maps canvas.generation by node type', () => {
    expect(detectProcess('canvas.generation', { nodeType: 'image' })).toBe('image-node-generation');
    expect(detectProcess('canvas.generation', { nodeType: 'video' })).toBe('video-node-generation');
    // Audio without audioType defaults to audio-generation.
    expect(detectProcess('canvas.generation', { nodeType: 'audio' })).toBe('audio-generation');
  });

  it('routes canvas.generation audio to unified audio-generation', () => {
    expect(detectProcess('canvas.generation', { nodeType: 'audio', audioType: 'voice' })).toBe(
      'audio-generation',
    );
    expect(detectProcess('canvas.generation', { nodeType: 'audio', audioType: 'music' })).toBe(
      'audio-generation',
    );
    expect(detectProcess('canvas.generation', { nodeType: 'audio', audioType: 'sfx' })).toBe(
      'audio-generation',
    );
    // Unknown audioType falls back to audio-generation.
    expect(detectProcess('canvas.generation', { nodeType: 'audio', audioType: 'unknown' })).toBe(
      'audio-generation',
    );
    // audioType without audio nodeType is ignored.
    expect(detectProcess('canvas.generation', { nodeType: 'image', audioType: 'music' })).toBe(
      'image-node-generation',
    );
  });

  it('defaults canvas.generation to image-node-generation when nodeType is missing or unknown', () => {
    expect(detectProcess('canvas.generation')).toBe('image-node-generation');
    expect(detectProcess('canvas.generation', { nodeType: 'unknown' })).toBe('image-node-generation');
  });

  it('maps preset, style, and template tools into split preset categories', () => {
    expect(detectProcess('canvas.presetTracks')).toBe('node-preset-tracks');
    expect(detectProcess('canvas.presetTracks')).toBe('node-preset-tracks');
    expect(detectProcess('canvas.presetTracks')).toBe('node-preset-tracks');
    expect(detectProcess('canvas.presetTracks')).toBe('node-preset-tracks');
    expect(detectProcess('canvas.presetTracks')).toBe('node-preset-tracks');
    expect(detectProcess('canvas.presetTracks')).toBe('node-preset-tracks');
    expect(detectProcess('canvas.presetTracks')).toBe('node-preset-tracks');
    expect(detectProcess('preset.manage')).toBe('preset-definition-management');
    expect(detectProcess('preset.manage')).toBe('preset-definition-management');
    expect(detectProcess('colorStyle.manage')).toBe('color-style-management');
    expect(detectProcess('shotTemplate.manage')).toBe('shot-template-management');
  });

  it('maps entity and series tools into domain-specific management categories', () => {
    expect(detectProcess('entity.list')).toBe('entity-management');
    expect(detectProcess('entity.create')).toBe('entity-management');
    expect(detectProcess('entity.update')).toBe('entity-management');
    expect(detectProcess('entity.delete')).toBe('entity-management');
    expect(detectProcess('series.get')).toBe('series-management');
    expect(detectProcess('series.update')).toBe('series-management');
    expect(detectProcess('series.addEpisode')).toBe('series-management');
    expect(detectProcess('series.reorderEpisodes')).toBe('series-management');
  });

  it('maps canvas tools into split workflow categories', () => {
    expect(detectProcess('canvas.createNodes')).toBe('canvas-structure');
    expect(detectProcess('canvas.createNodes')).toBe('canvas-structure');
    expect(detectProcess('canvas.manage')).toBe('canvas-structure');
    expect(detectProcess('canvas.deleteCanvas')).toBe('canvas-structure');
    expect(detectProcess('canvas.addNote')).toBe('canvas-structure');
    expect(detectProcess('canvas.manage')).toBe('canvas-structure');

    expect(detectProcess('canvas.connectNodes')).toBe('canvas-graph-and-layout');
    expect(detectProcess('canvas.layout')).toBe('canvas-graph-and-layout');
    expect(detectProcess('canvas.manageEdge')).toBe('canvas-graph-and-layout');
    expect(detectProcess('canvas.manageEdge')).toBe('canvas-graph-and-layout');
    expect(detectProcess('canvas.manageEdge')).toBe('canvas-graph-and-layout');
    expect(detectProcess('canvas.setVideoFrames')).toBe('canvas-graph-and-layout');

    expect(detectProcess('canvas.updateNodes')).toBe('canvas-node-editing');
    expect(detectProcess('canvas.setNodeLayout')).toBe('canvas-node-editing');
    expect(detectProcess('canvas.setNodeRefs')).toBe('canvas-node-editing');
    expect(detectProcess('canvas.selectVariant')).toBe('canvas-node-editing');
    expect(detectProcess('canvas.undo')).toBe('canvas-node-editing');
    expect(detectProcess('canvas.redo')).toBe('canvas-node-editing');
  });

  it('maps provider and media config tools into split provider categories', () => {
    expect(detectProcess('provider.manage')).toBe('provider-management');
    expect(detectProcess('provider.manage')).toBe('provider-management');
    expect(detectProcess('provider.manage')).toBe('provider-management');
    expect(detectProcess('canvas.configureNode')).toBe('node-provider-selection');
    expect(detectProcess('canvas.generation')).toBe('image-node-generation');
    expect(detectProcess('canvas.setMediaParams')).toBe('media-config');
    expect(detectProcess('canvas.setMediaParams')).toBe('media-config');
    expect(detectProcess('canvas.setMediaParams')).toBe('media-config');
  });

  it('maps prompt, asset, job, vision, snapshot, render, and workflow tools', () => {
    expect(detectProcess('prompt.get')).toBe('prompt-template-management');
    expect(detectProcess('prompt.setCustom')).toBe('prompt-template-management');
    expect(detectProcess('asset.import')).toBe('asset-library-management');
    expect(detectProcess('asset.list')).toBe('asset-library-management');
    expect(detectProcess('job.list')).toBe('job-control');
    expect(detectProcess('job.control')).toBe('job-control');
    expect(detectProcess('script.manage')).toBe('script-development');
    expect(detectProcess('script.manage')).toBe('script-development');
    expect(detectProcess('script.import')).toBe('script-development');
    expect(detectProcess('text.analyze')).toBe('vision-analysis');
    expect(detectProcess('snapshot.create')).toBe('snapshot-and-rollback');
    expect(detectProcess('snapshot.list')).toBe('snapshot-and-rollback');
    expect(detectProcess('snapshot.restore')).toBe('snapshot-and-rollback');
    expect(detectProcess('render.start')).toBe('render-and-export');
    expect(detectProcess('render.cancel')).toBe('render-and-export');
    expect(detectProcess('render.exportBundle')).toBe('render-and-export');
    expect(detectProcess('workflow.manage')).toBe('workflow-orchestration');
    expect(detectProcess('workflow.manage')).toBe('workflow-orchestration');
  });

  it('returns null for unrelated or nonexistent tools', () => {
    expect(detectProcess('tool.get')).toBeNull();
    expect(detectProcess('guide.list')).toBeNull();
    expect(detectProcess('scene.create')).toBeNull();
  });

  it('exposes stable display name for unified entity ref-image guide', () => {
    expect(getProcessCategoryName('entity-ref-image-generation')).toBe(
      'Entity Reference Image Generation',
    );
  });

  it('exposes stable display names for new injected process guides', () => {
    expect(getProcessCategoryName('node-preset-tracks')).toBe('Node Preset Tracks');
    expect(getProcessCategoryName('canvas-node-editing')).toBe('Canvas Node Editing');
    expect(getProcessCategoryName('provider-management')).toBe('Provider Management');
    expect(getProcessCategoryName('series-management')).toBe('Series Management');
    expect(getProcessCategoryName('prompt-template-management')).toBe('Prompt Template Management');
  });
});
