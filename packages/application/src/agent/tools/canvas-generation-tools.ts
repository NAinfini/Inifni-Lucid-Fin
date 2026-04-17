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
import { extractSet, warnExtraKeys } from './tool-result-helpers.js';
import { isGeneratableMedia, isVisualMedia } from '@lucid-fin/shared-utils';

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
    if (Array.isArray(args.nodeIds) && args.nodeIds.length > 0) {
      return args.nodeIds.map((id: unknown) => (typeof id === 'string' ? id.trim() : String(id)));
    }
    return [requireString(args, 'nodeId')];
  }

  const generate: AgentTool = {
    name: 'canvas.generate',
    description: 'Trigger media generation for an image, video, or audio node. Returns immediately (fire-and-forget) — check status later via canvas.getNode. Set wait=true to block until completion (up to 5 min).',
    context: CANVAS_CONTEXT,
    tier: 3,
    parameters: {
      type: 'object',
      properties: {
        canvasId: { type: 'string', description: 'The target canvas ID.' },
        nodeId: { type: 'string', description: 'The node ID to generate.' },
        nodeType: {
          type: 'string',
          description: 'Optional node type hint for orchestration context: "image", "video", or "audio".',
          enum: ['image', 'video', 'audio'],
        },
        providerId: { type: 'string', description: 'Optional provider override.' },
        variantCount: { type: 'number', description: 'Optional number of variants to generate.' },
        wait: { type: 'boolean', description: 'If true, block until generation completes (up to 5 min). Default: false (fire-and-forget).' },
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

        const shouldWait = args.wait === true;
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

  // ---------------------------------------------------------------------------
  // canvas.updateNodes — content & prompt fields only
  // ---------------------------------------------------------------------------
  const updateNodes: AgentTool = {
    name: 'canvas.updateNodes',
    description: `Batch-update content and prompt fields on nodes. Two modes:
1. Same update for multiple nodes: use nodeId/nodeIds + "set": { ... }
2. Different updates per node: use "nodes": [{ nodeId, set: {...} }, ...] — preferred for efficiency when each node needs different values.
Supported fields in "set": title, content (text only), prompt, negativePrompt (media only).
For generation parameters, use canvas.setNodeGenParams. For layout, use canvas.setNodeLayout.`,
    context: CANVAS_CONTEXT,
    tier: 2,
    parameters: {
      type: 'object',
      properties: {
        canvasId: { type: 'string', description: 'The target canvas ID.' },
        nodeId: { type: 'string', description: 'Single node ID to update.' },
        nodeIds: { type: 'array', items: { type: 'string', description: 'Node ID.' }, description: 'Array of node IDs to update (same set for all).' },
        set: {
          type: 'object',
          description: 'Fields to update (used with nodeId/nodeIds). ONLY include the fields you want to change.',
          properties: {
            title: { type: 'string', description: 'New display title (all node types).' },
            content: { type: 'string', description: 'Text content (text nodes only).' },
            prompt: { type: 'string', description: 'Prompt text (image/video/audio nodes).' },
            negativePrompt: { type: 'string', description: 'Negative prompt (image/video/audio).' },
          },
        },
        nodes: {
          type: 'array',
          description: 'Per-node updates with different values. Each entry has nodeId + set.',
          items: {
            type: 'object',
            description: 'A per-node update.',
            properties: {
              nodeId: { type: 'string', description: 'Node ID.' },
              set: {
                type: 'object',
                description: 'Fields to update for this node.',
                properties: {
                  title: { type: 'string', description: 'New display title.' },
                  content: { type: 'string', description: 'Text content.' },
                  prompt: { type: 'string', description: 'Prompt text.' },
                  negativePrompt: { type: 'string', description: 'Negative prompt.' },
                },
              },
            },
          },
        },
      },
      required: ['canvasId'],
    },
    async execute(args) {
      try {
        const canvasId = requireString(args, 'canvasId');
        const warnings = warnExtraKeys(args);

        // Build work items: either from "nodes" array or from nodeId/nodeIds + set
        type WorkItem = { nodeId: string; set: Record<string, unknown> };
        let workItems: WorkItem[];

        if (Array.isArray(args.nodes) && args.nodes.length > 0) {
          workItems = (args.nodes as Array<Record<string, unknown>>).map((entry) => ({
            nodeId: String(entry.nodeId ?? ''),
            set: (entry.set as Record<string, unknown>) ?? {},
          }));
        } else {
          const ids = resolveNodeIds(args);
          const set = extractSet(args);
          workItems = ids.map((id) => ({ nodeId: id, set }));
        }

        const results: Array<{ nodeId: string; updated: Record<string, unknown> }> = [];
        for (const { nodeId, set } of workItems) {
          const { node } = await requireNode(deps, canvasId, nodeId);
          const data: Record<string, unknown> = {};
          const isMedia = isGeneratableMedia(node.type);

          if (typeof set.title === 'string') {
            const title = (set.title as string).trim();
            if (title.length > 0) await deps.renameNode(canvasId, nodeId, title);
          }
          if (node.type === 'text' && typeof set.content === 'string') data.content = set.content;
          if (isMedia && typeof set.prompt === 'string') data.prompt = set.prompt;
          if (isMedia && typeof set.negativePrompt === 'string') data.negativePrompt = set.negativePrompt;

          if (Object.keys(data).length > 0) await deps.updateNodeData(canvasId, nodeId, data);
          results.push({ nodeId, updated: { ...data, ...(typeof set.title === 'string' ? { title: (set.title as string).trim() } : {}) } });
        }
        if (results.length === 1) return ok({ nodeId: results[0].nodeId, updated: results[0].updated, ...(warnings.length > 0 && { warnings }) });
        return ok({ nodes: results, ...(warnings.length > 0 && { warnings }) });
      } catch (error) {
        return fail(error);
      }
    },
  };

  // ---------------------------------------------------------------------------
  // canvas.setNodeLayout — position, flags, colorTag
  // ---------------------------------------------------------------------------
  const setNodeLayout: AgentTool = {
    name: 'canvas.setNodeLayout',
    description: `Set layout properties on one or more nodes: position, bypassed, locked, colorTag. Wrap fields in "set": { ... }.`,
    context: CANVAS_CONTEXT,
    tier: 2,
    parameters: {
      type: 'object',
      properties: {
        canvasId: { type: 'string', description: 'The target canvas ID.' },
        nodeId: { type: 'string', description: 'Single node ID.' },
        nodeIds: { type: 'array', items: { type: 'string', description: 'Node ID.' }, description: 'Array of node IDs (batch).' },
        set: {
          type: 'object',
          description: 'Layout fields to change.',
          properties: {
            position: { type: 'object', description: 'New position.', properties: { x: { type: 'number', description: 'Horizontal coordinate.' }, y: { type: 'number', description: 'Vertical coordinate.' } } },
            colorTag: { type: 'string', description: 'Color tag string.' },
            bypassed: { type: 'boolean', description: 'Set bypass state.' },
            locked: { type: 'boolean', description: 'Set lock state.' },
          },
        },
      },
      required: ['canvasId', 'set'],
    },
    async execute(args) {
      try {
        const canvasId = requireString(args, 'canvasId');
        const ids = resolveNodeIds(args);
        const set = extractSet(args);

        const results: Array<{ nodeId: string; updated: Record<string, unknown> }> = [];
        for (const nodeId of ids) {
          const updated: Record<string, unknown> = {};

          if (typeof set.colorTag === 'string') {
            await deps.setNodeColorTag(canvasId, nodeId, set.colorTag as string);
            updated.colorTag = set.colorTag;
          }
          if (set.position && typeof set.position === 'object') {
            const pos = set.position as Record<string, unknown>;
            if (typeof pos.x === 'number' && typeof pos.y === 'number') {
              await deps.moveNode(canvasId, nodeId, { x: pos.x, y: pos.y });
              updated.position = set.position;
            }
          }
          const nodeFlags: Partial<{ bypassed: boolean; locked: boolean }> = {};
          if (typeof set.bypassed === 'boolean') nodeFlags.bypassed = set.bypassed as boolean;
          if (typeof set.locked === 'boolean') nodeFlags.locked = set.locked as boolean;
          if (Object.keys(nodeFlags).length > 0) {
            const { node } = await requireNode(deps, canvasId, nodeId);
            await replaceNodePreservingEdges(deps, canvasId, node, nodeFlags);
            Object.assign(updated, nodeFlags);
          }
          results.push({ nodeId, updated });
        }
        return ok(results.length === 1 ? results[0] : results);
      } catch (error) {
        return fail(error);
      }
    },
  };

  // ---------------------------------------------------------------------------
  // canvas.setNodeProvider — provider, seed, seedLock, variantCount
  // ---------------------------------------------------------------------------
  const setNodeProvider: AgentTool = {
    name: 'canvas.setNodeProvider',
    description: `Set provider and seed options on image/video/audio nodes. Wrap fields in "set": { ... }.
IMPORTANT: Before assigning providerId, verify the provider has an API key (hasKey=true) via provider.list.`,
    context: CANVAS_CONTEXT,
    tier: 2,
    parameters: {
      type: 'object',
      properties: {
        canvasId: { type: 'string', description: 'The target canvas ID.' },
        nodeId: { type: 'string', description: 'Single node ID.' },
        nodeIds: { type: 'array', items: { type: 'string', description: 'Node ID.' }, description: 'Array of node IDs (batch).' },
        set: {
          type: 'object',
          description: 'Fields to change. ONLY include the ones you want to set.',
          properties: {
            providerId: { type: 'string', description: 'AI provider ID. Verify hasKey=true via provider.list first.' },
            seed: { type: 'number', description: 'Seed value.' },
            seedLock: { type: 'boolean', description: 'Pass true to toggle seed lock state.' },
            variantCount: { type: 'number', description: 'Variant count: 1, 2, 4, 9, or 25 (image/video only).' },
          },
        },
      },
      required: ['canvasId', 'set'],
    },
    async execute(args) {
      try {
        const canvasId = requireString(args, 'canvasId');
        const ids = resolveNodeIds(args);
        const set = extractSet(args);

        if (typeof set.variantCount === 'number') {
          const count = Math.round(set.variantCount as number);
          if (![1, 2, 4, 9, 25].includes(count)) throw new Error('variantCount must be one of 1, 2, 4, 9, or 25');
        }

        let keyWarning: string | undefined;
        if (typeof set.providerId === 'string' && deps.isProviderKeyConfigured) {
          const hasKey = await deps.isProviderKeyConfigured(set.providerId as string);
          if (!hasKey) {
            keyWarning = `Warning: Provider "${set.providerId}" does not have an API key configured. Generation will fail. Use provider.list to find providers with hasKey=true.`;
          }
        }

        const results: Array<{ nodeId: string; updated: Record<string, unknown> }> = [];
        for (const nodeId of ids) {
          const { node } = await requireNode(deps, canvasId, nodeId);
          const data: Record<string, unknown> = {};
          const isMedia = isGeneratableMedia(node.type);
          const isVisual = isVisualMedia(node.type);

          if (isMedia && typeof set.providerId === 'string') data.providerId = (set.providerId as string).trim();
          if (isMedia && typeof set.seed === 'number') data.seed = Math.round(set.seed as number);
          if (isMedia && set.seedLock === true) await deps.toggleSeedLock(canvasId, nodeId);
          if (isVisual && typeof set.variantCount === 'number') data.variantCount = Math.round(set.variantCount as number);

          if (Object.keys(data).length > 0) await deps.updateNodeData(canvasId, nodeId, data);
          results.push({ nodeId, updated: { ...data, ...(set.seedLock === true ? { seedLockToggled: true } : {}) } });
        }
        const warningObj = keyWarning ? { _warning: keyWarning } : {};
        const payload = results.length === 1 ? results[0] : results;
        return ok({ ...payload, ...warningObj });
      } catch (error) {
        return fail(error);
      }
    },
  };

  // ---------------------------------------------------------------------------
  // canvas.setImageParams — image/video visual generation parameters
  // ---------------------------------------------------------------------------
  const setImageParams: AgentTool = {
    name: 'canvas.setImageParams',
    description: 'Set visual generation parameters on image or video nodes. Wrap fields in "set": { ... }.',
    context: CANVAS_CONTEXT,
    tier: 2,
    parameters: {
      type: 'object',
      properties: {
        canvasId: { type: 'string', description: 'The target canvas ID.' },
        nodeId: { type: 'string', description: 'Single node ID.' },
        nodeIds: { type: 'array', items: { type: 'string', description: 'Node ID.' }, description: 'Array of node IDs (batch).' },
        set: {
          type: 'object',
          description: 'Parameters to change. ONLY include the ones you want to set.',
          properties: {
            width: { type: 'number', description: 'Width in pixels.' },
            height: { type: 'number', description: 'Height in pixels.' },
            steps: { type: 'number', description: 'Inference steps, typically 20-50.' },
            cfgScale: { type: 'number', description: 'CFG scale / guidance, typically 3-15.' },
            scheduler: { type: 'string', description: 'Sampling scheduler (e.g. "euler_a", "dpm++_2m").' },
            img2imgStrength: { type: 'number', description: 'Image-to-image strength 0-1.' },
          },
        },
      },
      required: ['canvasId', 'set'],
    },
    async execute(args) {
      try {
        const canvasId = requireString(args, 'canvasId');
        const ids = resolveNodeIds(args);
        const set = extractSet(args);

        const results: Array<{ nodeId: string; updated: Record<string, unknown> }> = [];
        for (const nodeId of ids) {
          const { node } = await requireNode(deps, canvasId, nodeId);
          if (node.type !== 'image' && node.type !== 'video') {
            throw new Error(`Node "${nodeId}" type "${node.type}" is not an image or video node`);
          }
          const data: Record<string, unknown> = {};
          if (typeof set.width === 'number') data.width = set.width;
          if (typeof set.height === 'number') data.height = set.height;
          if (typeof set.steps === 'number') data.steps = Math.round(set.steps as number);
          if (typeof set.cfgScale === 'number') data.cfgScale = set.cfgScale;
          if (typeof set.scheduler === 'string') data.scheduler = set.scheduler;
          if (typeof set.img2imgStrength === 'number') data.img2imgStrength = Math.max(0, Math.min(1, set.img2imgStrength as number));

          if (Object.keys(data).length > 0) await deps.updateNodeData(canvasId, nodeId, data);
          results.push({ nodeId, updated: data });
        }
        return ok(results.length === 1 ? results[0] : results);
      } catch (error) {
        return fail(error);
      }
    },
  };

  // ---------------------------------------------------------------------------
  // canvas.setVideoParams — video-specific generation parameters
  // ---------------------------------------------------------------------------
  const setVideoParams: AgentTool = {
    name: 'canvas.setVideoParams',
    description: `Set video-specific generation parameters on video nodes. Wrap fields in "set": { ... }.
Audio generation: only ${AUDIO_CAPABLE_VIDEO_PROVIDER_IDS} support audio.
Quality tiers: ${KLING_QUALITY_DESCRIPTION}.`,
    context: CANVAS_CONTEXT,
    tier: 2,
    parameters: {
      type: 'object',
      properties: {
        canvasId: { type: 'string', description: 'The target canvas ID.' },
        nodeId: { type: 'string', description: 'Single video node ID.' },
        nodeIds: { type: 'array', items: { type: 'string', description: 'Node ID.' }, description: 'Array of video node IDs (batch).' },
        set: {
          type: 'object',
          description: 'Parameters to change. ONLY include the ones you want to set.',
          properties: {
            duration: { type: 'number', description: 'Duration in seconds.' },
            audio: { type: 'boolean', description: 'Enable audio generation.' },
            quality: { type: 'string', description: `Quality tier. ${KLING_QUALITY_DESCRIPTION}.` },
            lipSyncEnabled: { type: 'boolean', description: 'Enable lip sync.' },
          },
        },
      },
      required: ['canvasId', 'set'],
    },
    async execute(args) {
      try {
        const canvasId = requireString(args, 'canvasId');
        const ids = resolveNodeIds(args);
        const set = extractSet(args);

        const results: Array<{ nodeId: string; updated: Record<string, unknown> }> = [];
        for (const nodeId of ids) {
          const { node } = await requireNode(deps, canvasId, nodeId);
          if (node.type !== 'video') {
            throw new Error(`Node "${nodeId}" type "${node.type}" is not a video node`);
          }
          const data: Record<string, unknown> = {};
          if (typeof set.duration === 'number') data.duration = set.duration;
          if (typeof set.audio === 'boolean') data.audio = set.audio;
          if (typeof set.quality === 'string') data.quality = set.quality;
          if (typeof set.lipSyncEnabled === 'boolean') data.lipSyncEnabled = set.lipSyncEnabled;

          if (Object.keys(data).length > 0) await deps.updateNodeData(canvasId, nodeId, data);
          results.push({ nodeId, updated: data });
        }
        return ok(results.length === 1 ? results[0] : results);
      } catch (error) {
        return fail(error);
      }
    },
  };

  // ---------------------------------------------------------------------------
  // canvas.setAudioParams — audio-specific generation parameters
  // ---------------------------------------------------------------------------
  const setAudioParams: AgentTool = {
    name: 'canvas.setAudioParams',
    description: 'Set audio-specific generation parameters on audio nodes. Wrap fields in "set": { ... }.',
    context: CANVAS_CONTEXT,
    tier: 2,
    parameters: {
      type: 'object',
      properties: {
        canvasId: { type: 'string', description: 'The target canvas ID.' },
        nodeId: { type: 'string', description: 'Single audio node ID.' },
        nodeIds: { type: 'array', items: { type: 'string', description: 'Node ID.' }, description: 'Array of audio node IDs (batch).' },
        set: {
          type: 'object',
          description: 'Parameters to change. ONLY include the ones you want to set.',
          properties: {
            audioType: { type: 'string', enum: ['voice', 'sfx', 'music'], description: 'Audio type.' },
            emotionVector: {
              type: 'object',
              description: 'Emotion vector for TTS. Each key 0-1.',
              properties: {
                happy: { type: 'number', description: '0-1.' }, sad: { type: 'number', description: '0-1.' }, angry: { type: 'number', description: '0-1.' },
                fearful: { type: 'number', description: '0-1.' }, surprised: { type: 'number', description: '0-1.' }, disgusted: { type: 'number', description: '0-1.' },
                contemptuous: { type: 'number', description: '0-1.' }, neutral: { type: 'number', description: '0-1.' },
              },
            },
          },
        },
      },
      required: ['canvasId', 'set'],
    },
    async execute(args) {
      try {
        const canvasId = requireString(args, 'canvasId');
        const ids = resolveNodeIds(args);
        const set = extractSet(args);

        const results: Array<{ nodeId: string; updated: Record<string, unknown> }> = [];
        for (const nodeId of ids) {
          const { node } = await requireNode(deps, canvasId, nodeId);
          if (node.type !== 'audio') {
            throw new Error(`Node "${nodeId}" type "${node.type}" is not an audio node`);
          }
          const data: Record<string, unknown> = {};
          if (typeof set.audioType === 'string') {
            const validAudioTypes = ['voice', 'sfx', 'music'];
            if (!validAudioTypes.includes(set.audioType as string)) throw new Error(`audioType must be one of: ${validAudioTypes.join(', ')}`);
            data.audioType = set.audioType;
          }
          if (set.emotionVector !== undefined && set.emotionVector !== null) data.emotionVector = set.emotionVector;

          if (Object.keys(data).length > 0) await deps.updateNodeData(canvasId, nodeId, data);
          results.push({ nodeId, updated: data });
        }
        return ok(results.length === 1 ? results[0] : results);
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

  const previewPrompt: AgentTool = {
    name: 'canvas.previewPrompt',
    description: 'Preview the fully compiled prompt that would be sent to the generation provider, including all preset fragments, entity descriptions, word budget trimming, and diagnostics. Does NOT trigger generation.',
    context: CANVAS_CONTEXT,
    tier: 1,
    parameters: {
      type: 'object',
      properties: {
        canvasId: { type: 'string', description: 'The target canvas ID.' },
        nodeId: { type: 'string', description: 'The node ID to preview.' },
      },
      required: ['canvasId', 'nodeId'],
    },
    async execute(args) {
      try {
        if (!deps.previewPrompt) {
          return fail('previewPrompt is not available');
        }
        const canvasId = requireString(args, 'canvasId');
        const nodeId = requireString(args, 'nodeId');
        await requireNode(deps, canvasId, nodeId);
        return ok(await deps.previewPrompt(canvasId, nodeId));
      } catch (error) {
        return fail(error);
      }
    },
  };

  const addNote: AgentTool = {
    name: 'canvas.addNote',
    description: 'Add a new note to the canvas.',
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
    description: 'Update an existing canvas note.',
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
    description: 'Delete a canvas note.',
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
    description: 'Update one or more properties of a backdrop node in a single call. Wrap all fields you want to change inside "set": { ... }. Only fields present in "set" will be applied — omitted fields are left untouched. Supported fields: opacity (number), color (string), borderStyle ("dashed"|"solid"|"dotted"), titleSize ("sm"|"md"|"lg"), lockChildren (boolean), toggleCollapse (pass true to toggle).',
    context: CANVAS_CONTEXT,
    tier: 2,
    parameters: {
      type: 'object',
      properties: {
        canvasId: { type: 'string', description: 'The target canvas ID.' },
        nodeId: { type: 'string', description: 'The backdrop node ID to update.' },
        set: {
          type: 'object',
          description: 'Fields to update. ONLY include the fields you want to change — omitted fields are left untouched.',
          properties: {
            opacity: { type: 'number', description: 'Backdrop opacity value.' },
            color: { type: 'string', description: 'Backdrop background color.' },
            borderStyle: { type: 'string', description: 'Border style.', enum: ['dashed', 'solid', 'dotted'] },
            titleSize: { type: 'string', description: 'Title size.', enum: ['sm', 'md', 'lg'] },
            lockChildren: { type: 'boolean', description: 'Whether child nodes are locked inside the backdrop.' },
            toggleCollapse: { type: 'boolean', description: 'Pass true to toggle the collapsed state.' },
          },
        },
      },
      required: ['canvasId', 'nodeId', 'set'],
    },
    async execute(args) {
      try {
        const canvasId = requireString(args, 'canvasId');
        const nodeId = requireString(args, 'nodeId');
        const { node } = await requireNode(deps, canvasId, nodeId);
        requireBackdropNode(node);

        const set = extractSet(args);
        const warnings = warnExtraKeys(args);

        const data: Record<string, unknown> = {};
        if (typeof set.opacity === 'number') {
          if (!Number.isFinite(set.opacity as number)) throw new Error('opacity must be a finite number');
          data.opacity = set.opacity;
        }
        if (typeof set.color === 'string') data.color = set.color;
        if (typeof set.borderStyle === 'string') {
          if (set.borderStyle !== 'dashed' && set.borderStyle !== 'solid' && set.borderStyle !== 'dotted') {
            throw new Error('borderStyle must be one of dashed, solid, or dotted');
          }
          data.borderStyle = set.borderStyle;
        }
        if (typeof set.titleSize === 'string') {
          if (set.titleSize !== 'sm' && set.titleSize !== 'md' && set.titleSize !== 'lg') {
            throw new Error('titleSize must be one of sm, md, or lg');
          }
          data.titleSize = set.titleSize;
        }
        if (typeof set.lockChildren === 'boolean') data.lockChildren = set.lockChildren;
        if (set.toggleCollapse === true) {
          data.collapsed = !((node.data as { collapsed?: boolean }).collapsed ?? false);
        }

        if (Object.keys(data).length > 0) {
          await deps.updateNodeData(canvasId, nodeId, data);
        }
        return ok({ nodeId, ...data, ...(warnings.length > 0 && { warnings }) });
      } catch (error) {
        return fail(error);
      }
    },
  };

  const setNodeRefs: AgentTool = {
    name: 'canvas.setNodeRefs',
    description: `Set character, equipment, and/or location references on image/video nodes. Two modes:
1. Same refs for multiple nodes: use nodeId/nodeIds + characterRefs/equipmentRefs/locationRefs at top level.
2. Different refs per node: use "nodes": [{ nodeId, characterRefs?, equipmentRefs?, locationRefs? }, ...] — preferred for efficiency.
Pass empty array to clear refs of that type. Only provide the ref types you want to change — omitted types are left unchanged.`,
    context: CANVAS_CONTEXT,
    tier: 2,
    parameters: {
      type: 'object',
      properties: {
        canvasId: { type: 'string', description: 'The target canvas ID.' },
        nodeId: { type: 'string', description: 'Single node ID to update.' },
        nodeIds: { type: 'array', items: { type: 'string', description: 'Node ID.' }, description: 'Batch: array of node IDs to update (same refs for all).' },
        characterRefs: {
          type: 'array',
          description: 'Array of character references (used with nodeId/nodeIds).',
          items: { type: 'object', description: 'A character reference.', properties: { characterId: { type: 'string', description: 'Character ID.' }, loadoutId: { type: 'string', description: 'Optional loadout ID.' } } },
        },
        equipmentRefs: {
          type: 'array',
          description: 'Array of equipment references (used with nodeId/nodeIds).',
          items: { type: 'object', description: 'An equipment reference.', properties: { equipmentId: { type: 'string', description: 'Equipment ID.' } } },
        },
        locationRefs: {
          type: 'array',
          description: 'Array of location references (used with nodeId/nodeIds).',
          items: { type: 'object', description: 'A location reference.', properties: { locationId: { type: 'string', description: 'Location ID.' } } },
        },
        nodes: {
          type: 'array',
          description: 'Per-node refs with different values. Each entry has nodeId + ref arrays.',
          items: {
            type: 'object',
            description: 'A per-node ref update.',
            properties: {
              nodeId: { type: 'string', description: 'Node ID.' },
              characterRefs: {
                type: 'array',
                description: 'Character references for this node.',
                items: { type: 'object', description: 'Character ref.', properties: { characterId: { type: 'string', description: 'Character ID.' }, loadoutId: { type: 'string', description: 'Loadout ID.' } } },
              },
              equipmentRefs: {
                type: 'array',
                description: 'Equipment references for this node.',
                items: { type: 'object', description: 'Equipment ref.', properties: { equipmentId: { type: 'string', description: 'Equipment ID.' } } },
              },
              locationRefs: {
                type: 'array',
                description: 'Location references for this node.',
                items: { type: 'object', description: 'Location ref.', properties: { locationId: { type: 'string', description: 'Location ID.' } } },
              },
            },
          },
        },
      },
      required: ['canvasId'],
    },
    async execute(args) {
      try {
        const canvasId = requireString(args, 'canvasId');

        // Parse ref arrays from a raw object (args or a per-node entry)
        type ParsedRefs = {
          characterRefs?: Array<{ characterId: string; loadoutId: string }>;
          equipmentRefs?: Array<{ equipmentId: string }>;
          locationRefs?: Array<{ locationId: string }>;
        };
        function parseRefs(source: Record<string, unknown>): ParsedRefs {
          const parsed: ParsedRefs = {};
          if (Array.isArray(source.characterRefs)) {
            parsed.characterRefs = (source.characterRefs as Array<Record<string, unknown>>).map((r) => ({
              characterId: String(r.characterId ?? ''),
              loadoutId: typeof r.loadoutId === 'string' ? r.loadoutId : '',
            }));
          }
          if (Array.isArray(source.equipmentRefs)) {
            parsed.equipmentRefs = (source.equipmentRefs as Array<Record<string, unknown>>).map((r) => ({
              equipmentId: String(r.equipmentId ?? ''),
            }));
          }
          if (Array.isArray(source.locationRefs)) {
            parsed.locationRefs = (source.locationRefs as Array<Record<string, unknown>>).map((r) => ({
              locationId: String(r.locationId ?? ''),
            }));
          }
          return parsed;
        }

        // Build work items: either from "nodes" array or from nodeId/nodeIds + top-level refs
        type RefWorkItem = { nodeId: string; refs: ParsedRefs };
        let workItems: RefWorkItem[];

        if (Array.isArray(args.nodes) && args.nodes.length > 0) {
          workItems = (args.nodes as Array<Record<string, unknown>>).map((entry) => ({
            nodeId: String(entry.nodeId ?? ''),
            refs: parseRefs(entry),
          }));
        } else {
          const nodeIds = resolveNodeIds(args);
          const sharedRefs = parseRefs(args);
          if (!sharedRefs.characterRefs && !sharedRefs.equipmentRefs && !sharedRefs.locationRefs) {
            throw new Error('At least one of characterRefs, equipmentRefs, or locationRefs is required');
          }
          workItems = nodeIds.map((id) => ({ nodeId: id, refs: sharedRefs }));
        }

        const results: Array<{ nodeId: string; success: boolean; error?: string }> = [];
        for (const { nodeId, refs } of workItems) {
          try {
            if (!refs.characterRefs && !refs.equipmentRefs && !refs.locationRefs) {
              results.push({ nodeId, success: false, error: 'No ref arrays provided for this node' });
              continue;
            }
            const { node } = await requireNode(deps, canvasId, nodeId);
            if (node.type !== 'image' && node.type !== 'video') {
              results.push({ nodeId, success: false, error: `Node type "${node.type}" does not support entity refs` });
              continue;
            }
            const data: Record<string, unknown> = {};
            if (refs.characterRefs !== undefined) data.characterRefs = refs.characterRefs;
            if (refs.equipmentRefs !== undefined) data.equipmentRefs = refs.equipmentRefs;
            if (refs.locationRefs !== undefined) data.locationRefs = refs.locationRefs;
            await deps.updateNodeData(canvasId, nodeId, data);
            results.push({ nodeId, success: true });
          } catch (error) {
            results.push({ nodeId, success: false, error: error instanceof Error ? error.message : String(error) });
          }
        }
        if (workItems.length === 1) {
          const r = results[0];
          if (!r.success) return fail(r.error!);
          const responseData: Record<string, unknown> = { nodeId: workItems[0].nodeId };
          const { refs } = workItems[0];
          if (refs.characterRefs !== undefined) responseData.characterRefs = refs.characterRefs;
          if (refs.equipmentRefs !== undefined) responseData.equipmentRefs = refs.equipmentRefs;
          if (refs.locationRefs !== undefined) responseData.locationRefs = refs.locationRefs;
          return ok(responseData);
        }
        return ok({ updated: results.filter((r) => r.success).length, total: workItems.length, results });
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
    generate, cancelGeneration, updateNodes, setNodeLayout,
    setNodeProvider, setImageParams, setVideoParams, setAudioParams,
    selectVariant, estimateCost, previewPrompt,
    addNote, updateNote, deleteNote, undo, redo,
    deleteNode, deleteEdge, swapEdgeDirection, disconnectNode, setVideoFrames,
    updateBackdrop, setNodeRefs,
  ];
}
