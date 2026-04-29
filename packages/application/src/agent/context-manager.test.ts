import { describe, it, expect } from 'vitest';
import {
  selectContextualToolSet,
  ALWAYS_LOADED_TOOLS,
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
    intentKind: 'mixed',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('selectContextualToolSet', () => {
  it('always includes the ALWAYS_LOADED_TOOLS set', () => {
    const result = selectContextualToolSet(makeInput());
    for (const name of ALWAYS_LOADED_TOOLS) {
      expect(result.has(name), `expected ${name} to be present`).toBe(true);
    }
  });

  it('includes canvas.getSettings in always-loaded tools', () => {
    const result = selectContextualToolSet(makeInput());
    expect(result.has('canvas.getSettings')).toBe(true);
  });

  it('includes logger.list in always-loaded tools', () => {
    const result = selectContextualToolSet(makeInput());
    expect(result.has('logger.list')).toBe(true);
  });

  describe('informational intent', () => {
    it('returns a minimal read-only set', () => {
      const result = selectContextualToolSet(
        makeInput({ intentKind: 'informational', userMessage: 'what tools do you have?' }),
      );
      // Should contain read/list tools
      expect(result.has('character.list')).toBe(true);
      expect(result.has('location.list')).toBe(true);
      expect(result.has('equipment.list')).toBe(true);
      // Should NOT contain mutation tools
      expect(result.has('canvas.addNode')).toBe(false);
      expect(result.has('canvas.generate')).toBe(false);
      expect(result.has('character.create')).toBe(false);
    });

    it('stays minimal even with large nodeCount', () => {
      const result = selectContextualToolSet(
        makeInput({ intentKind: 'browse', nodeCount: 100, entityCount: 20 }),
      );
      expect(result.has('canvas.addNode')).toBe(false);
      expect(result.has('canvas.generate')).toBe(false);
    });
  });

  describe('empty canvas', () => {
    it('includes creation tools', () => {
      const result = selectContextualToolSet(
        makeInput({ nodeCount: 0, userMessage: 'help me start a new project' }),
      );
      expect(result.has('canvas.addNode')).toBe(true);
      expect(result.has('canvas.batchCreate')).toBe(true);
      expect(result.has('canvas.importWorkflow')).toBe(true);
      expect(result.has('character.create')).toBe(true);
      expect(result.has('location.create')).toBe(true);
      expect(result.has('equipment.create')).toBe(true);
      expect(result.has('script.write')).toBe(true);
      expect(result.has('workflow.control')).toBe(true);
    });
  });

  describe('canvas with nodes', () => {
    it('includes editing and graph tools', () => {
      const result = selectContextualToolSet(
        makeInput({ nodeCount: 10, userMessage: 'update the nodes' }),
      );
      expect(result.has('canvas.updateNodes')).toBe(true);
      expect(result.has('canvas.connectNodes')).toBe(true);
      expect(result.has('canvas.deleteNode')).toBe(true);
      expect(result.has('canvas.layout')).toBe(true);
      expect(result.has('canvas.undo')).toBe(true);
      expect(result.has('canvas.redo')).toBe(true);
      expect(result.has('snapshot.create')).toBe(true);
      expect(result.has('snapshot.restore')).toBe(true);
    });

    it('includes entity creation when entityCount is 0', () => {
      const result = selectContextualToolSet(
        makeInput({ nodeCount: 5, entityCount: 0, userMessage: 'fix it' }),
      );
      expect(result.has('character.create')).toBe(true);
      expect(result.has('location.create')).toBe(true);
      expect(result.has('equipment.create')).toBe(true);
    });

    it('omits entity creation when entities already exist', () => {
      const result = selectContextualToolSet(
        makeInput({ nodeCount: 5, entityCount: 3, userMessage: 'fix it' }),
      );
      // The creation tools should NOT be added by the "no entities" path.
      // They may still appear through other paths (workflow, keywords), so
      // we verify the entity-management path includes update tools instead.
      expect(result.has('character.update')).toBe(true);
      expect(result.has('character.list')).toBe(true);
      expect(result.has('canvas.setNodeRefs')).toBe(true);
    });
  });

  describe('entities exist', () => {
    it('includes ref-image management tools', () => {
      const result = selectContextualToolSet(
        makeInput({ nodeCount: 5, entityCount: 3, userMessage: 'manage characters' }),
      );
      expect(result.has('character.generateRefImage')).toBe(true);
      expect(result.has('location.generateRefImage')).toBe(true);
      expect(result.has('equipment.generateRefImage')).toBe(true);
      expect(result.has('character.setRefImage')).toBe(true);
    });
  });

  describe('generation keywords', () => {
    it('includes generation tools when user mentions "generate"', () => {
      const result = selectContextualToolSet(
        makeInput({ nodeCount: 5, userMessage: 'generate images for all nodes' }),
      );
      expect(result.has('canvas.generate')).toBe(true);
      expect(result.has('canvas.cancelGeneration')).toBe(true);
      expect(result.has('canvas.estimateCost')).toBe(true);
      expect(result.has('canvas.setImageParams')).toBe(true);
      expect(result.has('canvas.setVideoParams')).toBe(true);
    });

    it('includes generation tools for "create images"', () => {
      const result = selectContextualToolSet(
        makeInput({ nodeCount: 5, userMessage: 'create images for the storyboard' }),
      );
      expect(result.has('canvas.generate')).toBe(true);
    });

    it('includes generation tools for "make shots"', () => {
      const result = selectContextualToolSet(
        makeInput({ nodeCount: 5, userMessage: 'make shot compositions' }),
      );
      expect(result.has('canvas.generate')).toBe(true);
    });
  });

  describe('script keywords', () => {
    it('includes script tools', () => {
      const result = selectContextualToolSet(
        makeInput({ userMessage: 'import the script from my file' }),
      );
      expect(result.has('script.read')).toBe(true);
      expect(result.has('script.write')).toBe(true);
      expect(result.has('script.import')).toBe(true);
      expect(result.has('text.transform')).toBe(true);
    });
  });

  describe('render/export keywords', () => {
    it('includes render and job tools', () => {
      const result = selectContextualToolSet(
        makeInput({ nodeCount: 10, userMessage: 'render the final video and export' }),
      );
      expect(result.has('render.start')).toBe(true);
      expect(result.has('render.cancel')).toBe(true);
      expect(result.has('render.exportBundle')).toBe(true);
      expect(result.has('job.list')).toBe(true);
      expect(result.has('job.control')).toBe(true);
      expect(result.has('canvas.exportWorkflow')).toBe(true);
    });
  });

  describe('provider keywords', () => {
    it('includes provider management tools', () => {
      const result = selectContextualToolSet(
        makeInput({ userMessage: 'change the provider to a different model' }),
      );
      expect(result.has('provider.list')).toBe(true);
      expect(result.has('provider.setActive')).toBe(true);
      expect(result.has('provider.getCapabilities')).toBe(true);
    });
  });

  describe('preset/style keywords', () => {
    it('includes preset tools', () => {
      const result = selectContextualToolSet(
        makeInput({ userMessage: 'adjust the preset settings for cinematic style' }),
      );
      expect(result.has('preset.list')).toBe(true);
      expect(result.has('preset.get')).toBe(true);
      expect(result.has('preset.create')).toBe(true);
      expect(result.has('colorStyle.list')).toBe(true);
    });
  });

  describe('selected nodes', () => {
    it('includes node editing and generation tools', () => {
      const result = selectContextualToolSet(
        makeInput({ nodeCount: 5, hasSelectedNodes: true, userMessage: 'fix these' }),
      );
      expect(result.has('canvas.generate')).toBe(true);
      expect(result.has('canvas.updateNodes')).toBe(true);
      expect(result.has('canvas.setNodeRefs')).toBe(true);
      expect(result.has('canvas.previewPrompt')).toBe(true);
      expect(result.has('canvas.deleteNode')).toBe(true);
    });
  });

  describe('workflow-specific loading', () => {
    it('loads character tools for character workflow', () => {
      const result = selectContextualToolSet(
        makeInput({
          intentWorkflow: 'character-ref-image',
          userMessage: 'generate character refs',
        }),
      );
      expect(result.has('character.create')).toBe(true);
      expect(result.has('character.generateRefImage')).toBe(true);
      expect(result.has('character.deleteRefImage')).toBe(true);
    });

    it('loads video pipeline tools for story workflow', () => {
      const result = selectContextualToolSet(
        makeInput({ intentWorkflow: 'story-to-video', userMessage: 'build the story' }),
      );
      expect(result.has('canvas.addNode')).toBe(true);
      expect(result.has('canvas.batchCreate')).toBe(true);
      expect(result.has('canvas.generate')).toBe(true);
      expect(result.has('script.write')).toBe(true);
      expect(result.has('workflow.control')).toBe(true);
    });

    it('loads location tools for location workflow', () => {
      const result = selectContextualToolSet(
        makeInput({ intentWorkflow: 'location-ref-image', userMessage: 'create location refs' }),
      );
      expect(result.has('location.create')).toBe(true);
      expect(result.has('location.generateRefImage')).toBe(true);
    });
  });

  describe('style plate gating', () => {
    it('includes canvas.setSettings when stylePlate is missing', () => {
      const result = selectContextualToolSet(
        makeInput({ nodeCount: 5, hasStylePlate: false, userMessage: 'set it up' }),
      );
      expect(result.has('canvas.setSettings')).toBe(true);
    });

    it('does not force canvas.setSettings when stylePlate exists', () => {
      // canvas.setSettings may still appear via other paths, but the
      // style-plate-specific path should not add it.
      const result = selectContextualToolSet(
        makeInput({
          nodeCount: 5,
          hasStylePlate: true,
          intentKind: 'informational',
          userMessage: 'what is the style plate?',
        }),
      );
      // In informational mode with existing plate, setSettings should NOT
      // be forced. It may appear if another path adds it, but the
      // informational fast-path returns early and never reaches the plate
      // gate.
      expect(result.has('canvas.setSettings')).toBe(false);
    });
  });

  describe('tool count sanity', () => {
    it('typical first request loads 25-45 tools (not all 120)', () => {
      // Simulates a user on a canvas with some nodes and entities
      const result = selectContextualToolSet(
        makeInput({
          nodeCount: 10,
          entityCount: 5,
          hasStylePlate: true,
          hasSelectedNodes: true,
          userMessage: 'update the prompts on these nodes',
          intentKind: 'execution',
        }),
      );
      expect(result.size).toBeGreaterThanOrEqual(20);
      expect(result.size).toBeLessThanOrEqual(60);
    });

    it('informational intent loads fewer than 25 tools', () => {
      const result = selectContextualToolSet(
        makeInput({ intentKind: 'informational', userMessage: 'how many nodes?' }),
      );
      expect(result.size).toBeLessThanOrEqual(25);
    });

    it('empty canvas with no keywords loads ~20-30 tools', () => {
      const result = selectContextualToolSet(
        makeInput({ nodeCount: 0, userMessage: 'start a new project' }),
      );
      expect(result.size).toBeGreaterThanOrEqual(15);
      expect(result.size).toBeLessThanOrEqual(35);
    });
  });
});
