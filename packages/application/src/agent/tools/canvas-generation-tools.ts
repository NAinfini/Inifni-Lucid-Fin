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
  /** Resolve nodeId (string) or nodeIds (string[]) from tool args. */
  function resolveNodeIds(args: Record<string, unknown>): string[] {
    if (Array.isArray(args.nodeIds)) {
      return args.nodeIds.map((id: unknown) => (typeof id === 'string' ? id.trim() : String(id)));
    }
    return [requireString(args, 'nodeId')];
  }

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
    description: 'Cancel active generation jobs for one or more image, video, or audio nodes. Supports batch: pass nodeIds array.',
    context: CANVAS_CONTEXT,
    tier: 3,
    parameters: {
      type: 'object',
      properties: {
        canvasId: { type: 'string', description: 'The target canvas ID.' },
        nodeId: { type: 'string', description: 'Single node ID to cancel.' },
        nodeIds: { type: 'array', items: { type: 'string', description: 'Node ID.' }, description: 'Batch: array of node IDs to cancel generation.' },
      },
      required: ['canvasId'],
    },
    async execute(args) {
      try {
        const canvasId = requireString(args, 'canvasId');
        const ids = resolveNodeIds(args);
        const results: Array<{ nodeId: string; success: boolean; error?: string }> = [];
        for (const nodeId of ids) {
          try {
            const { node } = await requireNode(deps, canvasId, nodeId);
            requireMediaNode(node);
            await deps.cancelGeneration(canvasId, nodeId);
            results.push({ nodeId, success: true });
          } catch (error) {
            results.push({ nodeId, success: false, error: error instanceof Error ? error.message : String(error) });
          }
        }
        if (ids.length === 1) return results[0].success ? ok({ nodeId: ids[0] }) : fail(results[0].error!);
        return ok({ cancelled: results.filter((r) => r.success).length, total: ids.length, results });
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
    description: 'Set the color tag for nodes. Supports batch: pass nodeIds array to color-tag multiple nodes at once.',
    context: CANVAS_CONTEXT,
    tier: 2,
    parameters: {
      type: 'object',
      properties: {
        canvasId: { type: 'string', description: 'The target canvas ID.' },
        nodeId: { type: 'string', description: 'Single node ID to update.' },
        nodeIds: { type: 'array', items: { type: 'string', description: 'Node ID.' }, description: 'Batch: array of node IDs to color-tag.' },
        color: { type: 'string', description: 'The color tag to assign.' },
      },
      required: ['canvasId', 'color'],
    },
    async execute(args) {
      try {
        const canvasId = requireString(args, 'canvasId');
        const ids = resolveNodeIds(args);
        const color = requireString(args, 'color');
        const results: Array<{ nodeId: string; success: boolean; error?: string }> = [];
        for (const nodeId of ids) {
          try {
            await requireNode(deps, canvasId, nodeId);
            await deps.setNodeColorTag(canvasId, nodeId, color);
            results.push({ nodeId, success: true });
          } catch (error) {
            results.push({ nodeId, success: false, error: error instanceof Error ? error.message : String(error) });
          }
        }
        if (ids.length === 1) return results[0].success ? ok({ nodeId: ids[0], color }) : fail(results[0].error!);
        return ok({ tagged: results.filter((r) => r.success).length, total: ids.length, color, results });
      } catch (error) {
        return fail(error);
      }
    },
  };

  const toggleSeedLock: AgentTool = {
    name: 'canvas.toggleSeedLock',
    description: 'Toggle the seed lock state for one or more image, video, or audio nodes. Supports batch: pass nodeIds array.',
    context: CANVAS_CONTEXT,
    tier: 2,
    parameters: {
      type: 'object',
      properties: {
        canvasId: { type: 'string', description: 'The target canvas ID.' },
        nodeId: { type: 'string', description: 'Single node ID to update.' },
        nodeIds: { type: 'array', items: { type: 'string', description: 'Node ID.' }, description: 'Batch: array of node IDs to toggle seed lock.' },
      },
      required: ['canvasId'],
    },
    async execute(args) {
      try {
        const canvasId = requireString(args, 'canvasId');
        const ids = resolveNodeIds(args);
        const results: Array<{ nodeId: string; success: boolean; error?: string }> = [];
        for (const nodeId of ids) {
          try {
            const { node } = await requireNode(deps, canvasId, nodeId);
            requireMediaNode(node);
            await deps.toggleSeedLock(canvasId, nodeId);
            results.push({ nodeId, success: true });
          } catch (error) {
            results.push({ nodeId, success: false, error: error instanceof Error ? error.message : String(error) });
          }
        }
        if (ids.length === 1) return results[0].success ? ok({ nodeId: ids[0] }) : fail(results[0].error!);
        return ok({ toggled: results.filter((r) => r.success).length, total: ids.length, results });
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
    description: 'Delete one or more nodes from the canvas (also removes connected edges). Supports batch: pass nodeIds array.',
    context: CANVAS_CONTEXT,
    tier: 3,
    parameters: {
      type: 'object',
      properties: {
        canvasId: { type: 'string', description: 'The target canvas ID.' },
        nodeId: { type: 'string', description: 'Single node ID to delete.' },
        nodeIds: { type: 'array', items: { type: 'string', description: 'Node ID.' }, description: 'Batch: array of node IDs to delete.' },
      },
      required: ['canvasId'],
    },
    async execute(args) {
      try {
        const canvasId = requireString(args, 'canvasId');
        const ids = resolveNodeIds(args);
        const results: Array<{ nodeId: string; success: boolean; error?: string }> = [];
        for (const nodeId of ids) {
          try {
            await requireNode(deps, canvasId, nodeId);
            await deps.deleteNode(canvasId, nodeId);
            results.push({ nodeId, success: true });
          } catch (error) {
            results.push({ nodeId, success: false, error: error instanceof Error ? error.message : String(error) });
          }
        }
        if (ids.length === 1) return results[0].success ? ok({ nodeId: ids[0] }) : fail(results[0].error!);
        return ok({ deleted: results.filter((r) => r.success).length, total: ids.length, results });
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
    description: 'Remove all edges connected to one or more nodes. Supports batch: pass nodeIds array.',
    context: CANVAS_CONTEXT,
    tier: 3,
    parameters: {
      type: 'object',
      properties: {
        canvasId: { type: 'string', description: 'The target canvas ID.' },
        nodeId: { type: 'string', description: 'Single node ID to disconnect.' },
        nodeIds: { type: 'array', items: { type: 'string', description: 'Node ID.' }, description: 'Batch: array of node IDs to disconnect.' },
      },
      required: ['canvasId'],
    },
    async execute(args) {
      try {
        const canvasId = requireString(args, 'canvasId');
        const ids = resolveNodeIds(args);
        const results: Array<{ nodeId: string; success: boolean; edgeIds?: string[]; count?: number; error?: string }> = [];
        for (const nodeId of ids) {
          try {
            const { canvas } = await requireNode(deps, canvasId, nodeId);
            const edgeIds = canvas.edges
              .filter((edge) => edge.source === nodeId || edge.target === nodeId)
              .map((edge) => edge.id);
            for (const edgeId of edgeIds) {
              await deps.deleteEdge(canvasId, edgeId);
            }
            results.push({ nodeId, success: true, edgeIds, count: edgeIds.length });
          } catch (error) {
            results.push({ nodeId, success: false, error: error instanceof Error ? error.message : String(error) });
          }
        }
        if (ids.length === 1) {
          const r = results[0];
          return r.success ? ok({ nodeId: ids[0], edgeIds: r.edgeIds, count: r.count }) : fail(r.error!);
        }
        return ok({ disconnected: results.filter((r) => r.success).length, total: ids.length, results });
      } catch (error) {
        return fail(error);
      }
    },
  };

  const editNodeContent: AgentTool = {
    name: 'canvas.editNodeContent',
    description:
      'Edit node content and advanced generation parameters. For text nodes: sets "content". For image/video/audio nodes: sets "prompt" and/or advanced params (negativePrompt, steps, cfgScale, scheduler, img2imgStrength). At least one field must be provided. Supports batch via nodeIds.',
    context: CANVAS_CONTEXT,
    tier: 2,
    parameters: {
      type: 'object',
      properties: {
        canvasId: { type: 'string', description: 'The target canvas ID.' },
        nodeId: { type: 'string', description: 'Single node ID to edit.' },
        nodeIds: { type: 'array', items: { type: 'string', description: 'Node ID.' }, description: 'Array of node IDs to edit (batch). Each entry can be a string nodeId, or an object {nodeId, content?, prompt?, negativePrompt?, ...} for per-node values.' },
        content: { type: 'string', description: 'Text content (for text nodes).' },
        prompt: { type: 'string', description: 'Prompt text (for image/video/audio nodes).' },
        negativePrompt: { type: 'string', description: 'Negative prompt: elements to avoid in the generated output.' },
        steps: { type: 'number', description: 'Inference steps (typically 20-50). Higher = more detail but slower.' },
        cfgScale: { type: 'number', description: 'CFG scale / guidance (typically 3-15). Higher = stricter prompt adherence.' },
        scheduler: { type: 'string', description: 'Sampling scheduler/method (e.g. "euler_a", "dpm++_2m", "ddim").' },
        img2imgStrength: { type: 'number', description: 'Image-to-image strength (0-1). 0 = ignore source, 1 = max influence from source image.' },
      },
      required: ['canvasId'],
    },
    async execute(args) {
      try {
        const canvasId = requireString(args, 'canvasId');
        // Extract shared advanced params from top-level args
        const sharedAdvanced: Record<string, unknown> = {};
        if (typeof args.negativePrompt === 'string') sharedAdvanced.negativePrompt = args.negativePrompt;
        if (typeof args.steps === 'number') sharedAdvanced.steps = Math.round(args.steps as number);
        if (typeof args.cfgScale === 'number') sharedAdvanced.cfgScale = args.cfgScale;
        if (typeof args.scheduler === 'string') sharedAdvanced.scheduler = args.scheduler;
        if (typeof args.img2imgStrength === 'number') {
          sharedAdvanced.img2imgStrength = Math.max(0, Math.min(1, args.img2imgStrength as number));
        }

        // Resolve target node(s)
        type Target = { nodeId: string; content?: string; prompt?: string; advanced: Record<string, unknown> };
        const targets: Target[] = [];
        if (Array.isArray(args.nodeIds)) {
          for (const entry of args.nodeIds) {
            if (typeof entry === 'string') {
              targets.push({ nodeId: entry, content: args.content as string | undefined, prompt: args.prompt as string | undefined, advanced: { ...sharedAdvanced } });
            } else if (typeof entry === 'object' && entry !== null) {
              const e = entry as Record<string, unknown>;
              const perNode: Record<string, unknown> = { ...sharedAdvanced };
              if (typeof e.negativePrompt === 'string') perNode.negativePrompt = e.negativePrompt;
              if (typeof e.steps === 'number') perNode.steps = Math.round(e.steps as number);
              if (typeof e.cfgScale === 'number') perNode.cfgScale = e.cfgScale;
              if (typeof e.scheduler === 'string') perNode.scheduler = e.scheduler;
              if (typeof e.img2imgStrength === 'number') perNode.img2imgStrength = Math.max(0, Math.min(1, e.img2imgStrength as number));
              targets.push({
                nodeId: requireString(e, 'nodeId'),
                content: typeof e.content === 'string' ? e.content : args.content as string | undefined,
                prompt: typeof e.prompt === 'string' ? e.prompt : args.prompt as string | undefined,
                advanced: perNode,
              });
            }
          }
        } else {
          targets.push({ nodeId: requireString(args, 'nodeId'), content: args.content as string | undefined, prompt: args.prompt as string | undefined, advanced: { ...sharedAdvanced } });
        }
        const results: Array<{ nodeId: string; [k: string]: unknown }> = [];
        for (const t of targets) {
          const { node } = await requireNode(deps, canvasId, t.nodeId);
          const data: Record<string, unknown> = {};
          if (node.type === 'text') {
            if (typeof t.content !== 'string') throw new Error(`content is required for text node ${t.nodeId}`);
            data.content = t.content;
          } else {
            // Media node: prompt is optional if advanced params are provided
            if (typeof t.prompt === 'string') data.prompt = t.prompt;
            // Merge advanced params for image/video nodes
            if (node.type === 'image' || node.type === 'video') {
              Object.assign(data, t.advanced);
            } else if (node.type === 'audio' && typeof t.advanced.negativePrompt === 'string') {
              // Audio only supports negativePrompt from advanced params
              data.negativePrompt = t.advanced.negativePrompt;
            }
            // Must have at least prompt or some advanced param
            if (Object.keys(data).length === 0) {
              throw new Error(`At least prompt or an advanced param is required for media node ${t.nodeId}`);
            }
          }
          await deps.updateNodeData(canvasId, t.nodeId, data);
          results.push({ nodeId: t.nodeId, ...data });
        }
        return ok(results.length === 1 ? results[0] : results);
      } catch (error) {
        return fail(error);
      }
    },
  };

  const setNodeProvider: AgentTool = {
    name: 'canvas.setNodeProvider',
    description: 'Set the AI provider for image, video, or audio nodes. Accepts a single nodeId or nodeIds array for batch operation. IMPORTANT: Before assigning a provider, check provider.list to verify the provider has an API key configured (hasKey=true). Do NOT assign providers without configured keys.',
    context: CANVAS_CONTEXT,
    tier: 2,
    parameters: {
      type: 'object',
      properties: {
        canvasId: { type: 'string', description: 'The target canvas ID.' },
        nodeId: { type: 'string', description: 'Single node ID to update.' },
        nodeIds: { type: 'array', items: { type: 'string', description: 'Node ID.' }, description: 'Array of node IDs to update (batch).' },
        providerId: { type: 'string', description: 'The provider ID to assign.' },
      },
      required: ['canvasId', 'providerId'],
    },
    async execute(args) {
      try {
        const canvasId = requireString(args, 'canvasId');
        const providerId = requireString(args, 'providerId');
        const ids = resolveNodeIds(args);
        // Warn if provider has no API key configured
        let keyWarning: string | undefined;
        if (deps.isProviderKeyConfigured) {
          const hasKey = await deps.isProviderKeyConfigured(providerId);
          if (!hasKey) {
            keyWarning = `Warning: Provider "${providerId}" does not have an API key configured. Generation will fail. Use provider.list to find providers with hasKey=true.`;
          }
        }
        const results: Array<{ nodeId: string; providerId: string }> = [];
        for (const nodeId of ids) {
          const { node } = await requireNode(deps, canvasId, nodeId);
          if (node.type !== 'image' && node.type !== 'video' && node.type !== 'audio') {
            throw new Error(`Node "${nodeId}" type "${node.type}" does not support providers`);
          }
          await deps.updateNodeData(canvasId, nodeId, { providerId });
          results.push({ nodeId, providerId });
        }
        const data = results.length === 1 ? results[0] : results;
        return keyWarning ? ok({ ...( Array.isArray(data) ? { nodes: data } : data), _warning: keyWarning }) : ok(data);
      } catch (error) {
        return fail(error);
      }
    },
  };

  const setNodeMediaConfig: AgentTool = {
    name: 'canvas.setNodeMediaConfig',
    description:
      'Set media generation configuration on image or video nodes: resolution (width/height), duration, audio, quality. Accepts a single nodeId or nodeIds array for batch operation. Only applicable fields are written; others are ignored based on node type.',
    context: CANVAS_CONTEXT,
    tier: 2,
    parameters: {
      type: 'object',
      properties: {
        canvasId: { type: 'string', description: 'The target canvas ID.' },
        nodeId: { type: 'string', description: 'Single node ID to update.' },
        nodeIds: { type: 'array', items: { type: 'string', description: 'Node ID.' }, description: 'Array of node IDs to update (batch).' },
        width: { type: 'number', description: 'Image/video width in pixels.' },
        height: { type: 'number', description: 'Image/video height in pixels.' },
        duration: { type: 'number', description: 'Video duration in seconds.' },
        audio: { type: 'boolean', description: `Enable audio generation (video only). Only supported by: ${AUDIO_CAPABLE_VIDEO_PROVIDER_IDS}.` },
        quality: { type: 'string', description: `Quality/mode tier (video only). ${KLING_QUALITY_DESCRIPTION}. Other providers: "standard".` },
      },
      required: ['canvasId'],
    },
    async execute(args) {
      try {
        const canvasId = requireString(args, 'canvasId');
        const ids = resolveNodeIds(args);
        const results: Array<{ nodeId: string; [k: string]: unknown }> = [];
        for (const nodeId of ids) {
          const { node } = await requireNode(deps, canvasId, nodeId);
          if (node.type !== 'image' && node.type !== 'video') {
            throw new Error(`Node "${nodeId}" type "${node.type}" does not support media config`);
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
          results.push({ nodeId, ...data });
        }
        return ok(results.length === 1 ? results[0] : results);
      } catch (error) {
        return fail(error);
      }
    },
  };

  const setVideoFrames: AgentTool = {
    name: 'canvas.setVideoFrames',
    description: 'Set first and/or last frame reference for video nodes. Accepts a single nodeId or nodeIds array for batch. IMPORTANT: First frame requires an INCOMING edge (image→video), last frame requires an OUTGOING edge (video→image). Connect edges with correct direction BEFORE calling this tool.',
    context: CANVAS_CONTEXT,
    tier: 2,
    parameters: {
      type: 'object',
      properties: {
        canvasId: { type: 'string', description: 'The target canvas ID.' },
        nodeId: { type: 'string', description: 'Single video node ID.' },
        nodeIds: { type: 'array', items: { type: 'string', description: 'Node ID.' }, description: 'Array of video node IDs (batch).' },
        firstFrameNodeId: { type: 'string', description: 'ID of a connected image node to use as first frame.' },
        lastFrameNodeId: { type: 'string', description: 'ID of a connected image node to use as last frame.' },
        firstFrameAssetHash: { type: 'string', description: 'Direct asset hash for first frame image.' },
        lastFrameAssetHash: { type: 'string', description: 'Direct asset hash for last frame image.' },
      },
      required: ['canvasId'],
    },
    async execute(args) {
      try {
        const canvasId = requireString(args, 'canvasId');
        const ids = resolveNodeIds(args);
        const results: Array<{ nodeId: string; [k: string]: unknown }> = [];
        for (const nodeId of ids) {
          const { node } = await requireNode(deps, canvasId, nodeId);
          if (node.type !== 'video') {
            throw new Error(`Node "${nodeId}" type "${node.type}" is not a video node`);
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
          results.push({ nodeId, ...data });
        }
        return ok(results.length === 1 ? results[0] : results);
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
