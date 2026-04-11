import {
  getBuiltinProviderCapabilityProfile,
  listBuiltinVideoProvidersWithAudio,
  type CanvasEdge,
} from '@lucid-fin/contracts';
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

const AUDIO_CAPABLE_VIDEO_PROVIDER_IDS = listBuiltinVideoProvidersWithAudio().join(', ');
const KLING_QUALITY_TIERS =
  getBuiltinProviderCapabilityProfile('kling-v1')?.qualityTiers ?? [];
const KLING_QUALITY_DESCRIPTION =
  KLING_QUALITY_TIERS.length > 0
    ? `kling-v1: ${KLING_QUALITY_TIERS.map((tier) => `"${tier}"`).join(' or ')}`
    : 'provider-specific';

export function createCanvasGenerationTools(deps: CanvasToolDeps): AgentTool[] {
  const generate: AgentTool = {
    name: 'canvas.generate',
    description: 'Trigger media generation for an image, video, or audio node and wait for completion. Returns the result including success/failure status, variant hashes, and any error message.',
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

        // Poll node status until generation completes or fails (max 5 minutes)
        const maxWaitMs = 5 * 60 * 1000;
        const pollIntervalMs = 3000;
        const start = Date.now();
        while (Date.now() - start < maxWaitMs) {
          await new Promise((r) => setTimeout(r, pollIntervalMs));
          const { node } = await requireNode(deps, canvasId, nodeId);
          const data = node.data as Record<string, unknown>;
          const status = data.status as string | undefined;
          if (status === 'done') {
            return ok({
              nodeId,
              status: 'done',
              variants: Array.isArray(data.variants) ? data.variants : [],
              assetHash: data.assetHash,
            });
          }
          if (status === 'failed') {
            return ok({
              nodeId,
              status: 'failed',
              error: typeof data.error === 'string' ? data.error : 'Generation failed',
            });
          }
          // still generating — continue polling
        }
        return ok({ nodeId, status: 'timeout', error: 'Generation did not complete within 5 minutes' });
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

  const note: AgentTool = {
    name: 'canvas.note',
    description: 'Add, update, or delete a canvas note.',
    context: CANVAS_CONTEXT,
    tier: 2,
    parameters: {
      type: 'object',
      properties: {
        canvasId: { type: 'string', description: 'The target canvas ID.' },
        action: { type: 'string', enum: ['add', 'update', 'delete'], description: 'Action to perform.' },
        content: { type: 'string', description: 'The note content (required for add/update).' },
        noteId: { type: 'string', description: 'The note ID (required for update/delete).' },
      },
      required: ['canvasId', 'action'],
    },
    async execute(args) {
      try {
        const canvasId = requireString(args, 'canvasId');
        const action = requireString(args, 'action');
        if (action === 'add') {
          const content = requireText(args, 'content');
          return ok(await deps.addNote(canvasId, content));
        }
        if (action === 'update') {
          const noteId = requireString(args, 'noteId');
          const content = requireText(args, 'content');
          await deps.updateNote(canvasId, noteId, content);
          return ok({ noteId, content });
        }
        if (action === 'delete') {
          const noteId = requireString(args, 'noteId');
          await deps.deleteNote(canvasId, noteId);
          return ok({ noteId });
        }
        throw new Error(`Unknown action: ${action}`);
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
          sourceHandle: edge.targetHandle?.startsWith('tgt-') ? edge.targetHandle.slice(4) : edge.targetHandle,
          targetHandle: edge.sourceHandle && !edge.sourceHandle.startsWith('tgt-') ? `tgt-${edge.sourceHandle}` : edge.sourceHandle,
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

  const setNodeMediaConfig: AgentTool = {
    name: 'canvas.setNodeMediaConfig',
    description:
      'Set media generation configuration on an image or video node: resolution (width/height), duration, audio, quality. Only applicable fields are written; others are ignored based on node type.',
    context: CANVAS_CONTEXT,
    tier: 2,
    parameters: {
      type: 'object',
      properties: {
        canvasId: { type: 'string', description: 'The target canvas ID.' },
        nodeId: { type: 'string', description: 'The node ID to update.' },
        width: { type: 'number', description: 'Image/video width in pixels.' },
        height: { type: 'number', description: 'Image/video height in pixels.' },
        duration: { type: 'number', description: 'Video duration in seconds.' },
        audio: { type: 'boolean', description: `Enable audio generation (video only). Only supported by: ${AUDIO_CAPABLE_VIDEO_PROVIDER_IDS}.` },
        quality: { type: 'string', description: `Quality/mode tier (video only). ${KLING_QUALITY_DESCRIPTION}. Other providers: "standard".` },
      },
      required: ['canvasId', 'nodeId'],
    },
    async execute(args) {
      try {
        const canvasId = requireString(args, 'canvasId');
        const nodeId = requireString(args, 'nodeId');
        const { node } = await requireNode(deps, canvasId, nodeId);
        if (node.type !== 'image' && node.type !== 'video') {
          throw new Error(`Node type "${node.type}" does not support media config`);
        }
        const data: Record<string, unknown> = {};
        if (typeof args.width === 'number') data.width = args.width;
        if (typeof args.height === 'number') data.height = args.height;
        if (node.type === 'video') {
          if (typeof args.duration === 'number') data.duration = args.duration;
          if (typeof args.audio === 'boolean') data.audio = args.audio;
          if (typeof args.quality === 'string') data.quality = args.quality;
        }
        await deps.updateNodeData(canvasId, nodeId, data);
        return ok({ nodeId, ...data });
      } catch (error) {
        return fail(error);
      }
    },
  };

  const setVideoFrames: AgentTool = {
    name: 'canvas.setVideoFrames',
    description: 'Set first and/or last frame reference for a video node. IMPORTANT: First frame requires an INCOMING edge (image→video), last frame requires an OUTGOING edge (video→image). Connect edges with correct direction BEFORE calling this tool.',
    context: CANVAS_CONTEXT,
    tier: 2,
    parameters: {
      type: 'object',
      properties: {
        canvasId: { type: 'string', description: 'The target canvas ID.' },
        nodeId: { type: 'string', description: 'The video node ID.' },
        firstFrameNodeId: { type: 'string', description: 'ID of a connected image node to use as first frame.' },
        lastFrameNodeId: { type: 'string', description: 'ID of a connected image node to use as last frame.' },
        firstFrameAssetHash: { type: 'string', description: 'Direct asset hash for first frame image.' },
        lastFrameAssetHash: { type: 'string', description: 'Direct asset hash for last frame image.' },
      },
      required: ['canvasId', 'nodeId'],
    },
    async execute(args) {
      try {
        const canvasId = requireString(args, 'canvasId');
        const nodeId = requireString(args, 'nodeId');
        const { node } = await requireNode(deps, canvasId, nodeId);
        if (node.type !== 'video') {
          throw new Error(`Node type "${node.type}" is not a video node`);
        }
        const data: Record<string, unknown> = {};
        if (typeof args.firstFrameNodeId === 'string') {
          data.firstFrameNodeId = args.firstFrameNodeId;
          data.firstFrameAssetHash = undefined;
        } else if (typeof args.firstFrameAssetHash === 'string') {
          data.firstFrameAssetHash = args.firstFrameAssetHash;
          data.firstFrameNodeId = undefined;
        }
        if (typeof args.lastFrameNodeId === 'string') {
          data.lastFrameNodeId = args.lastFrameNodeId;
          data.lastFrameAssetHash = undefined;
        } else if (typeof args.lastFrameAssetHash === 'string') {
          data.lastFrameAssetHash = args.lastFrameAssetHash;
          data.lastFrameNodeId = undefined;
        }
        await deps.updateNodeData(canvasId, nodeId, data);
        return ok({ nodeId, ...data });
      } catch (error) {
        return fail(error);
      }
    },
  };

  return [
    generate, cancelGeneration, setSeed, setVariantCount, setNodeColorTag, toggleSeedLock, selectVariant, estimateCost,
    note, undo, redo, generateAll,
    deleteNode, deleteEdge, swapEdgeDirection, disconnectNode, editNodeContent, setNodeProvider, setNodeMediaConfig, setVideoFrames,
  ];
}
