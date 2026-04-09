import type { CanvasEdge } from '@lucid-fin/contracts';
import type { AgentTool, CanvasToolDeps } from './canvas-tool-utils.js';
import {
  CANVAS_CONTEXT,
  ok,
  fail,
  requireString,
  requireText,
  requireStringArray,
  requireNumber,
  requireCanvas,
  requireNode,
  requireCanvasEdge,
  requireMediaNode,
  requireVisualGenerationNode,
} from './canvas-tool-utils.js';

export function createCanvasGenerationTools(deps: CanvasToolDeps): AgentTool[] {
  const generate: AgentTool = {
    name: 'canvas.generate',
    description: 'Trigger media generation for an image, video, or audio node.',
    context: CANVAS_CONTEXT,
    tier: 3,
    parameters: {
      type: 'object',
      properties: {
        canvasId: { type: 'string', description: 'The target canvas ID.' },
        nodeId: { type: 'string', description: 'The node ID to generate.' },
        providerId: { type: 'string', description: 'Optional provider override.' },
        variantCount: { type: 'number', description: 'Optional number of variants to generate.' },
      },
      required: ['canvasId', 'nodeId'],
    },
    async execute(args) {
      try {
        const canvasId = requireString(args, 'canvasId');
        const nodeId = requireString(args, 'nodeId');
        await requireNode(deps, canvasId, nodeId);
        const providerId =
          typeof args.providerId === 'string' && args.providerId.trim().length > 0
            ? args.providerId.trim()
            : undefined;
        const variantCount =
          typeof args.variantCount === 'number' ? Math.round(args.variantCount) : undefined;
        await deps.triggerGeneration(canvasId, nodeId, providerId, variantCount);
        return ok({ nodeId, providerId, variantCount });
      } catch (error) {
        return fail(error);
      }
    },
  };

  const cancelGeneration: AgentTool = {
    name: 'canvas.cancelGeneration',
    description: 'Cancel an active generation job for an image, video, or audio node.',
    context: CANVAS_CONTEXT,
    tier: 3,
    parameters: {
      type: 'object',
      properties: {
        canvasId: { type: 'string', description: 'The target canvas ID.' },
        nodeId: { type: 'string', description: 'The node ID whose generation should be cancelled.' },
      },
      required: ['canvasId', 'nodeId'],
    },
    async execute(args) {
      try {
        const canvasId = requireString(args, 'canvasId');
        const nodeId = requireString(args, 'nodeId');
        const { node } = await requireNode(deps, canvasId, nodeId);
        requireMediaNode(node);
        await deps.cancelGeneration(canvasId, nodeId);
        return ok({ nodeId });
      } catch (error) {
        return fail(error);
      }
    },
  };

  const setSeed: AgentTool = {
    name: 'canvas.setSeed',
    description: 'Set the seed value on one or more image, video, or audio nodes.',
    context: CANVAS_CONTEXT,
    tier: 2,
    parameters: {
      type: 'object',
      properties: {
        canvasId: { type: 'string', description: 'The target canvas ID.' },
        nodeIds: {
          type: 'array',
          description: 'The node IDs to update.',
          items: { type: 'string', description: 'A node ID.' },
        },
        seed: { type: 'number', description: 'The seed value to assign.' },
      },
      required: ['canvasId', 'nodeIds', 'seed'],
    },
    async execute(args) {
      try {
        const canvasId = requireString(args, 'canvasId');
        const nodeIds = requireStringArray(args, 'nodeIds');
        const seed = Math.round(requireNumber(args, 'seed'));

        for (const nodeId of nodeIds) {
          const { node } = await requireNode(deps, canvasId, nodeId);
          requireMediaNode(node);
          await deps.updateNodeData(canvasId, nodeId, { seed });
        }

        return ok({ nodeIds, seed });
      } catch (error) {
        return fail(error);
      }
    },
  };

  const setVariantCount: AgentTool = {
    name: 'canvas.setVariantCount',
    description: 'Set the variant count on one or more image or video nodes.',
    context: CANVAS_CONTEXT,
    tier: 2,
    parameters: {
      type: 'object',
      properties: {
        canvasId: { type: 'string', description: 'The target canvas ID.' },
        nodeIds: {
          type: 'array',
          description: 'The node IDs to update.',
          items: { type: 'string', description: 'A node ID.' },
        },
        count: {
          type: 'number',
          description: 'The variant count to assign.',
        },
      },
      required: ['canvasId', 'nodeIds', 'count'],
    },
    async execute(args) {
      try {
        const canvasId = requireString(args, 'canvasId');
        const nodeIds = requireStringArray(args, 'nodeIds');
        const count = Math.round(requireNumber(args, 'count'));
        if (![1, 2, 4, 9].includes(count)) {
          throw new Error('count must be one of 1, 2, 4, or 9');
        }

        for (const nodeId of nodeIds) {
          const { node } = await requireNode(deps, canvasId, nodeId);
          requireVisualGenerationNode(node);
          await deps.updateNodeData(canvasId, nodeId, { variantCount: count });
        }

        return ok({ nodeIds, count });
      } catch (error) {
        return fail(error);
      }
    },
  };

  const setNodeColorTag: AgentTool = {
    name: 'canvas.setNodeColorTag',
    description: 'Set the color tag for a node.',
    context: CANVAS_CONTEXT,
    tier: 2,
    parameters: {
      type: 'object',
      properties: {
        canvasId: { type: 'string', description: 'The target canvas ID.' },
        nodeId: { type: 'string', description: 'The node ID to update.' },
        color: { type: 'string', description: 'The color tag to assign.' },
      },
      required: ['canvasId', 'nodeId', 'color'],
    },
    async execute(args) {
      try {
        const canvasId = requireString(args, 'canvasId');
        const nodeId = requireString(args, 'nodeId');
        const color = requireString(args, 'color');
        await requireNode(deps, canvasId, nodeId);
        await deps.setNodeColorTag(canvasId, nodeId, color);
        return ok({ nodeId, color });
      } catch (error) {
        return fail(error);
      }
    },
  };

  const toggleSeedLock: AgentTool = {
    name: 'canvas.toggleSeedLock',
    description: 'Toggle the seed lock state for an image, video, or audio node.',
    context: CANVAS_CONTEXT,
    tier: 2,
    parameters: {
      type: 'object',
      properties: {
        canvasId: { type: 'string', description: 'The target canvas ID.' },
        nodeId: { type: 'string', description: 'The node ID to update.' },
      },
      required: ['canvasId', 'nodeId'],
    },
    async execute(args) {
      try {
        const canvasId = requireString(args, 'canvasId');
        const nodeId = requireString(args, 'nodeId');
        const { node } = await requireNode(deps, canvasId, nodeId);
        requireMediaNode(node);
        await deps.toggleSeedLock(canvasId, nodeId);
        return ok({ nodeId });
      } catch (error) {
        return fail(error);
      }
    },
  };

  const selectVariant: AgentTool = {
    name: 'canvas.selectVariant',
    description: 'Select the active generated variant for an image, video, or audio node.',
    context: CANVAS_CONTEXT,
    tier: 2,
    parameters: {
      type: 'object',
      properties: {
        canvasId: { type: 'string', description: 'The target canvas ID.' },
        nodeId: { type: 'string', description: 'The node ID to update.' },
        index: { type: 'number', description: 'The variant index to select.' },
      },
      required: ['canvasId', 'nodeId', 'index'],
    },
    async execute(args) {
      try {
        const canvasId = requireString(args, 'canvasId');
        const nodeId = requireString(args, 'nodeId');
        const index = Math.round(requireNumber(args, 'index'));
        const { node } = await requireNode(deps, canvasId, nodeId);
        requireMediaNode(node);
        await deps.selectVariant(canvasId, nodeId, index);
        return ok({ nodeId, index });
      } catch (error) {
        return fail(error);
      }
    },
  };

  const estimateCost: AgentTool = {
    name: 'canvas.estimateCost',
    description: 'Estimate total generation cost for specific nodes or for all media nodes on the canvas.',
    context: CANVAS_CONTEXT,
    tier: 1,
    parameters: {
      type: 'object',
      properties: {
        canvasId: { type: 'string', description: 'The target canvas ID.' },
        nodeIds: {
          type: 'array',
          description: 'Optional node IDs to include in the estimate.',
          items: { type: 'string', description: 'A node ID.' },
        },
      },
      required: ['canvasId'],
    },
    async execute(args) {
      try {
        const canvasId = requireString(args, 'canvasId');
        await requireCanvas(deps, canvasId);
        const nodeIds =
          Array.isArray(args.nodeIds) && args.nodeIds.length > 0
            ? requireStringArray(args, 'nodeIds')
            : undefined;
        return ok(await deps.estimateCost(canvasId, nodeIds));
      } catch (error) {
        return fail(error);
      }
    },
  };

  const addNote: AgentTool = {
    name: 'canvas.addNote',
    description: 'Add a note to the current canvas.',
    context: CANVAS_CONTEXT,
    tier: 2,
    parameters: {
      type: 'object',
      properties: {
        canvasId: { type: 'string', description: 'The target canvas ID.' },
        content: { type: 'string', description: 'The note content.' },
      },
      required: ['canvasId', 'content'],
    },
    async execute(args) {
      try {
        const canvasId = requireString(args, 'canvasId');
        const content = requireText(args, 'content');
        return ok(await deps.addNote(canvasId, content));
      } catch (error) {
        return fail(error);
      }
    },
  };

  const updateNote: AgentTool = {
    name: 'canvas.updateNote',
    description: 'Update the content of an existing canvas note.',
    context: CANVAS_CONTEXT,
    tier: 2,
    parameters: {
      type: 'object',
      properties: {
        canvasId: { type: 'string', description: 'The target canvas ID.' },
        noteId: { type: 'string', description: 'The note ID to update.' },
        content: { type: 'string', description: 'The new note content.' },
      },
      required: ['canvasId', 'noteId', 'content'],
    },
    async execute(args) {
      try {
        const canvasId = requireString(args, 'canvasId');
        const noteId = requireString(args, 'noteId');
        const content = requireText(args, 'content');
        await deps.updateNote(canvasId, noteId, content);
        return ok({ noteId, content });
      } catch (error) {
        return fail(error);
      }
    },
  };

  const deleteNote: AgentTool = {
    name: 'canvas.deleteNote',
    description: 'Delete a note from the current canvas.',
    context: CANVAS_CONTEXT,
    tier: 3,
    parameters: {
      type: 'object',
      properties: {
        canvasId: { type: 'string', description: 'The target canvas ID.' },
        noteId: { type: 'string', description: 'The note ID to delete.' },
      },
      required: ['canvasId', 'noteId'],
    },
    async execute(args) {
      try {
        const canvasId = requireString(args, 'canvasId');
        const noteId = requireString(args, 'noteId');
        await deps.deleteNote(canvasId, noteId);
        return ok({ noteId });
      } catch (error) {
        return fail(error);
      }
    },
  };

  const undo: AgentTool = {
    name: 'canvas.undo',
    description: 'Undo the most recent canvas action.',
    context: CANVAS_CONTEXT,
    tier: 4,
    parameters: {
      type: 'object',
      properties: {
        canvasId: { type: 'string', description: 'The target canvas ID.' },
      },
      required: ['canvasId'],
    },
    async execute(args) {
      try {
        const canvasId = requireString(args, 'canvasId');
        await requireCanvas(deps, canvasId);
        await deps.undo(canvasId);
        return ok({ canvasId });
      } catch (error) {
        return fail(error);
      }
    },
  };

  const redo: AgentTool = {
    name: 'canvas.redo',
    description: 'Redo the most recently undone canvas action.',
    context: CANVAS_CONTEXT,
    tier: 4,
    parameters: {
      type: 'object',
      properties: {
        canvasId: { type: 'string', description: 'The target canvas ID.' },
      },
      required: ['canvasId'],
    },
    async execute(args) {
      try {
        const canvasId = requireString(args, 'canvasId');
        await requireCanvas(deps, canvasId);
        await deps.redo(canvasId);
        return ok({ canvasId });
      } catch (error) {
        return fail(error);
      }
    },
  };

  const generateAll: AgentTool = {
    name: 'canvas.generateAll',
    description: 'Trigger generation sequentially for specific nodes or for all image and video nodes on the canvas.',
    context: CANVAS_CONTEXT,
    tier: 3,
    parameters: {
      type: 'object',
      properties: {
        canvasId: { type: 'string', description: 'The target canvas ID.' },
        nodeIds: {
          type: 'array',
          description: 'Optional node IDs to generate. If omitted, all image and video nodes are used.',
          items: { type: 'string', description: 'A node ID.' },
        },
        providerId: { type: 'string', description: 'Optional provider override.' },
      },
      required: ['canvasId'],
    },
    async execute(args) {
      try {
        const canvasId = requireString(args, 'canvasId');
        const canvas = await requireCanvas(deps, canvasId);
        const providerId =
          typeof args.providerId === 'string' && args.providerId.trim().length > 0
            ? args.providerId.trim()
            : undefined;
        const nodeIds =
          Array.isArray(args.nodeIds) && args.nodeIds.length > 0
            ? requireStringArray(args, 'nodeIds')
            : canvas.nodes
                .filter((node) => node.type === 'image' || node.type === 'video')
                .map((node) => node.id);

        if (nodeIds.length === 0) {
          throw new Error('No nodes available for generation');
        }

        for (const nodeId of nodeIds) {
          const node = canvas.nodes.find((entry) => entry.id === nodeId);
          if (!node) {
            throw new Error(`Node not found: ${nodeId}`);
          }
          requireMediaNode(node, `Node type "${node.type}" does not support generation`);
          await deps.triggerGeneration(canvasId, nodeId, providerId);
        }

        return ok({ nodeIds, providerId, count: nodeIds.length });
      } catch (error) {
        return fail(error);
      }
    },
  };

  const deleteNode: AgentTool = {
    name: 'canvas.deleteNode',
    description: 'Delete a node from the canvas (also removes connected edges).',
    context: CANVAS_CONTEXT,
    tier: 3,
    parameters: {
      type: 'object',
      properties: {
        canvasId: { type: 'string', description: 'The target canvas ID.' },
        nodeId: { type: 'string', description: 'The node ID to delete.' },
      },
      required: ['canvasId', 'nodeId'],
    },
    async execute(args) {
      try {
        const canvasId = requireString(args, 'canvasId');
        const nodeId = requireString(args, 'nodeId');
        await requireNode(deps, canvasId, nodeId);
        await deps.deleteNode(canvasId, nodeId);
        return ok({ nodeId });
      } catch (error) {
        return fail(error);
      }
    },
  };

  const deleteEdge: AgentTool = {
    name: 'canvas.deleteEdge',
    description: 'Delete an edge (connection) from the canvas.',
    context: CANVAS_CONTEXT,
    tier: 3,
    parameters: {
      type: 'object',
      properties: {
        canvasId: { type: 'string', description: 'The target canvas ID.' },
        edgeId: { type: 'string', description: 'The edge ID to delete.' },
      },
      required: ['canvasId', 'edgeId'],
    },
    async execute(args) {
      try {
        const canvasId = requireString(args, 'canvasId');
        const edgeId = requireString(args, 'edgeId');
        await deps.deleteEdge(canvasId, edgeId);
        return ok({ edgeId });
      } catch (error) {
        return fail(error);
      }
    },
  };

  const swapEdgeDirection: AgentTool = {
    name: 'canvas.swapEdgeDirection',
    description: 'Swap the source and target of an existing edge.',
    context: CANVAS_CONTEXT,
    tier: 2,
    parameters: {
      type: 'object',
      properties: {
        canvasId: { type: 'string', description: 'The target canvas ID.' },
        edgeId: { type: 'string', description: 'The edge ID to swap.' },
      },
      required: ['canvasId', 'edgeId'],
    },
    async execute(args) {
      try {
        const canvasId = requireString(args, 'canvasId');
        const edgeId = requireString(args, 'edgeId');
        const canvas = await requireCanvas(deps, canvasId);
        const edge = requireCanvasEdge(canvas, edgeId);
        const swappedEdge: CanvasEdge = {
          ...(structuredClone(edge) as CanvasEdge),
          source: edge.target,
          target: edge.source,
          sourceHandle: edge.targetHandle,
          targetHandle: edge.sourceHandle,
        };

        await deps.deleteEdge(canvasId, edgeId);
        await deps.connectNodes(canvasId, swappedEdge);
        return ok(swappedEdge);
      } catch (error) {
        return fail(error);
      }
    },
  };

  const disconnectNode: AgentTool = {
    name: 'canvas.disconnectNode',
    description: 'Remove all edges connected to a node.',
    context: CANVAS_CONTEXT,
    tier: 3,
    parameters: {
      type: 'object',
      properties: {
        canvasId: { type: 'string', description: 'The target canvas ID.' },
        nodeId: { type: 'string', description: 'The node ID to disconnect.' },
      },
      required: ['canvasId', 'nodeId'],
    },
    async execute(args) {
      try {
        const canvasId = requireString(args, 'canvasId');
        const nodeId = requireString(args, 'nodeId');
        const { canvas } = await requireNode(deps, canvasId, nodeId);
        const edgeIds = canvas.edges
          .filter((edge) => edge.source === nodeId || edge.target === nodeId)
          .map((edge) => edge.id);

        for (const edgeId of edgeIds) {
          await deps.deleteEdge(canvasId, edgeId);
        }

        return ok({ nodeId, edgeIds, count: edgeIds.length });
      } catch (error) {
        return fail(error);
      }
    },
  };

  const editNodeContent: AgentTool = {
    name: 'canvas.editNodeContent',
    description:
      'Edit node content: sets "content" on text nodes, "prompt" on image/video/audio nodes.',
    context: CANVAS_CONTEXT,
    tier: 2,
    parameters: {
      type: 'object',
      properties: {
        canvasId: { type: 'string', description: 'The target canvas ID.' },
        nodeId: { type: 'string', description: 'The node ID to edit.' },
        content: { type: 'string', description: 'Text content (for text nodes).' },
        prompt: { type: 'string', description: 'Prompt text (for image/video/audio nodes).' },
      },
      required: ['canvasId', 'nodeId'],
    },
    async execute(args) {
      try {
        const canvasId = requireString(args, 'canvasId');
        const nodeId = requireString(args, 'nodeId');
        const { node } = await requireNode(deps, canvasId, nodeId);
        const data: Record<string, unknown> = {};
        if (node.type === 'text') {
          if (typeof args.content !== 'string') throw new Error('content is required for text nodes');
          data.content = args.content;
        } else {
          if (typeof args.prompt !== 'string') throw new Error('prompt is required for media nodes');
          data.prompt = args.prompt;
        }
        await deps.updateNodeData(canvasId, nodeId, data);
        return ok({ nodeId, ...data });
      } catch (error) {
        return fail(error);
      }
    },
  };

  const setNodeProvider: AgentTool = {
    name: 'canvas.setNodeProvider',
    description: 'Set the AI provider for an image, video, or audio node.',
    context: CANVAS_CONTEXT,
    tier: 2,
    parameters: {
      type: 'object',
      properties: {
        canvasId: { type: 'string', description: 'The target canvas ID.' },
        nodeId: { type: 'string', description: 'The node ID to update.' },
        providerId: { type: 'string', description: 'The provider ID to assign.' },
      },
      required: ['canvasId', 'nodeId', 'providerId'],
    },
    async execute(args) {
      try {
        const canvasId = requireString(args, 'canvasId');
        const nodeId = requireString(args, 'nodeId');
        const providerId = requireString(args, 'providerId');
        const { node } = await requireNode(deps, canvasId, nodeId);
        if (node.type !== 'image' && node.type !== 'video' && node.type !== 'audio') {
          throw new Error(`Node type "${node.type}" does not support providers`);
        }
        await deps.updateNodeData(canvasId, nodeId, { providerId });
        return ok({ nodeId, providerId });
      } catch (error) {
        return fail(error);
      }
    },
  };

  return [
    generate, cancelGeneration, setSeed, setVariantCount, setNodeColorTag, toggleSeedLock, selectVariant, estimateCost,
    addNote, updateNote, deleteNote, undo, redo, generateAll,
    deleteNode, deleteEdge, swapEdgeDirection, disconnectNode, editNodeContent, setNodeProvider,
  ];
}
