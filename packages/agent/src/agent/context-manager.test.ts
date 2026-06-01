import { describe, it, expect } from 'vitest';
import {
  selectContextualToolSet,
  ALWAYS_LOADED_TOOLS,
  TIER_A_TOOLS,
  type ToolSelectionInput,
} from './context-manager.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeInput(overrides: Partial<ToolSelectionInput> = {}): ToolSelectionInput {
  return {
    nodeCount: 0,
    entityCount: 0,
    hasStylePlate: false,
    hasSelectedNodes: false,
    userMessage: '',
    intentKind: 'execution',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('selectContextualToolSet', () => {
  it('always includes every TIER_A tool', () => {
    const result = selectContextualToolSet(makeInput());
    for (const name of TIER_A_TOOLS) {
      expect(result.has(name), `expected ${name} to be present`).toBe(true);
    }
  });

  it('ALWAYS_LOADED_TOOLS alias equals TIER_A_TOOLS', () => {
    expect(ALWAYS_LOADED_TOOLS).toBe(TIER_A_TOOLS);
  });

  it('returns exactly TIER_A_TOOLS count', () => {
    const result = selectContextualToolSet(makeInput());
    expect(result.size).toBe(TIER_A_TOOLS.length);
  });

  it('includes canvas read tools', () => {
    const result = selectContextualToolSet(makeInput());
    expect(result.has('canvas.getInfo')).toBe(true);
    expect(result.has('canvas.listNodes')).toBe(true);
    expect(result.has('canvas.getNode')).toBe(true);
    expect(result.has('canvas.listEdges')).toBe(true);
  });

  it('includes canvas write tools', () => {
    const result = selectContextualToolSet(makeInput());
    expect(result.has('canvas.createNodes')).toBe(true);
    expect(result.has('canvas.updateNodes')).toBe(true);
    expect(result.has('canvas.deleteNode')).toBe(true);
    expect(result.has('canvas.connectNodes')).toBe(true);
    expect(result.has('canvas.manageEdge')).toBe(true);
    expect(result.has('canvas.layout')).toBe(true);
    expect(result.has('canvas.manage')).toBe(true);
    expect(result.has('canvas.setSettings')).toBe(true);
    expect(result.has('canvas.setNodeRefs')).toBe(true);
    expect(result.has('canvas.selectVariant')).toBe(true);
    expect(result.has('canvas.configureNode')).toBe(true);
  });

  it('includes canvas generation tools', () => {
    const result = selectContextualToolSet(makeInput());
    expect(result.has('canvas.generation')).toBe(true);
    expect(result.has('canvas.setMediaParams')).toBe(true);
    expect(result.has('canvas.previewPrompt')).toBe(true);
    expect(result.has('canvas.presetTracks')).toBe(true);
  });

  it('includes entity tools', () => {
    const result = selectContextualToolSet(makeInput());
    expect(result.has('entity.list')).toBe(true);
    expect(result.has('entity.create')).toBe(true);
    expect(result.has('entity.update')).toBe(true);
    expect(result.has('entity.delete')).toBe(true);
    expect(result.has('entity.generateRefImage')).toBe(true);
    expect(result.has('entity.setRefImage')).toBe(true);
    expect(result.has('entity.setRefImageFromNode')).toBe(true);
  });

  it('includes meta tools', () => {
    const result = selectContextualToolSet(makeInput());
    expect(result.has('tool.get')).toBe(true);
    expect(result.has('tool.compact')).toBe(true);
    expect(result.has('commander.askUser')).toBe(true);
    expect(result.has('guide.get')).toBe(true);
    expect(result.has('todo.manage')).toBe(true);
  });

  it('includes domain manage tools', () => {
    const result = selectContextualToolSet(makeInput());
    expect(result.has('preset.manage')).toBe(true);
    expect(result.has('shotTemplate.manage')).toBe(true);
    expect(result.has('provider.manage')).toBe(true);
    expect(result.has('script.manage')).toBe(true);
    expect(result.has('workflow.manage')).toBe(true);
    expect(result.has('text.analyze')).toBe(true);
  });

  it('returns the same set regardless of input', () => {
    const empty = selectContextualToolSet(makeInput());
    const info = selectContextualToolSet(makeInput({ intentKind: 'informational' }));
    const full = selectContextualToolSet(
      makeInput({
        nodeCount: 100,
        entityCount: 50,
        hasStylePlate: true,
        hasSelectedNodes: true,
        userMessage: 'generate images for all nodes',
      }),
    );
    expect([...empty].sort()).toEqual([...info].sort());
    expect([...empty].sort()).toEqual([...full].sort());
  });

  it('does NOT include discoverable-only tools', () => {
    const result = selectContextualToolSet(makeInput());
    expect(result.has('render.start')).toBe(false);
    expect(result.has('render.cancel')).toBe(false);
    expect(result.has('series.get')).toBe(false);
    expect(result.has('job.list')).toBe(false);
    expect(result.has('asset.import')).toBe(false);
    expect(result.has('canvas.importWorkflow')).toBe(false);
    expect(result.has('canvas.undo')).toBe(false);
    expect(result.has('canvas.redo')).toBe(false);
    expect(result.has('logger.list')).toBe(false);
    expect(result.has('provider.setKey')).toBe(false);
    // Downgraded from Tier A to discoverable:
    expect(result.has('canvas.duplicateNodes')).toBe(false);
    expect(result.has('canvas.setVideoFrames')).toBe(false);
    expect(result.has('entity.deleteRefImage')).toBe(false);
    expect(result.has('snapshot.create')).toBe(false);
    expect(result.has('snapshot.list')).toBe(false);
    expect(result.has('snapshot.restore')).toBe(false);
    expect(result.has('prompt.get')).toBe(false);
    expect(result.has('prompt.setCustom')).toBe(false);
  });
});
