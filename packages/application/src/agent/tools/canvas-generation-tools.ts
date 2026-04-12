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
  requireBackdropNode,
  replaceNodePreservingEdges,
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
    description: 'Trigger media generation for an image, video, or audio node. By default waits for completion (up to 5 min). Set wait=false to fire-and-forget — check status later via canvas.updateNodes or getNode.',
    context: CANVAS_CONTEXT,
    tier: 3,
    parameters: {
      type: 'object',
      properties: {
        canvasId: { type: 'string', description: 'The target canvas ID.' },
        nodeId: { type: 'string', description: 'The node ID to generate.' },
        providerId: { type: 'string', description: 'Optional provider override.' },
        variantCount: { type: 'number', description: 'Optional number of variants to generate.' },
        wait: { type: 'boolean', description: 'If false, return immediately after triggering generation without waiting for completion. Default: true.' },
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

        const shouldWait = args.wait !== false;
        if (!shouldWait) {
          return ok({ nodeId, status: 'generating' });
        }

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

  const updateNodes: AgentTool = {
    name: 'canvas.updateNodes',
    description: `Batch-update properties on one or more nodes. Accepts a single nodeId or nodeIds array. Supported fields depend on node type:
- All nodes: title (string), position ({x,y}), colorTag (string), bypassed (boolean), locked (boolean).
- Text nodes: content (string).
- Media nodes (image/video/audio): prompt, negativePrompt, providerId, seed (number), seedLock (toggle — pass true to toggle current state).
- Image/video nodes: variantCount (1|2|4|9|25), width (px), height (px), steps, cfgScale, scheduler, img2imgStrength (0-1).
- Image/video nodes: imagePrompt, videoPrompt (override prompts for specific generation types).
- Video nodes: duration (seconds), audio (boolean, providers: ${AUDIO_CAPABLE_VIDEO_PROVIDER_IDS}), quality (${KLING_QUALITY_DESCRIPTION}).
- Video nodes: lipSyncEnabled (boolean).
- Audio nodes: audioType ('voice'|'sfx'|'music'), emotionVector (8-dim object for TTS emotion).
IMPORTANT: Before assigning providerId, verify the provider has an API key (hasKey=true) via provider.list.`,
    context: CANVAS_CONTEXT,
    tier: 2,
    parameters: {
      type: 'object',
      properties: {
        canvasId: { type: 'string', description: 'The target canvas ID.' },
        nodeId: { type: 'string', description: 'Single node ID to update.' },
        nodeIds: { type: 'array', items: { type: 'string', description: 'Node ID.' }, description: 'Array of node IDs to update (batch).' },
        title: { type: 'string', description: 'New display title (all node types).' },
        position: {
          type: 'object',
          description: 'New position on canvas (all node types).',
          properties: {
            x: { type: 'number', description: 'Horizontal coordinate.' },
            y: { type: 'number', description: 'Vertical coordinate.' },
          },
        },
        content: { type: 'string', description: 'Text content (text nodes only).' },
        prompt: { type: 'string', description: 'Prompt text (image/video/audio nodes).' },
        negativePrompt: { type: 'string', description: 'Negative prompt: elements to avoid in output (image/video/audio).' },
        providerId: { type: 'string', description: 'AI provider to assign (image/video/audio only).' },
        seed: { type: 'number', description: 'Seed value (image/video/audio only).' },
        seedLock: { type: 'boolean', description: 'Pass true to toggle seed lock state (image/video/audio only).' },
        variantCount: { type: 'number', description: 'Variant count: 1, 2, 4, 9, or 25 (image/video only).' },
        colorTag: { type: 'string', description: 'Color tag string (all node types).' },
        bypassed: { type: 'boolean', description: 'Set bypass state (all node types).' },
        locked: { type: 'boolean', description: 'Set lock state (all node types).' },
        width: { type: 'number', description: 'Width in pixels (image/video only).' },
        height: { type: 'number', description: 'Height in pixels (image/video only).' },
        duration: { type: 'number', description: 'Duration in seconds (video only).' },
        audio: { type: 'boolean', description: `Enable audio generation (video only). Supported providers: ${AUDIO_CAPABLE_VIDEO_PROVIDER_IDS}.` },
        quality: { type: 'string', description: `Quality tier (video only). ${KLING_QUALITY_DESCRIPTION}. Other providers: "standard".` },
        steps: { type: 'number', description: 'Inference steps, typically 20-50 (image/video only).' },
        cfgScale: { type: 'number', description: 'CFG scale / guidance, typically 3-15 (image/video only).' },
        scheduler: { type: 'string', description: 'Sampling scheduler (e.g. "euler_a", "dpm++_2m") (image/video only).' },
        img2imgStrength: { type: 'number', description: 'Image-to-image strength 0-1 (image/video only).' },
        imagePrompt: { type: 'string', description: 'Override prompt for image generation only (image/video nodes).' },
        videoPrompt: { type: 'string', description: 'Override prompt for video generation only (image/video nodes).' },
        audioType: { type: 'string', enum: ['voice', 'sfx', 'music'], description: 'Audio node type: voice, sfx, or music (audio nodes only).' },
        emotionVector: {
          type: 'object',
          description: 'Emotion vector for TTS (audio nodes only). Each key is 0-1.',
          properties: {
            happy: { type: 'number', description: 'Happy intensity 0-1.' },
            sad: { type: 'number', description: 'Sad intensity 0-1.' },
            angry: { type: 'number', description: 'Angry intensity 0-1.' },
            fearful: { type: 'number', description: 'Fearful intensity 0-1.' },
            surprised: { type: 'number', description: 'Surprised intensity 0-1.' },
            disgusted: { type: 'number', description: 'Disgusted intensity 0-1.' },
            contemptuous: { type: 'number', description: 'Contemptuous intensity 0-1.' },
            neutral: { type: 'number', description: 'Neutral intensity 0-1.' },
          },
        },
        lipSyncEnabled: { type: 'boolean', description: 'Enable lip sync post-processing (video nodes only).' },
      },
      required: ['canvasId'],
    },
    async execute(args) {
      try {
        const canvasId = requireString(args, 'canvasId');
        const ids = resolveNodeIds(args);

        // Validate variantCount upfront
        if (typeof args.variantCount === 'number') {
          const count = Math.round(args.variantCount as number);
          if (![1, 2, 4, 9, 25].includes(count)) {
            throw new Error('variantCount must be one of 1, 2, 4, 9, or 25');
          }
        }

        // Validate providerId key upfront
        let keyWarning: string | undefined;
        if (typeof args.providerId === 'string' && deps.isProviderKeyConfigured) {
          const hasKey = await deps.isProviderKeyConfigured(args.providerId as string);
          if (!hasKey) {
            keyWarning = `Warning: Provider "${args.providerId}" does not have an API key configured. Generation will fail. Use provider.list to find providers with hasKey=true.`;
          }
        }

        const results: Array<{ nodeId: string; updated: Record<string, unknown> }> = [];
        for (const nodeId of ids) {
          const { node } = await requireNode(deps, canvasId, nodeId);
          const data: Record<string, unknown> = {};
          const isMedia = node.type === 'image' || node.type === 'video' || node.type === 'audio';
          const isVisual = node.type === 'image' || node.type === 'video';

          // colorTag — all node types
          if (typeof args.colorTag === 'string') {
            await deps.setNodeColorTag(canvasId, nodeId, args.colorTag as string);
          }

          // title — all node types (top-level property)
          if (typeof args.title === 'string') {
            const title = (args.title as string).trim();
            if (title.length > 0) {
              await deps.renameNode(canvasId, nodeId, title);
            }
          }

          // position — all node types (top-level property)
          if (args.position && typeof args.position === 'object') {
            const pos = args.position as Record<string, unknown>;
            if (typeof pos.x === 'number' && typeof pos.y === 'number') {
              await deps.moveNode(canvasId, nodeId, { x: pos.x, y: pos.y });
            }
          }

          // content — text nodes only
          if (typeof args.content === 'string') {
            if (node.type !== 'text') throw new Error(`Node "${nodeId}" type "${node.type}" does not support content (use prompt for media nodes)`);
            data.content = args.content;
          }

          // prompt — media nodes only
          if (typeof args.prompt === 'string') {
            if (!isMedia) throw new Error(`Node "${nodeId}" type "${node.type}" does not support prompt (use content for text nodes)`);
            data.prompt = args.prompt;
          }

          // negativePrompt — media nodes
          if (typeof args.negativePrompt === 'string') {
            if (!isMedia) throw new Error(`Node "${nodeId}" type "${node.type}" does not support negativePrompt`);
            data.negativePrompt = args.negativePrompt;
          }

          // providerId — media only
          if (typeof args.providerId === 'string') {
            if (!isMedia) throw new Error(`Node "${nodeId}" type "${node.type}" does not support providers`);
            data.providerId = (args.providerId as string).trim();
          }

          // seed — media only
          if (typeof args.seed === 'number') {
            if (!isMedia) throw new Error(`Node "${nodeId}" type "${node.type}" does not support seed`);
            data.seed = Math.round(args.seed as number);
          }

          // seedLock toggle — media only
          if (args.seedLock === true) {
            if (!isMedia) throw new Error(`Node "${nodeId}" type "${node.type}" does not support seed lock`);
            await deps.toggleSeedLock(canvasId, nodeId);
          }

          // variantCount — image/video only
          if (typeof args.variantCount === 'number') {
            if (!isVisual) throw new Error(`Node "${nodeId}" type "${node.type}" does not support variantCount`);
            data.variantCount = Math.round(args.variantCount as number);
          }

          // width/height — image/video only
          if (typeof args.width === 'number') {
            if (!isVisual) throw new Error(`Node "${nodeId}" type "${node.type}" does not support width`);
            data.width = args.width;
          }
          if (typeof args.height === 'number') {
            if (!isVisual) throw new Error(`Node "${nodeId}" type "${node.type}" does not support height`);
            data.height = args.height;
          }

          // video-only fields
          if (node.type === 'video') {
            if (typeof args.duration === 'number') data.duration = args.duration;
            if (typeof args.audio === 'boolean') data.audio = args.audio;
            if (typeof args.quality === 'string') data.quality = args.quality;
          } else {
            if (typeof args.duration === 'number') throw new Error(`Node "${nodeId}" type "${node.type}" does not support duration`);
            if (typeof args.audio === 'boolean') throw new Error(`Node "${nodeId}" type "${node.type}" does not support audio`);
            if (typeof args.quality === 'string') throw new Error(`Node "${nodeId}" type "${node.type}" does not support quality`);
          }

          // Advanced generation params — image/video only
          if (isVisual) {
            if (typeof args.steps === 'number') data.steps = Math.round(args.steps as number);
            if (typeof args.cfgScale === 'number') data.cfgScale = args.cfgScale;
            if (typeof args.scheduler === 'string') data.scheduler = args.scheduler;
            if (typeof args.img2imgStrength === 'number') data.img2imgStrength = Math.max(0, Math.min(1, args.img2imgStrength as number));
            if (typeof args.imagePrompt === 'string') data.imagePrompt = args.imagePrompt;
            if (typeof args.videoPrompt === 'string') data.videoPrompt = args.videoPrompt;
          } else {
            if (typeof args.steps === 'number') throw new Error(`Node "${nodeId}" type "${node.type}" does not support steps`);
            if (typeof args.cfgScale === 'number') throw new Error(`Node "${nodeId}" type "${node.type}" does not support cfgScale`);
            if (typeof args.scheduler === 'string') throw new Error(`Node "${nodeId}" type "${node.type}" does not support scheduler`);
            if (typeof args.img2imgStrength === 'number') throw new Error(`Node "${nodeId}" type "${node.type}" does not support img2imgStrength`);
            if (typeof args.imagePrompt === 'string') throw new Error(`Node "${nodeId}" type "${node.type}" does not support imagePrompt`);
            if (typeof args.videoPrompt === 'string') throw new Error(`Node "${nodeId}" type "${node.type}" does not support videoPrompt`);
          }

          // audioType / emotionVector — audio nodes only
          if (typeof args.audioType === 'string') {
            if (node.type !== 'audio') throw new Error(`Node "${nodeId}" type "${node.type}" does not support audioType`);
            const validAudioTypes = ['voice', 'sfx', 'music'];
            if (!validAudioTypes.includes(args.audioType as string)) throw new Error(`audioType must be one of: ${validAudioTypes.join(', ')}`);
            data.audioType = args.audioType;
          }
          if (args.emotionVector !== undefined && args.emotionVector !== null) {
            if (node.type !== 'audio') throw new Error(`Node "${nodeId}" type "${node.type}" does not support emotionVector`);
            data.emotionVector = args.emotionVector;
          }

          // lipSyncEnabled — video nodes only
          if (typeof args.lipSyncEnabled === 'boolean') {
            if (node.type !== 'video') throw new Error(`Node "${nodeId}" type "${node.type}" does not support lipSyncEnabled`);
            data.lipSyncEnabled = args.lipSyncEnabled;
          }

          if (Object.keys(data).length > 0) {
            await deps.updateNodeData(canvasId, nodeId, data);
          }

          // bypassed / locked — top-level node flags, use replaceNodePreservingEdges
          const nodeFlags: Partial<{ bypassed: boolean; locked: boolean }> = {};
          if (typeof args.bypassed === 'boolean') nodeFlags.bypassed = args.bypassed as boolean;
          if (typeof args.locked === 'boolean') nodeFlags.locked = args.locked as boolean;
          if (Object.keys(nodeFlags).length > 0) {
            // Re-fetch node since updateNodeData may have changed it
            const { node: freshNode } = await requireNode(deps, canvasId, nodeId);
            await replaceNodePreservingEdges(deps, canvasId, freshNode, nodeFlags);
          }

          results.push({ nodeId, updated: { ...data, ...(typeof args.title === 'string' ? { title: (args.title as string).trim() } : {}), ...(args.position ? { position: args.position } : {}), ...(typeof args.colorTag === 'string' ? { colorTag: args.colorTag } : {}), ...(args.seedLock === true ? { seedLockToggled: true } : {}), ...nodeFlags } });
        }
        const payload = results.length === 1 ? results[0] : results;
        return keyWarning ? ok({ ...(Array.isArray(payload) ? { nodes: payload } : payload), _warning: keyWarning }) : ok(payload);
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
    description: 'Delete one or more edges (connections) from the canvas. Supports batch: pass edgeIds array.',
    context: CANVAS_CONTEXT,
    tier: 3,
    parameters: {
      type: 'object',
      properties: {
        canvasId: { type: 'string', description: 'The target canvas ID.' },
        edgeId: { type: 'string', description: 'Single edge ID to delete.' },
        edgeIds: { type: 'array', items: { type: 'string', description: 'Edge ID.' }, description: 'Batch: array of edge IDs to delete.' },
      },
      required: ['canvasId'],
    },
    async execute(args) {
      try {
        const canvasId = requireString(args, 'canvasId');
        const ids: string[] = Array.isArray(args.edgeIds)
          ? args.edgeIds.map((id: unknown) => (typeof id === 'string' ? id.trim() : String(id)))
          : [requireString(args, 'edgeId')];
        const results: Array<{ edgeId: string; success: boolean; error?: string }> = [];
        for (const edgeId of ids) {
          try {
            await deps.deleteEdge(canvasId, edgeId);
            results.push({ edgeId, success: true });
          } catch (error) {
            results.push({ edgeId, success: false, error: error instanceof Error ? error.message : String(error) });
          }
        }
        if (ids.length === 1) return results[0].success ? ok({ edgeId: ids[0] }) : fail(results[0].error!);
        return ok({ deleted: results.filter((r) => r.success).length, total: ids.length, results });
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

  const updateBackdrop: AgentTool = {
    name: 'canvas.updateBackdrop',
    description: 'Update one or more properties of a backdrop node in a single call. Supported fields: opacity (number), color (string), borderStyle ("dashed"|"solid"|"dotted"), titleSize ("sm"|"md"|"lg"), lockChildren (boolean), toggleCollapse (pass true to toggle).',
    context: CANVAS_CONTEXT,
    tier: 2,
    parameters: {
      type: 'object',
      properties: {
        canvasId: { type: 'string', description: 'The target canvas ID.' },
        nodeId: { type: 'string', description: 'The backdrop node ID to update.' },
        opacity: { type: 'number', description: 'Backdrop opacity value.' },
        color: { type: 'string', description: 'Backdrop background color.' },
        borderStyle: { type: 'string', description: 'Border style.', enum: ['dashed', 'solid', 'dotted'] },
        titleSize: { type: 'string', description: 'Title size.', enum: ['sm', 'md', 'lg'] },
        lockChildren: { type: 'boolean', description: 'Whether child nodes are locked inside the backdrop.' },
        toggleCollapse: { type: 'boolean', description: 'Pass true to toggle the collapsed state.' },
      },
      required: ['canvasId', 'nodeId'],
    },
    async execute(args) {
      try {
        const canvasId = requireString(args, 'canvasId');
        const nodeId = requireString(args, 'nodeId');
        const { node } = await requireNode(deps, canvasId, nodeId);
        requireBackdropNode(node);

        const data: Record<string, unknown> = {};
        if (typeof args.opacity === 'number') {
          if (!Number.isFinite(args.opacity as number)) throw new Error('opacity must be a finite number');
          data.opacity = args.opacity;
        }
        if (typeof args.color === 'string') data.color = args.color;
        if (typeof args.borderStyle === 'string') {
          if (args.borderStyle !== 'dashed' && args.borderStyle !== 'solid' && args.borderStyle !== 'dotted') {
            throw new Error('borderStyle must be one of dashed, solid, or dotted');
          }
          data.borderStyle = args.borderStyle;
        }
        if (typeof args.titleSize === 'string') {
          if (args.titleSize !== 'sm' && args.titleSize !== 'md' && args.titleSize !== 'lg') {
            throw new Error('titleSize must be one of sm, md, or lg');
          }
          data.titleSize = args.titleSize;
        }
        if (typeof args.lockChildren === 'boolean') data.lockChildren = args.lockChildren;
        if (args.toggleCollapse === true) {
          data.collapsed = !((node.data as { collapsed?: boolean }).collapsed ?? false);
        }

        if (Object.keys(data).length > 0) {
          await deps.updateNodeData(canvasId, nodeId, data);
        }
        return ok({ nodeId, ...data });
      } catch (error) {
        return fail(error);
      }
    },
  };

  const setNodeRefs: AgentTool = {
    name: 'canvas.setNodeRefs',
    description: 'Set character, equipment, and/or location references on image/video nodes. Supports batch via nodeIds array. Pass empty array to clear refs of that type. Only provide the ref types you want to change — omitted types are left unchanged.',
    context: CANVAS_CONTEXT,
    tier: 2,
    parameters: {
      type: 'object',
      properties: {
        canvasId: { type: 'string', description: 'The target canvas ID.' },
        nodeId: { type: 'string', description: 'Single node ID to update.' },
        nodeIds: { type: 'array', items: { type: 'string', description: 'Node ID.' }, description: 'Batch: array of node IDs to update.' },
        characterRefs: {
          type: 'array',
          description: 'Array of character references.',
          items: { type: 'object', description: 'A character reference.', properties: { characterId: { type: 'string', description: 'Character ID.' }, loadoutId: { type: 'string', description: 'Optional loadout ID.' } } },
        },
        equipmentRefs: {
          type: 'array',
          description: 'Array of equipment references.',
          items: { type: 'object', description: 'An equipment reference.', properties: { equipmentId: { type: 'string', description: 'Equipment ID.' } } },
        },
        locationRefs: {
          type: 'array',
          description: 'Array of location references.',
          items: { type: 'object', description: 'A location reference.', properties: { locationId: { type: 'string', description: 'Location ID.' } } },
        },
      },
      required: ['canvasId'],
    },
    async execute(args) {
      try {
        const canvasId = requireString(args, 'canvasId');
        const nodeIds = resolveNodeIds(args);
        const hasCharRefs = Array.isArray(args.characterRefs);
        const hasEquipRefs = Array.isArray(args.equipmentRefs);
        const hasLocRefs = Array.isArray(args.locationRefs);
        if (!hasCharRefs && !hasEquipRefs && !hasLocRefs) {
          throw new Error('At least one of characterRefs, equipmentRefs, or locationRefs is required');
        }

        const characterRefs = hasCharRefs
          ? (args.characterRefs as Array<Record<string, unknown>>).map((r) => ({
              characterId: String(r.characterId ?? ''),
              loadoutId: typeof r.loadoutId === 'string' ? r.loadoutId : '',
            }))
          : undefined;
        const equipmentRefs = hasEquipRefs
          ? (args.equipmentRefs as Array<Record<string, unknown>>).map((r) => ({
              equipmentId: String(r.equipmentId ?? ''),
            }))
          : undefined;
        const locationRefs = hasLocRefs
          ? (args.locationRefs as Array<Record<string, unknown>>).map((r) => ({
              locationId: String(r.locationId ?? ''),
            }))
          : undefined;

        const results: Array<{ nodeId: string; success: boolean; error?: string }> = [];
        for (const nodeId of nodeIds) {
          try {
            const { node } = await requireNode(deps, canvasId, nodeId);
            if (node.type !== 'image' && node.type !== 'video') {
              results.push({ nodeId, success: false, error: `Node type "${node.type}" does not support entity refs` });
              continue;
            }
            const data: Record<string, unknown> = {};
            if (characterRefs !== undefined) data.characterRefs = characterRefs;
            if (equipmentRefs !== undefined) data.equipmentRefs = equipmentRefs;
            if (locationRefs !== undefined) data.locationRefs = locationRefs;
            await deps.updateNodeData(canvasId, nodeId, data);
            results.push({ nodeId, success: true });
          } catch (error) {
            results.push({ nodeId, success: false, error: error instanceof Error ? error.message : String(error) });
          }
        }
        if (nodeIds.length === 1) {
          const r = results[0];
          if (!r.success) return fail(r.error!);
          const responseData: Record<string, unknown> = { nodeId: nodeIds[0] };
          if (characterRefs !== undefined) responseData.characterRefs = characterRefs;
          if (equipmentRefs !== undefined) responseData.equipmentRefs = equipmentRefs;
          if (locationRefs !== undefined) responseData.locationRefs = locationRefs;
          return ok(responseData);
        }
        return ok({ updated: results.filter((r) => r.success).length, total: nodeIds.length, results });
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
    generate, cancelGeneration, updateNodes, selectVariant, estimateCost,
    note, undo, redo,
    deleteNode, deleteEdge, swapEdgeDirection, disconnectNode, setVideoFrames,
    updateBackdrop, setNodeRefs,
  ];
}
