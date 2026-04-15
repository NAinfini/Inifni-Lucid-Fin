import { describe, expect, it } from 'vitest';
import { detectProcess, getProcessCategoryName } from './process-detection.js';

describe('detectProcess', () => {
  it('maps entity ref-image tools to ref-image-generation', () => {
    expect(detectProcess('character.generateRefImage')).toBe('ref-image-generation');
    expect(detectProcess('location.generateRefImage')).toBe('ref-image-generation');
    expect(detectProcess('equipment.generateRefImage')).toBe('ref-image-generation');
  });

  it('maps canvas.generate by node type', () => {
    expect(detectProcess('canvas.generate', { nodeType: 'image' })).toBe('image-node-generation');
    expect(detectProcess('canvas.generate', { nodeType: 'video' })).toBe('video-node-generation');
    expect(detectProcess('canvas.generate', { nodeType: 'audio' })).toBe('audio-generation');
  });

  it('defaults canvas.generate to image-node-generation when nodeType is missing or unknown', () => {
    expect(detectProcess('canvas.generate')).toBe('image-node-generation');
    expect(detectProcess('canvas.generate', { nodeType: 'unknown' })).toBe('image-node-generation');
  });

  it('maps preset, entity, canvas workflow, and provider tools', () => {
    expect(detectProcess('canvas.applyShotTemplate')).toBe('preset-and-style');
    expect(detectProcess('preset.list')).toBe('preset-and-style');
    expect(detectProcess('colorStyle.save')).toBe('preset-and-style');
    expect(detectProcess('shotTemplate.update')).toBe('preset-and-style');
    expect(detectProcess('character.create')).toBe('entity-management');
    expect(detectProcess('location.update')).toBe('entity-management');
    expect(detectProcess('canvas.batchCreate')).toBe('canvas-workflow');
    expect(detectProcess('canvas.layout')).toBe('canvas-workflow');
    expect(detectProcess('canvas.setNodeProvider')).toBe('provider-and-config');
    expect(detectProcess('provider.list')).toBe('provider-and-config');
  });

  it('maps script tools to script-development', () => {
    expect(detectProcess('script.read')).toBe('script-development');
    expect(detectProcess('script.write')).toBe('script-development');
    expect(detectProcess('script.import')).toBe('script-development');
  });

  it('maps vision, snapshot, render, and workflow tools to the new process guides', () => {
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

  it('returns null for unrelated tools', () => {
    expect(detectProcess('tool.get')).toBeNull();
    expect(detectProcess('guide.list')).toBeNull();
    expect(detectProcess('series.get')).toBeNull();
  });

  it('exposes stable display names for injected process guides', () => {
    expect(getProcessCategoryName('image-node-generation')).toBe('图像节点生成');
    expect(getProcessCategoryName('provider-and-config')).toBe('供应商与配置');
    expect(getProcessCategoryName('script-development')).toBe('脚本开发');
    expect(getProcessCategoryName('workflow-orchestration')).toBe('工作流编排');
  });
});
