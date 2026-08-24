import {
  getBuiltinProviderCapabilityProfile,
  listBuiltinVideoProvidersWithAudio,
  type Canvas,
  type CanvasEdge,
  type CanvasNode,
  type CharacterRef,
  type EquipmentRef,
  type LocationRef,
  type PromptAssemblyOutputV1,
  type PromptAssemblySourceDecision,
  type ContextFactRelation,
} from '@lucid-fin/contracts';
import {
  NO_TOOL_RESOURCE,
  meteredToolResource,
  type ToolDefinition,
  type CanvasToolDeps,
  type MediaProviderConfig,
} from './canvas-tool-utils.js';
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
  parseResolutionIntent,
  TypedToolError,
} from './canvas-tool-utils.js';
import { extractSet, warnExtraKeys } from './tool-result-helpers.js';
import {
  authorityFact,
  contextProjector,
  record,
  records,
  resultRecord,
  stringValues,
  valueFact,
} from './context-replay.js';
import { isGeneratableMedia, isVisualMedia } from '@lucid-fin/shared-utils';
import { toolResultSchema } from '../tool-registry.js';
import {
  arraySchema,
  booleanSchema,
  canonicalJsonSchema,
  canvasEdgeSchema,
  canvasNoteSchema,
  entityReferenceSchema,
  mediaTaskViewSchema,
  numberSchema,
  objectSchema,
  promptAssemblyRecordSchema,
  resolutionPreflightSchema,
  stringArraySchema,
  stringSchema,
  unionSchema,
} from './tool-runtime-schemas.js';

const AUDIO_CAPABLE_VIDEO_PROVIDER_IDS = listBuiltinVideoProvidersWithAudio().join(', ');
const KLING_QUALITY_TIERS = getBuiltinProviderCapabilityProfile('kling-v1')?.qualityTiers ?? [];
const KLING_QUALITY_DESCRIPTION =
  KLING_QUALITY_TIERS.length > 0
    ? `kling-v1: ${KLING_QUALITY_TIERS.map((tier) => `"${tier}"`).join(' or ')}`
    : 'provider-specific';

const nodeMutationSchema = objectSchema(
  { nodeId: stringSchema, updated: canonicalJsonSchema },
  ['nodeId', 'updated'],
);
const mutationAttemptSchema = objectSchema(
  { nodeId: stringSchema, success: booleanSchema, error: stringSchema },
  ['nodeId', 'success'],
);
const characterRefSchema = entityReferenceSchema('characterId');
const equipmentRefSchema = entityReferenceSchema('equipmentId');
const locationRefSchema = entityReferenceSchema('locationId');

export function createCanvasGenerationTools(deps: CanvasToolDeps): ToolDefinition[] {
  const nodeReplayFacts = (
    args: Record<string, unknown>,
    relation: ContextFactRelation,
  ) => [
    ...stringValues(args.nodeIds),
    ...stringValues(args.nodeId),
    ...records(args.nodes).flatMap((node) => stringValues(node.nodeId)),
  ].map((nodeId) =>
    authorityFact('canvas_node', relation, nodeId, { scopeId: args.canvasId }),
  );

  /** Resolve nodeId (string) or nodeIds (string[]) from tool args. */
  function resolveNodeIds(args: Record<string, unknown>): string[] {
    if (Array.isArray(args.nodeIds) && args.nodeIds.length > 0) {
      return args.nodeIds.map((id: unknown) => (typeof id === 'string' ? id.trim() : String(id)));
    }
    return [requireString(args, 'nodeId')];
  }

  function indexNodes(canvas: Canvas): Map<string, CanvasNode> {
    return new Map(canvas.nodes.map((node) => [node.id, node]));
  }

  function requireIndexedNode(nodesById: Map<string, CanvasNode>, nodeId: string): CanvasNode {
    const node = nodesById.get(nodeId);
    if (!node) throw new Error(`Node not found: ${nodeId}`);
    return node;
  }

  function mergedNodeData(
    node: CanvasNode,
    data: Record<string, unknown>,
    clearFields: string[] = [],
  ): CanvasNode['data'] {
    const next = { ...(node.data as unknown as Record<string, unknown>), ...data };
    for (const field of clearFields) delete next[field];
    return next as unknown as CanvasNode['data'];
  }

  async function commitNodeUpdates(
    canvasId: string,
    updatedNodes: Array<{ id: string; changes: Record<string, unknown> }>,
  ): Promise<void> {
    if (updatedNodes.length === 0) return;
    await deps.patchCanvas(canvasId, {
      canvasId,
      timestamp: Date.now(),
      operations: ['updateNode'],
      updatedNodes,
    });
  }

  function buildResolutionMutation(set: Record<string, unknown>): {
    data: Record<string, unknown>;
    clearFields: string[];
  } {
    const hasWidth = 'width' in set;
    const hasHeight = 'height' in set;
    const hasIntent = 'resolution' in set;
    const clearOverride = set.clearResolutionOverride === true;
    if (clearOverride && (hasWidth || hasHeight || hasIntent)) {
      throw new Error(
        'clearResolutionOverride cannot be combined with width, height, or resolution',
      );
    }
    if (hasIntent && (hasWidth || hasHeight)) {
      throw new Error('resolution cannot be combined with legacy width or height');
    }
    if (hasWidth !== hasHeight) {
      throw new Error('width and height must be provided together');
    }
    if (clearOverride) {
      return { data: {}, clearFields: ['resolutionIntent', 'width', 'height'] };
    }

    const intent = hasIntent
      ? parseResolutionIntent(set.resolution)
      : hasWidth && hasHeight
        ? parseResolutionIntent({ mode: 'exact', width: set.width, height: set.height })
        : undefined;
    if (!intent) return { data: {}, clearFields: [] };
    if (intent.mode === 'exact') {
      return {
        data: { resolutionIntent: intent, width: intent.width, height: intent.height },
        clearFields: [],
      };
    }
    return { data: { resolutionIntent: intent }, clearFields: ['width', 'height'] };
  }

  // ---------------------------------------------------------------------------
  // canvas.generation — durable media.generation.v1 Task List control
  // ---------------------------------------------------------------------------
  async function prepareMediaTask(args: Record<string, unknown>) {
    const canvasId = requireString(args, 'canvasId');
    const nodeId = requireString(args, 'nodeId');
    const providerId = readOptionalString(args.providerId, 'providerId');
    const intent = readOptionalString(args.intent, 'intent');
    const parentAttemptId = readOptionalString(args.parentAttemptId, 'parentAttemptId');
    const feedback = readOptionalString(args.feedback, 'feedback');
    if (Boolean(parentAttemptId) !== Boolean(feedback)) {
      throw new TypedToolError(
        'parentAttemptId and feedback must be provided together for refinement',
        'validation',
      );
    }
    const providerConfig = parseProviderConfig(args.providerConfig);
    const task = await deps.prepareMediaTask({
      canvasId,
      nodeId,
      ...(providerId ? { providerId } : {}),
      ...(providerConfig ? { providerConfig } : {}),
      ...(intent ? { intent } : {}),
      ...(parentAttemptId ? { parentAttemptId, feedback } : {}),
    });
    if (!task.promptAssembly) {
      throw new Error(`Media Task List ${task.id} did not prepare a Prompt Assembly`);
    }
    return ok({ taskListId: task.id, promptAssembly: task.promptAssembly });
  }

  const generation: ToolDefinition = {
    name: 'canvas.generation',
    process: 'image-node-generation',
    category: 'mutation',
    contextReplay: 'authority_reread',
    resource: meteredToolResource(
      (args) => args.action === 'submit' || args.action === 'retryEvaluation',
    ),
    uiEffects: [{ kind: 'canvas.refresh' }] as const,
    description:
      'Durable manual image/video generation through media.generation.v1 Task Lists. Call prepare to persist the task and immutable Prompt Assembly input, then submit its exact Commander-authored assembly. Use inspectAssembly with assemblyId to audit its sources, decisions, warnings, and lineage later. Use status, cancel, or retryEvaluation with taskListId. retryEvaluation retries only visual evaluation and never resubmits the provider. prepare accepts feedback and parentAttemptId together for a durable refinement. estimate never creates a task.',
    contexts: CANVAS_CONTEXT,
    tier: 2,
    outputSchema: toolResultSchema(
      unionSchema(
        objectSchema({ taskListId: stringSchema, promptAssembly: promptAssemblyRecordSchema }),
        mediaTaskViewSchema,
        promptAssemblyRecordSchema,
        objectSchema({
          totalEstimatedCost: numberSchema,
          currency: stringSchema,
          nodeCosts: arraySchema(
            objectSchema({ nodeId: stringSchema, estimatedCost: numberSchema }),
          ),
        }),
      ),
    ),
    projectPublicResult: contextProjector((result, args) => {
      const data = resultRecord(result);
      const promptAssembly = record(data?.promptAssembly);
      if (args.action === 'prepare') {
        return [
          authorityFact('task_list', 'created', data?.taskListId),
          authorityFact('prompt_assembly', 'created', promptAssembly?.assemblyId, {
            revision: promptAssembly?.revision,
            contentHash: promptAssembly?.inputHash,
          }),
        ];
      }
      if (args.action === 'inspectAssembly') {
        return [authorityFact('prompt_assembly', 'read', args.assemblyId, {
          revision: data?.revision,
          contentHash: data?.inputHash,
        })];
      }
      if (args.action === 'estimate') {
        return [authorityFact('canvas', 'read', args.canvasId)];
      }
      return [
        authorityFact(
          'task_list',
          args.action === 'status' ? 'read' : 'updated',
          data?.id ?? args.taskListId,
          { revision: data?.rowVersion },
        ),
        ...(args.action === 'submit'
          ? [authorityFact('prompt_assembly', 'read', args.assemblyId)]
          : []),
      ];
    }),
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: [
            'prepare',
            'submit',
            'inspectAssembly',
            'status',
            'cancel',
            'retryEvaluation',
            'estimate',
          ],
          description: 'The durable media Task List action to perform.',
        },
        canvasId: { type: 'string', description: 'Required for prepare and estimate.' },
        nodeId: {
          type: 'string',
          description: 'Required for prepare.',
        },
        intent: {
          type: 'string',
          description:
            'For prepare only: current user intent as a separate prompt source.',
        },
        providerId: { type: 'string', description: 'Optional provider override for prepare.' },
        providerConfig: {
          type: 'object',
          description: 'Optional prepare-only custom provider configuration. When present, both baseUrl and model are required; never include apiKey.',
          properties: {
            baseUrl: { type: 'string', description: 'Custom provider base URL.' },
            model: { type: 'string', description: 'Custom provider model.' },
          },
        },
        parentAttemptId: {
          type: 'string',
          description: 'For prepare-only refinement: prior durable media attempt ID. Requires feedback.',
        },
        feedback: {
          type: 'string',
          description:
            'For prepare-only refinement: concise user feedback. Requires parentAttemptId.',
        },
        taskListId: {
          type: 'string',
          description: 'Required for submit, status, cancel, and retryEvaluation.',
        },
        assemblyId: {
          type: 'string',
          description: 'For submit or inspectAssembly: durable Prompt Assembly ID.',
        },
        assembly: {
          type: 'object',
          description:
            'For submit only: exact Commander-authored Prompt Assembly output for assemblyId.',
          properties: {
            version: { type: 'number', description: 'Must be 1.' },
            assemblyId: { type: 'string', description: 'Prepared assembly ID.' },
            inputHash: { type: 'string', description: 'Prepared immutable input hash.' },
            finalPrompt: {
              type: 'string',
              description: 'The single provider-facing image/video prompt.',
            },
            negativePrompt: {
              type: 'string',
              description: 'Optional provider-facing negative prompt.',
            },
            sourceDecisions: {
              type: 'array',
              description: 'Exactly one decision for every prepared source.',
              items: {
                type: 'object',
                description: 'How one source was reconciled.',
                properties: {
                  sourceId: { type: 'string', description: 'Copy from the source.' },
                  sourceHash: { type: 'string', description: 'Copy from the source.' },
                  disposition: {
                    type: 'string',
                    enum: ['applied', 'omitted', 'conflict-resolved'],
                    description: 'How the source affected the final prompt.',
                  },
                  reason: { type: 'string', description: 'Optional concise reason.' },
                },
              },
            },
            summary: { type: 'string', description: 'Concise assembly rationale.' },
            warnings: {
              type: 'array',
              description: 'Non-blocking prompt risks.',
              items: { type: 'string', description: 'Warning text.' },
            },
          },
        },
        nodeIds: {
          type: 'array',
          items: { type: 'string', description: 'Node ID.' },
          description: 'Optional node IDs for estimate.',
        },
      },
      required: ['action'],
    },
    async execute(args) {
      try {
        const action = requireString(args, 'action');
        switch (action) {
          case 'prepare':
            return await prepareMediaTask(args);
          case 'submit': {
            const taskListId = requireString(args, 'taskListId');
            const assemblyId = requireString(args, 'assemblyId');
            const assembly = parsePromptAssemblyOutput(args.assembly);
            if (assembly.assemblyId !== assemblyId) {
              throw new TypedToolError(
                'assemblyId does not match assembly.assemblyId',
                'validation',
              );
            }
            return ok(await deps.submitMediaPrompt({ taskListId, assemblyId, assembly }));
          }
          case 'status':
            return ok(await deps.getMediaTask(requireString(args, 'taskListId')));
          case 'inspectAssembly': {
            if (!deps.getPromptAssembly) {
              throw new Error('Prompt Assembly inspection is unavailable');
            }
            return ok(await deps.getPromptAssembly(requireString(args, 'assemblyId')));
          }
          case 'cancel':
            return ok(await deps.cancelMediaTask(requireString(args, 'taskListId')));
          case 'retryEvaluation':
            return ok(await deps.retryMediaEvaluation(requireString(args, 'taskListId')));
          case 'estimate': {
            const canvasId = requireString(args, 'canvasId');
            await requireCanvas(deps, canvasId);
            const nodeIds =
              Array.isArray(args.nodeIds) && args.nodeIds.length > 0
                ? requireStringArray(args, 'nodeIds')
                : undefined;
            return ok(await deps.estimateCost(canvasId, nodeIds));
          }
          default:
            return fail(
              `Unknown action "${action}". Must be one of: prepare, submit, inspectAssembly, status, cancel, retryEvaluation, estimate.`,
            );
        }
      } catch (error) {
        return fail(error);
      }
    },
  };

  // ---------------------------------------------------------------------------
  // canvas.updateNodes — content & prompt fields only
  // ---------------------------------------------------------------------------
  const updateNodes: ToolDefinition = {
    name: 'canvas.updateNodes',
    process: 'canvas-node-editing',
    category: 'mutation',
    contextReplay: 'authority_reread',
    resource: NO_TOOL_RESOURCE,
    projectPublicResult: contextProjector((_result, args) => nodeReplayFacts(args, 'updated')),
    uiEffects: [{ kind: 'canvas.refresh' }] as const,
    description: `Batch-update content and prompt fields on nodes. Two modes:
1. Same update for multiple nodes: use nodeId/nodeIds + "set": { ... }
2. Different updates per node: use "nodes": [{ nodeId, set: {...} }, ...] — preferred for efficiency when each node needs different values.
Supported fields in "set": title, content (text only), prompt, negativePrompt (media only).
For media generation params (width/height/steps/cfgScale/duration/audio/quality/audioType/emotionVector), use canvas.setMediaParams. For entity refs (character/location/equipment), use canvas.setNodeRefs. For layout (position/bypassed/locked), use canvas.setNodeLayout.`,
    contexts: CANVAS_CONTEXT,
    tier: 2,
    outputSchema: toolResultSchema(
      unionSchema(
        objectSchema(
          { nodeId: stringSchema, updated: canonicalJsonSchema, warnings: stringArraySchema },
          ['nodeId', 'updated'],
        ),
        objectSchema(
          { nodes: arraySchema(nodeMutationSchema), warnings: stringArraySchema },
          ['nodes'],
        ),
      ),
    ),
    inputSchema: {
      type: 'object',
      properties: {
        canvasId: { type: 'string', description: 'The target canvas ID.' },
        nodeId: { type: 'string', description: 'Single node ID to update.' },
        nodeIds: {
          type: 'array',
          items: { type: 'string', description: 'Node ID.' },
          description: 'Array of node IDs to update (same set for all).',
        },
        set: {
          type: 'object',
          description:
            'Fields to update (used with nodeId/nodeIds). ONLY include the fields you want to change.',
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

        const canvas = await requireCanvas(deps, canvasId);
        const nodesById = indexNodes(canvas);
        const updatedAt = Date.now();
        const patchUpdates: Array<{ id: string; changes: Record<string, unknown> }> = [];
        const results: Array<{ nodeId: string; updated: Record<string, unknown> }> = [];
        for (const { nodeId, set } of workItems) {
          const node = requireIndexedNode(nodesById, nodeId);
          const data: Record<string, unknown> = {};
          const isMedia = isGeneratableMedia(node.type);
          const changes: Record<string, unknown> = {};

          if (typeof set.title === 'string') {
            const title = (set.title as string).trim();
            if (title.length > 0) changes.title = title;
          }
          if (node.type === 'text' && typeof set.content === 'string') data.content = set.content;
          if (isMedia && typeof set.prompt === 'string') data.prompt = set.prompt;
          if (isMedia && typeof set.negativePrompt === 'string')
            data.negativePrompt = set.negativePrompt;

          if (Object.keys(data).length > 0) changes.data = mergedNodeData(node, data);
          if (Object.keys(changes).length > 0) {
            changes.updatedAt = updatedAt;
            patchUpdates.push({ id: nodeId, changes });
          }
          results.push({
            nodeId,
            updated: {
              ...data,
              ...(typeof set.title === 'string' ? { title: (set.title as string).trim() } : {}),
            },
          });
        }
        await commitNodeUpdates(canvasId, patchUpdates);
        if (results.length === 1)
          return ok({
            nodeId: results[0].nodeId,
            updated: results[0].updated,
            ...(warnings.length > 0 && { warnings }),
          });
        return ok({ nodes: results, ...(warnings.length > 0 && { warnings }) });
      } catch (error) {
        return fail(error);
      }
    },
  };

  // ---------------------------------------------------------------------------
  // canvas.setNodeLayout — position, flags, colorTag
  // ---------------------------------------------------------------------------
  const setNodeLayout: ToolDefinition = {
    name: 'canvas.setNodeLayout',
    process: 'canvas-node-editing',
    category: 'mutation',
    contextReplay: 'authority_reread',
    resource: NO_TOOL_RESOURCE,
    uiEffects: [{ kind: 'canvas.refresh' }] as const,
    description: `Set layout properties (position/bypassed/locked/colorTag) on one or more nodes. Wrap fields in "set": { ... }. Use this for node position and display state; for prompt text, use canvas.updateNodes. For entity refs, use canvas.setNodeRefs.`,
    contexts: CANVAS_CONTEXT,
    tier: 2,
    outputSchema: toolResultSchema(unionSchema(nodeMutationSchema, arraySchema(nodeMutationSchema))),
    projectPublicResult: contextProjector((_result, args) => nodeReplayFacts(args, 'updated')),
    inputSchema: {
      type: 'object',
      properties: {
        canvasId: { type: 'string', description: 'The target canvas ID.' },
        nodeId: { type: 'string', description: 'Single node ID.' },
        nodeIds: {
          type: 'array',
          items: { type: 'string', description: 'Node ID.' },
          description: 'Array of node IDs (batch).',
        },
        set: {
          type: 'object',
          description: 'Layout fields to change.',
          properties: {
            position: {
              type: 'object',
              description: 'New position.',
              properties: {
                x: { type: 'number', description: 'Horizontal coordinate.' },
                y: { type: 'number', description: 'Vertical coordinate.' },
              },
            },
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
        const canvas = await requireCanvas(deps, canvasId);
        const nodesById = indexNodes(canvas);
        const updatedAt = Date.now();
        const patchUpdates: Array<{ id: string; changes: Record<string, unknown> }> = [];

        const results: Array<{ nodeId: string; updated: Record<string, unknown> }> = [];
        for (const nodeId of ids) {
          requireIndexedNode(nodesById, nodeId);
          const updated: Record<string, unknown> = {};
          const changes: Record<string, unknown> = {};

          if (typeof set.colorTag === 'string') {
            changes.colorTag = set.colorTag;
            updated.colorTag = set.colorTag;
          }
          if (set.position && typeof set.position === 'object') {
            const pos = set.position as Record<string, unknown>;
            if (typeof pos.x === 'number' && typeof pos.y === 'number') {
              changes.position = { x: pos.x, y: pos.y };
              updated.position = set.position;
            }
          }
          const nodeFlags: Partial<{ bypassed: boolean; locked: boolean }> = {};
          if (typeof set.bypassed === 'boolean') nodeFlags.bypassed = set.bypassed as boolean;
          if (typeof set.locked === 'boolean') nodeFlags.locked = set.locked as boolean;
          if (Object.keys(nodeFlags).length > 0) {
            Object.assign(changes, nodeFlags);
            Object.assign(updated, nodeFlags);
          }
          if (Object.keys(changes).length > 0) {
            changes.updatedAt = updatedAt;
            patchUpdates.push({ id: nodeId, changes });
          }
          results.push({ nodeId, updated });
        }
        await commitNodeUpdates(canvasId, patchUpdates);
        return ok(results.length === 1 ? results[0] : results);
      } catch (error) {
        return fail(error);
      }
    },
  };

  // ---------------------------------------------------------------------------
  // canvas.configureNode — provider, seed, seedLock, variantCount
  // ---------------------------------------------------------------------------
  const configureNode: ToolDefinition = {
    name: 'canvas.configureNode',
    process: 'node-provider-selection',
    category: 'mutation',
    contextReplay: 'authority_reread',
    resource: NO_TOOL_RESOURCE,
    uiEffects: [{ kind: 'canvas.refresh' }] as const,
    description: `Set provider, seed, and variant options on image/video/audio nodes. Wrap fields in "set": { ... }. Use this for per-node provider override and seed control; for project-wide defaults, use provider.manage.`,
    contexts: CANVAS_CONTEXT,
    tier: 2,
    outputSchema: toolResultSchema(
      unionSchema(
        objectSchema(
          { nodeId: stringSchema, updated: canonicalJsonSchema, _warning: stringSchema },
          ['nodeId', 'updated'],
        ),
        objectSchema(
          { nodes: arraySchema(nodeMutationSchema), _warning: stringSchema },
          ['nodes'],
        ),
      ),
    ),
    projectPublicResult: contextProjector((_result, args) => nodeReplayFacts(args, 'updated')),
    inputSchema: {
      type: 'object',
      properties: {
        canvasId: { type: 'string', description: 'The target canvas ID.' },
        nodeId: { type: 'string', description: 'Single node ID.' },
        nodeIds: {
          type: 'array',
          items: { type: 'string', description: 'Node ID.' },
          description: 'Array of node IDs (batch).',
        },
        set: {
          type: 'object',
          description: 'Fields to change. ONLY include the ones you want to set.',
          properties: {
            providerId: {
              type: 'string',
              description:
                'AI provider ID. Verify hasKey=true via provider.manage { action: "list" } first.',
            },
            seed: { type: 'number', description: 'Seed value.' },
            seedLock: { type: 'boolean', description: 'Pass true to toggle seed lock state.' },
            variantCount: {
              type: 'number',
              description: 'Variant count: 1, 2, 4, 9, or 25 (image/video only).',
            },
            generationPurpose: {
              type: 'string',
              enum: ['content', 'reference-image'],
              description:
                'Image-node purpose. reference-image inherits the Canvas reference-image resolution policy; content inherits the normal image policy.',
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

        if (typeof set.variantCount === 'number') {
          const count = Math.round(set.variantCount as number);
          if (![1, 2, 4, 9, 25].includes(count))
            throw new Error('variantCount must be one of 1, 2, 4, 9, or 25');
        }

        let keyWarning: string | undefined;
        if (typeof set.providerId === 'string' && deps.isProviderKeyConfigured) {
          const hasKey = await deps.isProviderKeyConfigured(set.providerId as string);
          if (!hasKey) {
            keyWarning = `Warning: Provider "${set.providerId}" does not have an API key configured. Generation will fail. Use provider.manage { action: "list" } to find providers with hasKey=true.`;
          }
        }

        const canvas = await requireCanvas(deps, canvasId);
        const nodesById = indexNodes(canvas);
        const updatedAt = Date.now();
        const patchUpdates: Array<{ id: string; changes: Record<string, unknown> }> = [];
        const results: Array<{ nodeId: string; updated: Record<string, unknown> }> = [];
        for (const nodeId of ids) {
          const node = requireIndexedNode(nodesById, nodeId);
          const data: Record<string, unknown> = {};
          const isMedia = isGeneratableMedia(node.type);
          const isVisual = isVisualMedia(node.type);

          if (isMedia && typeof set.providerId === 'string')
            data.providerId = (set.providerId as string).trim();
          if (isMedia && typeof set.seed === 'number') data.seed = Math.round(set.seed as number);
          if (isMedia && set.seedLock === true) {
            data.seedLocked = !(node.data as { seedLocked?: boolean }).seedLocked;
          }
          if (isVisual && typeof set.variantCount === 'number')
            data.variantCount = Math.round(set.variantCount as number);
          if (set.generationPurpose !== undefined) {
            if (node.type !== 'image') {
              throw new Error('generationPurpose is only valid for image nodes');
            }
            if (
              set.generationPurpose !== 'content' &&
              set.generationPurpose !== 'reference-image'
            ) {
              throw new Error('generationPurpose must be content or reference-image');
            }
            data.generationPurpose = set.generationPurpose;
          }

          if (Object.keys(data).length > 0) {
            patchUpdates.push({
              id: nodeId,
              changes: { data: mergedNodeData(node, data), updatedAt },
            });
          }
          results.push({
            nodeId,
            updated: { ...data, ...(set.seedLock === true ? { seedLockToggled: true } : {}) },
          });
        }
        await commitNodeUpdates(canvasId, patchUpdates);
        const warningObj = keyWarning ? { _warning: keyWarning } : {};
        return ok(
          results.length === 1
            ? { ...results[0], ...warningObj }
            : { nodes: results, ...warningObj },
        );
      } catch (error) {
        return fail(error);
      }
    },
  };

  // ---------------------------------------------------------------------------
  // canvas.setMediaParams — image, video, or audio generation parameters
  // ---------------------------------------------------------------------------
  const setMediaParams: ToolDefinition = {
    name: 'canvas.setMediaParams',
    process: 'media-config',
    category: 'mutation',
    contextReplay: 'authority_reread',
    resource: NO_TOOL_RESOURCE,
    uiEffects: [{ kind: 'canvas.refresh' }] as const,
    description:
      'Set media generation parameters on nodes. Resolution precedence is node override → Canvas policy → provider default. Use resolution for provider-default/exact/tier; clearResolutionOverride=true restores Canvas inheritance. Legacy width+height remains accepted as an exact override and must be provided together.',
    contexts: CANVAS_CONTEXT,
    tier: 2,
    outputSchema: toolResultSchema(unionSchema(nodeMutationSchema, arraySchema(nodeMutationSchema))),
    projectPublicResult: contextProjector((_result, args) => nodeReplayFacts(args, 'updated')),
    inputSchema: {
      type: 'object',
      properties: {
        canvasId: { type: 'string', description: 'The target canvas ID.' },
        nodeId: { type: 'string', description: 'Single node ID.' },
        nodeIds: {
          type: 'array',
          items: { type: 'string', description: 'Node ID.' },
          description: 'Array of node IDs (batch).',
        },
        mediaType: {
          type: 'string',
          enum: ['image', 'video', 'audio'],
          description: 'The media type whose parameters to set.',
        },
        set: {
          type: 'object',
          description: 'Parameters to change. ONLY include the ones you want to set.',
          properties: {
            width: { type: 'number', description: 'Width in pixels (image/video).' },
            height: { type: 'number', description: 'Height in pixels (image/video).' },
            resolution: {
              type: 'object',
              description:
                'Canonical node override: {mode:"provider-default",aspectRatio?}, {mode:"exact",width,height}, or {mode:"tier",tier,aspectRatio?}.',
              properties: {
                mode: {
                  type: 'string',
                  enum: ['provider-default', 'exact', 'tier'],
                  description: 'Resolution intent mode.',
                },
                width: { type: 'number', description: 'Exact width.' },
                height: { type: 'number', description: 'Exact height.' },
                tier: { type: 'string', description: 'Provider resolution tier.' },
                aspectRatio: { type: 'string', description: 'Optional provider aspect ratio.' },
              },
            },
            clearResolutionOverride: {
              type: 'boolean',
              description:
                'Set true to delete the node resolution override and inherit the Canvas policy.',
            },
            steps: {
              type: 'number',
              description: 'Inference steps, typically 20-50 (image/video).',
            },
            cfgScale: {
              type: 'number',
              description: 'CFG scale / guidance, typically 3-15 (image/video).',
            },
            scheduler: {
              type: 'string',
              description: 'Sampling scheduler (e.g. "euler_a", "dpm++_2m") (image/video).',
            },
            img2imgStrength: {
              type: 'number',
              description: 'Image-to-image strength 0-1 (image/video).',
            },
            duration: { type: 'number', description: 'Duration in seconds (video).' },
            audio: {
              type: 'boolean',
              description: `Enable audio generation (video). Only ${AUDIO_CAPABLE_VIDEO_PROVIDER_IDS} support audio.`,
            },
            quality: {
              type: 'string',
              description: `Quality tier (video). ${KLING_QUALITY_DESCRIPTION}.`,
            },
            audioType: {
              type: 'string',
              enum: ['voice', 'sfx', 'music'],
              description: 'Audio type (audio).',
            },
            emotionVector: {
              type: 'object',
              description: 'Emotion vector for TTS. Each key 0-1 (audio).',
              properties: {
                happy: { type: 'number', description: '0-1.' },
                sad: { type: 'number', description: '0-1.' },
                angry: { type: 'number', description: '0-1.' },
                fearful: { type: 'number', description: '0-1.' },
                surprised: { type: 'number', description: '0-1.' },
                disgusted: { type: 'number', description: '0-1.' },
                contemptuous: { type: 'number', description: '0-1.' },
                neutral: { type: 'number', description: '0-1.' },
              },
            },
          },
        },
      },
      required: ['canvasId', 'mediaType', 'set'],
    },
    async execute(args) {
      try {
        const mediaType = requireString(args, 'mediaType');
        if (mediaType !== 'image' && mediaType !== 'video' && mediaType !== 'audio') {
          return fail(`Unknown mediaType "${mediaType}". Must be one of: image, video, audio.`);
        }
        const canvasId = requireString(args, 'canvasId');
        const ids = resolveNodeIds(args);
        const set = extractSet(args);
        const canvas = await requireCanvas(deps, canvasId);
        const nodesById = indexNodes(canvas);
        const updatedAt = Date.now();
        const patchUpdates: Array<{ id: string; changes: Record<string, unknown> }> = [];
        const results: Array<{ nodeId: string; updated: Record<string, unknown> }> = [];

        for (const nodeId of ids) {
          const node = requireIndexedNode(nodesById, nodeId);
          if (mediaType === 'image' && node.type !== 'image' && node.type !== 'video') {
            throw new Error(`Node "${nodeId}" type "${node.type}" is not an image or video node`);
          }
          if (mediaType === 'video' && node.type !== 'video') {
            throw new Error(`Node "${nodeId}" type "${node.type}" is not a video node`);
          }
          if (mediaType === 'audio' && node.type !== 'audio') {
            throw new Error(`Node "${nodeId}" type "${node.type}" is not an audio node`);
          }

          const data: Record<string, unknown> = {};
          const resolutionMutation =
            mediaType === 'audio' ? { data: {}, clearFields: [] } : buildResolutionMutation(set);
          Object.assign(data, resolutionMutation.data);
          if (mediaType === 'image') {
            if (typeof set.steps === 'number') data.steps = Math.round(set.steps as number);
            if (typeof set.cfgScale === 'number') data.cfgScale = set.cfgScale;
            if (typeof set.scheduler === 'string') data.scheduler = set.scheduler;
            if (typeof set.img2imgStrength === 'number') {
              data.img2imgStrength = Math.max(0, Math.min(1, set.img2imgStrength as number));
            }
          } else if (mediaType === 'video') {
            if (typeof set.duration === 'number') data.duration = set.duration;
            if (typeof set.audio === 'boolean') data.audio = set.audio;
            if (typeof set.quality === 'string') data.quality = set.quality;
          } else {
            if (typeof set.audioType === 'string') {
              const validAudioTypes = ['voice', 'sfx', 'music'];
              if (!validAudioTypes.includes(set.audioType as string)) {
                throw new Error(`audioType must be one of: ${validAudioTypes.join(', ')}`);
              }
              data.audioType = set.audioType;
            }
            if (set.emotionVector !== undefined && set.emotionVector !== null) {
              data.emotionVector = set.emotionVector;
            }
          }

          if (Object.keys(data).length > 0 || resolutionMutation.clearFields.length > 0) {
            patchUpdates.push({
              id: nodeId,
              changes: {
                data: mergedNodeData(node, data, resolutionMutation.clearFields),
                updatedAt,
              },
            });
          }
          results.push({ nodeId, updated: data });
        }

        await commitNodeUpdates(canvasId, patchUpdates);
        return ok(results.length === 1 ? results[0] : results);
      } catch (error) {
        return fail(error);
      }
    },
  };

  const resolveResolution: ToolDefinition = {
    name: 'provider.resolveResolution',
    process: 'media-config',
    category: 'query',
    contextReplay: 'public_facts',
    resource: NO_TOOL_RESOURCE,
    description:
      'Run a local-only resolution capability and cost preflight for an image/video node. It never validates remotely or starts paid generation. Omit resolution to inspect the node → Canvas → provider effective policy; pass a candidate intent to test it before changing the node.',
    contexts: CANVAS_CONTEXT,
    tier: 1,
    outputSchema: toolResultSchema(resolutionPreflightSchema),
    projectPublicResult: contextProjector((result) => {
      const data = resultRecord(result);
      const plan = record(data?.plan);
      return [
        valueFact('resolution.supported', data?.supported),
        valueFact('resolution.providerId', plan?.providerId),
        valueFact('resolution.mediaType', plan?.mediaType),
        valueFact('resolution.tier', plan?.tier),
        valueFact('resolution.outputKnown', plan?.outputKnown),
        valueFact('resolution.estimatedCostUsd', data?.estimatedCostUsd),
        valueFact('resolution.currency', data?.currency),
      ];
    }),
    inputSchema: {
      type: 'object',
      properties: {
        canvasId: { type: 'string', description: 'The target canvas ID.' },
        nodeId: { type: 'string', description: 'The image or video node ID.' },
        resolution: {
          type: 'object',
          description:
            'Optional candidate: {mode:"provider-default",aspectRatio?}, {mode:"exact",width,height}, or {mode:"tier",tier,aspectRatio?}.',
          properties: {
            mode: {
              type: 'string',
              enum: ['provider-default', 'exact', 'tier'],
              description: 'Resolution intent mode.',
            },
            width: { type: 'number', description: 'Exact width.' },
            height: { type: 'number', description: 'Exact height.' },
            tier: { type: 'string', description: 'Provider tier.' },
            aspectRatio: { type: 'string', description: 'Optional provider aspect ratio.' },
          },
        },
      },
      required: ['canvasId', 'nodeId'],
    },
    async execute(args) {
      try {
        if (!deps.preflightResolution) {
          return fail('provider.resolveResolution is not wired in this environment');
        }
        const canvasId = requireString(args, 'canvasId');
        const nodeId = requireString(args, 'nodeId');
        const { node } = await requireNode(deps, canvasId, nodeId);
        if (!isVisualMedia(node.type)) {
          return fail(`Node "${nodeId}" is not an image or video node`);
        }
        const intent =
          args.resolution === undefined
            ? undefined
            : parseResolutionIntent(args.resolution, 'resolution');
        return ok(await deps.preflightResolution(canvasId, nodeId, intent));
      } catch (error) {
        return fail(error);
      }
    },
  };

  const selectVariant: ToolDefinition = {
    name: 'canvas.selectVariant',
    process: 'canvas-node-editing',
    category: 'mutation',
    contextReplay: 'authority_reread',
    resource: NO_TOOL_RESOURCE,
    uiEffects: [{ kind: 'canvas.refresh' }] as const,
    description: 'Select the active generated variant for an image, video, or audio node.',
    contexts: CANVAS_CONTEXT,
    tier: 2,
    outputSchema: toolResultSchema(objectSchema({ nodeId: stringSchema, index: numberSchema })),
    projectPublicResult: contextProjector((_result, args) => nodeReplayFacts(args, 'updated')),
    inputSchema: {
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

  const previewPrompt: ToolDefinition = {
    name: 'canvas.previewPrompt',
    process: 'canvas-node-editing',
    category: 'query',
    contextReplay: 'authority_reread',
    resource: NO_TOOL_RESOURCE,
    description:
      'Alias for canvas.generation action=prepare. Creates or resumes a durable media.generation.v1 Task List and returns taskListId plus the prepared Prompt Assembly. Does not submit media generation.',
    contexts: CANVAS_CONTEXT,
    tier: 1,
    outputSchema: toolResultSchema(
      objectSchema({ taskListId: stringSchema, promptAssembly: promptAssemblyRecordSchema }),
    ),
    projectPublicResult: contextProjector((result) => {
      const data = resultRecord(result);
      const promptAssembly = record(data?.promptAssembly);
      return [
        authorityFact('task_list', 'created', data?.taskListId),
        authorityFact('prompt_assembly', 'created', promptAssembly?.assemblyId, {
          revision: promptAssembly?.revision,
          contentHash: promptAssembly?.inputHash,
        }),
      ];
    }),
    inputSchema: {
      type: 'object',
      properties: {
        canvasId: { type: 'string', description: 'The target canvas ID.' },
        nodeId: { type: 'string', description: 'The node ID to preview.' },
        intent: {
          type: 'string',
          description: 'Optional current user intent as a separate prompt source.',
        },
        providerId: { type: 'string', description: 'Optional provider override.' },
        providerConfig: {
          type: 'object',
          description: 'Optional custom provider configuration. When present, both baseUrl and model are required; never include apiKey.',
          properties: {
            baseUrl: { type: 'string', description: 'Custom provider base URL.' },
            model: { type: 'string', description: 'Custom provider model.' },
          },
        },
        parentAttemptId: {
          type: 'string',
          description: 'Prior durable media attempt ID; requires feedback.',
        },
        feedback: {
          type: 'string',
          description: 'Concise refinement feedback; requires parentAttemptId.',
        },
      },
      required: ['canvasId', 'nodeId'],
    },
    async execute(args) {
      try {
        return await prepareMediaTask(args);
      } catch (error) {
        return fail(error);
      }
    },
  };

  const addNote: ToolDefinition = {
    name: 'canvas.addNote',
    process: 'canvas-structure',
    category: 'mutation',
    contextReplay: 'authority_reread',
    resource: NO_TOOL_RESOURCE,
    uiEffects: [{ kind: 'canvas.refresh' }] as const,
    description: 'Add a new note to the canvas.',
    contexts: CANVAS_CONTEXT,
    tier: 2,
    outputSchema: toolResultSchema(canvasNoteSchema),
    projectPublicResult: contextProjector((_result, args) => [
      authorityFact('canvas', 'updated', args.canvasId),
    ]),
    inputSchema: {
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

  const updateNote: ToolDefinition = {
    name: 'canvas.updateNote',
    process: 'canvas-structure',
    category: 'mutation',
    contextReplay: 'authority_reread',
    resource: NO_TOOL_RESOURCE,
    uiEffects: [{ kind: 'canvas.refresh' }] as const,
    description: 'Update an existing canvas note.',
    contexts: CANVAS_CONTEXT,
    tier: 2,
    outputSchema: toolResultSchema(objectSchema({ noteId: stringSchema, content: stringSchema })),
    projectPublicResult: contextProjector((_result, args) => [
      authorityFact('canvas', 'updated', args.canvasId),
    ]),
    inputSchema: {
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

  const deleteNote: ToolDefinition = {
    name: 'canvas.deleteNote',
    process: 'canvas-structure',
    category: 'mutation',
    contextReplay: 'authority_reread',
    resource: NO_TOOL_RESOURCE,
    uiEffects: [{ kind: 'canvas.refresh' }] as const,
    description: 'Delete a canvas note.',
    contexts: CANVAS_CONTEXT,
    tier: 3,
    outputSchema: toolResultSchema(objectSchema({ noteId: stringSchema })),
    projectPublicResult: contextProjector((_result, args) => [
      authorityFact('canvas', 'updated', args.canvasId),
    ]),
    inputSchema: {
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

  const deleteNode: ToolDefinition = {
    name: 'canvas.deleteNode',
    process: 'canvas-structure',
    category: 'mutation',
    contextReplay: 'authority_reread',
    resource: NO_TOOL_RESOURCE,
    uiEffects: [{ kind: 'canvas.refresh' }] as const,
    description:
      'Delete one or more nodes from the canvas (also removes connected edges). Supports batch: pass nodeIds array.',
    contexts: CANVAS_CONTEXT,
    tier: 3,
    outputSchema: toolResultSchema(
      unionSchema(
        objectSchema({ nodeId: stringSchema }),
        objectSchema({
          deleted: numberSchema,
          total: numberSchema,
          results: arraySchema(mutationAttemptSchema),
        }),
      ),
    ),
    projectPublicResult: contextProjector((_result, args) => nodeReplayFacts(args, 'deleted')),
    inputSchema: {
      type: 'object',
      properties: {
        canvasId: { type: 'string', description: 'The target canvas ID.' },
        nodeId: { type: 'string', description: 'Single node ID to delete.' },
        nodeIds: {
          type: 'array',
          items: { type: 'string', description: 'Node ID.' },
          description: 'Batch: array of node IDs to delete.',
        },
      },
      required: ['canvasId'],
    },
    async execute(args) {
      try {
        const canvasId = requireString(args, 'canvasId');
        const ids = resolveNodeIds(args);
        const canvas = await requireCanvas(deps, canvasId);
        const nodesById = indexNodes(canvas);
        const removedNodeIds: string[] = [];
        const removedEdgeIds = new Set<string>();
        const results: Array<{ nodeId: string; success: boolean; error?: string }> = [];
        for (const nodeId of ids) {
          try {
            requireIndexedNode(nodesById, nodeId);
            removedNodeIds.push(nodeId);
            for (const edge of canvas.edges) {
              if (edge.source === nodeId || edge.target === nodeId) removedEdgeIds.add(edge.id);
            }
            results.push({ nodeId, success: true });
          } catch (error) {
            results.push({
              nodeId,
              success: false,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }
        if (removedNodeIds.length > 0) {
          await deps.patchCanvas(canvasId, {
            canvasId,
            timestamp: Date.now(),
            operations: ['removeNode', ...(removedEdgeIds.size > 0 ? ['removeEdge' as const] : [])],
            removedNodeIds,
            removedEdgeIds: [...removedEdgeIds],
          });
        }
        if (ids.length === 1)
          return results[0].success ? ok({ nodeId: ids[0] }) : fail(results[0].error!);
        return ok({ deleted: results.filter((r) => r.success).length, total: ids.length, results });
      } catch (error) {
        return fail(error);
      }
    },
  };

  // ---------------------------------------------------------------------------
  // canvas.manageEdge — delete, swap direction, or disconnect
  // ---------------------------------------------------------------------------
  const manageEdge: ToolDefinition = {
    name: 'canvas.manageEdge',
    process: 'canvas-graph-and-layout',
    category: 'mutation',
    contextReplay: 'authority_reread',
    resource: NO_TOOL_RESOURCE,
    uiEffects: [{ kind: 'canvas.refresh' }] as const,
    description:
      'Manage canvas edges: delete, swap direction, or disconnect all edges from a node.',
    contexts: CANVAS_CONTEXT,
    tier: 2,
    outputSchema: toolResultSchema(
      unionSchema(
        objectSchema({ edgeId: stringSchema }),
        canvasEdgeSchema,
        objectSchema({ nodeId: stringSchema, edgeIds: stringArraySchema, count: numberSchema }),
        objectSchema({
          deleted: numberSchema,
          total: numberSchema,
          results: arraySchema(
            objectSchema(
              { edgeId: stringSchema, success: booleanSchema, error: stringSchema },
              ['edgeId', 'success'],
            ),
          ),
        }),
        objectSchema({
          disconnected: numberSchema,
          total: numberSchema,
          results: arraySchema(
            objectSchema(
              {
                nodeId: stringSchema,
                success: booleanSchema,
                edgeIds: stringArraySchema,
                count: numberSchema,
                error: stringSchema,
              },
              ['nodeId', 'success'],
            ),
          ),
        }),
      ),
    ),
    projectPublicResult: contextProjector((_result, args) => [
      authorityFact('canvas', 'updated', args.canvasId),
    ]),
    inputSchema: {
      type: 'object',
      properties: {
        canvasId: { type: 'string', description: 'The target canvas ID.' },
        action: {
          type: 'string',
          enum: ['delete', 'swap', 'disconnect'],
          description: 'The edge management action to perform.',
        },
        edgeId: { type: 'string', description: 'Single edge ID (for delete or swap).' },
        edgeIds: {
          type: 'array',
          items: { type: 'string', description: 'Edge ID.' },
          description: 'Batch: array of edge IDs to delete.',
        },
        nodeId: { type: 'string', description: 'Single node ID to disconnect.' },
        nodeIds: {
          type: 'array',
          items: { type: 'string', description: 'Node ID.' },
          description: 'Batch: array of node IDs to disconnect.',
        },
      },
      required: ['canvasId', 'action'],
    },
    async execute(args) {
      const action = requireString(args, 'action');
      if (action === 'delete') {
        try {
          const canvasId = requireString(args, 'canvasId');
          const ids: string[] = Array.isArray(args.edgeIds)
            ? args.edgeIds.map((id: unknown) => (typeof id === 'string' ? id.trim() : String(id)))
            : [requireString(args, 'edgeId')];
          const canvas = await requireCanvas(deps, canvasId);
          const edgesById = new Map(canvas.edges.map((edge) => [edge.id, edge]));
          const removedEdgeIds: string[] = [];
          const results: Array<{ edgeId: string; success: boolean; error?: string }> = [];
          for (const edgeId of ids) {
            try {
              if (!edgesById.has(edgeId)) throw new Error(`Edge not found: ${edgeId}`);
              removedEdgeIds.push(edgeId);
              results.push({ edgeId, success: true });
            } catch (error) {
              results.push({
                edgeId,
                success: false,
                error: error instanceof Error ? error.message : String(error),
              });
            }
          }
          if (removedEdgeIds.length > 0) {
            await deps.patchCanvas(canvasId, {
              canvasId,
              timestamp: Date.now(),
              operations: ['removeEdge'],
              removedEdgeIds,
            });
          }
          if (ids.length === 1)
            return results[0].success ? ok({ edgeId: ids[0] }) : fail(results[0].error!);
          return ok({
            deleted: results.filter((r) => r.success).length,
            total: ids.length,
            results,
          });
        } catch (error) {
          return fail(error);
        }
      } else if (action === 'swap') {
        try {
          const canvasId = requireString(args, 'canvasId');
          const edgeId = requireString(args, 'edgeId');
          const canvas = await requireCanvas(deps, canvasId);
          const edge = requireCanvasEdge(canvas, edgeId);
          const swappedEdge: CanvasEdge = {
            ...(structuredClone(edge) as CanvasEdge),
            source: edge.target,
            target: edge.source,
          };
          const nextSourceHandle = edge.targetHandle?.startsWith('tgt-')
            ? edge.targetHandle.slice(4)
            : edge.targetHandle;
          const nextTargetHandle =
            edge.sourceHandle && !edge.sourceHandle.startsWith('tgt-')
              ? `tgt-${edge.sourceHandle}`
              : edge.sourceHandle;
          if (nextSourceHandle) swappedEdge.sourceHandle = nextSourceHandle;
          else delete swappedEdge.sourceHandle;
          if (nextTargetHandle) swappedEdge.targetHandle = nextTargetHandle;
          else delete swappedEdge.targetHandle;

          await deps.patchCanvas(canvasId, {
            canvasId,
            timestamp: Date.now(),
            operations: ['updateEdge'],
            updatedEdges: [{ id: edgeId, edge: swappedEdge }],
          });
          return ok(swappedEdge);
        } catch (error) {
          return fail(error);
        }
      } else if (action === 'disconnect') {
        try {
          const canvasId = requireString(args, 'canvasId');
          const ids = resolveNodeIds(args);
          const canvas = await requireCanvas(deps, canvasId);
          const nodesById = indexNodes(canvas);
          const removedEdgeIds = new Set<string>();
          const results: Array<{
            nodeId: string;
            success: boolean;
            edgeIds?: string[];
            count?: number;
            error?: string;
          }> = [];
          for (const nodeId of ids) {
            try {
              requireIndexedNode(nodesById, nodeId);
              const edgeIds = canvas.edges
                .filter((edge) => edge.source === nodeId || edge.target === nodeId)
                .map((edge) => edge.id);
              for (const edgeId of edgeIds) removedEdgeIds.add(edgeId);
              results.push({ nodeId, success: true, edgeIds, count: edgeIds.length });
            } catch (error) {
              results.push({
                nodeId,
                success: false,
                error: error instanceof Error ? error.message : String(error),
              });
            }
          }
          if (removedEdgeIds.size > 0) {
            await deps.patchCanvas(canvasId, {
              canvasId,
              timestamp: Date.now(),
              operations: ['removeEdge'],
              removedEdgeIds: [...removedEdgeIds],
            });
          }
          if (ids.length === 1) {
            const r = results[0];
            return r.success
              ? ok({ nodeId: ids[0], edgeIds: r.edgeIds, count: r.count })
              : fail(r.error!);
          }
          return ok({
            disconnected: results.filter((r) => r.success).length,
            total: ids.length,
            results,
          });
        } catch (error) {
          return fail(error);
        }
      } else {
        return fail(`Unknown action "${action}". Must be one of: delete, swap, disconnect.`);
      }
    },
  };

  const characterRefItem = {
    type: 'object' as const,
    description: 'One character identity and its exact visual reference selection.',
    properties: {
      characterId: { type: 'string' as const, description: 'Character ID.' },
      loadoutId: { type: 'string' as const, description: 'Optional loadout ID.' },
      costume: { type: 'string' as const, description: 'Optional costume override.' },
      emotion: { type: 'string' as const, description: 'Optional visible emotion.' },
      angleSlot: {
        type: 'string' as const,
        description: 'Exact entity reference-image slot to use.',
      },
      referenceImageHash: {
        type: 'string' as const,
        description: 'Exact entity-owned reference image hash; takes precedence over angleSlot.',
      },
    },
  };
  const equipmentRefItem = {
    type: 'object' as const,
    description: 'One equipment identity and its exact visual reference selection.',
    properties: {
      equipmentId: { type: 'string' as const, description: 'Equipment ID.' },
      angleSlot: {
        type: 'string' as const,
        description: 'Exact entity reference-image slot to use.',
      },
      referenceImageHash: {
        type: 'string' as const,
        description: 'Exact entity-owned reference image hash; takes precedence over angleSlot.',
      },
    },
  };
  const locationRefItem = {
    type: 'object' as const,
    description: 'One location identity and its exact visual reference selection.',
    properties: {
      locationId: { type: 'string' as const, description: 'Location ID.' },
      angleSlot: {
        type: 'string' as const,
        description: 'Exact entity reference-image slot to use.',
      },
      referenceImageHash: {
        type: 'string' as const,
        description: 'Exact entity-owned reference image hash; takes precedence over angleSlot.',
      },
    },
  };

  const setNodeRefs: ToolDefinition = {
    name: 'canvas.setNodeRefs',
    process: 'canvas-node-editing',
    category: 'mutation',
    contextReplay: 'authority_reread',
    resource: NO_TOOL_RESOURCE,
    projectPublicResult: contextProjector((_result, args) => nodeReplayFacts(args, 'updated')),
    uiEffects: [{ kind: 'canvas.refresh' }] as const,
    description: `Set character, equipment, and/or location references on image/video nodes. Two modes:
1. Same refs for multiple nodes: use nodeId/nodeIds + characterRefs/equipmentRefs/locationRefs at top level.
2. Different refs per node: use "nodes": [{ nodeId, characterRefs?, equipmentRefs?, locationRefs? }, ...] — preferred for efficiency.
Pass empty array to clear refs of that type. Only provide the ref types you want to change — omitted types are left unchanged.
Use this for entity refs (character/location/equipment). For prompt text changes, use canvas.updateNodes. For layout, use canvas.setNodeLayout.`,
    contexts: CANVAS_CONTEXT,
    tier: 2,
    outputSchema: toolResultSchema(
      unionSchema(
        objectSchema(
          {
            nodeId: stringSchema,
            characterRefs: arraySchema(characterRefSchema),
            equipmentRefs: arraySchema(equipmentRefSchema),
            locationRefs: arraySchema(locationRefSchema),
          },
          ['nodeId'],
        ),
        objectSchema({
          updated: numberSchema,
          total: numberSchema,
          results: arraySchema(mutationAttemptSchema),
        }),
      ),
    ),
    inputSchema: {
      type: 'object',
      properties: {
        canvasId: { type: 'string', description: 'The target canvas ID.' },
        nodeId: { type: 'string', description: 'Single node ID to update.' },
        nodeIds: {
          type: 'array',
          items: { type: 'string', description: 'Node ID.' },
          description: 'Batch: array of node IDs to update (same refs for all).',
        },
        characterRefs: {
          type: 'array',
          description: 'Character references with lossless identity/selector fields.',
          items: characterRefItem,
        },
        equipmentRefs: {
          type: 'array',
          description: 'Equipment references with exact selector fields.',
          items: equipmentRefItem,
        },
        locationRefs: {
          type: 'array',
          description: 'Location references with exact selector fields.',
          items: locationRefItem,
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
                items: characterRefItem,
              },
              equipmentRefs: {
                type: 'array',
                description: 'Equipment references for this node.',
                items: equipmentRefItem,
              },
              locationRefs: {
                type: 'array',
                description: 'Location references for this node.',
                items: locationRefItem,
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
          characterRefs?: CharacterRef[];
          equipmentRefs?: EquipmentRef[];
          locationRefs?: LocationRef[];
        };
        function parseRequiredRefString(
          ref: Record<string, unknown>,
          key: string,
          refType: string,
          index: number,
        ): string {
          const value = ref[key];
          if (typeof value !== 'string' || !value.trim()) {
            throw new TypedToolError(
              `canvas.setNodeRefs: ${refType}[${index}].${key} must be a non-empty string`,
              'validation',
            );
          }
          return value.trim();
        }
        function parseOptionalRefString(
          ref: Record<string, unknown>,
          key: string,
          refType: string,
          index: number,
        ): string | undefined {
          const value = ref[key];
          if (value === undefined || value === null || value === '') return undefined;
          if (typeof value !== 'string') {
            throw new TypedToolError(
              `canvas.setNodeRefs: ${refType}[${index}].${key} must be a string`,
              'validation',
            );
          }
          return value.trim() || undefined;
        }
        function requireRefRecord(
          value: unknown,
          refType: string,
          index: number,
        ): Record<string, unknown> {
          if (!value || typeof value !== 'object' || Array.isArray(value)) {
            throw new TypedToolError(
              `canvas.setNodeRefs: ${refType}[${index}] must be an object`,
              'validation',
            );
          }
          return value as Record<string, unknown>;
        }
        function parseRefs(source: Record<string, unknown>): ParsedRefs {
          const parsed: ParsedRefs = {};
          if (Array.isArray(source.characterRefs)) {
            parsed.characterRefs = source.characterRefs.map((value, index) => {
              const ref = requireRefRecord(value, 'characterRefs', index);
              const costume = parseOptionalRefString(ref, 'costume', 'characterRefs', index);
              const emotion = parseOptionalRefString(ref, 'emotion', 'characterRefs', index);
              const angleSlot = parseOptionalRefString(ref, 'angleSlot', 'characterRefs', index);
              const referenceImageHash = parseOptionalRefString(
                ref,
                'referenceImageHash',
                'characterRefs',
                index,
              );
              return {
                characterId: parseRequiredRefString(ref, 'characterId', 'characterRefs', index),
                loadoutId: parseOptionalRefString(ref, 'loadoutId', 'characterRefs', index) ?? '',
                ...(costume ? { costume } : {}),
                ...(emotion ? { emotion } : {}),
                ...(angleSlot ? { angleSlot } : {}),
                ...(referenceImageHash ? { referenceImageHash } : {}),
              };
            });
          }
          if (Array.isArray(source.equipmentRefs)) {
            parsed.equipmentRefs = source.equipmentRefs.map((value, index) => {
              const ref = requireRefRecord(value, 'equipmentRefs', index);
              const angleSlot = parseOptionalRefString(ref, 'angleSlot', 'equipmentRefs', index);
              const referenceImageHash = parseOptionalRefString(
                ref,
                'referenceImageHash',
                'equipmentRefs',
                index,
              );
              return {
                equipmentId: parseRequiredRefString(ref, 'equipmentId', 'equipmentRefs', index),
                ...(angleSlot ? { angleSlot } : {}),
                ...(referenceImageHash ? { referenceImageHash } : {}),
              };
            });
          }
          if (Array.isArray(source.locationRefs)) {
            parsed.locationRefs = source.locationRefs.map((value, index) => {
              const ref = requireRefRecord(value, 'locationRefs', index);
              const angleSlot = parseOptionalRefString(ref, 'angleSlot', 'locationRefs', index);
              const referenceImageHash = parseOptionalRefString(
                ref,
                'referenceImageHash',
                'locationRefs',
                index,
              );
              return {
                locationId: parseRequiredRefString(ref, 'locationId', 'locationRefs', index),
                ...(angleSlot ? { angleSlot } : {}),
                ...(referenceImageHash ? { referenceImageHash } : {}),
              };
            });
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
            throw new Error(
              'At least one of characterRefs, equipmentRefs, or locationRefs is required',
            );
          }
          workItems = nodeIds.map((id) => ({ nodeId: id, refs: sharedRefs }));
        }

        const canvas = await requireCanvas(deps, canvasId);
        const nodesById = indexNodes(canvas);
        const updatedAt = Date.now();
        const patchUpdates: Array<{ id: string; changes: Record<string, unknown> }> = [];
        const results: Array<{ nodeId: string; success: boolean; error?: string }> = [];
        for (const { nodeId, refs } of workItems) {
          try {
            if (!refs.characterRefs && !refs.equipmentRefs && !refs.locationRefs) {
              results.push({
                nodeId,
                success: false,
                error: 'No ref arrays provided for this node',
              });
              continue;
            }
            const node = requireIndexedNode(nodesById, nodeId);
            if (node.type !== 'image' && node.type !== 'video') {
              results.push({
                nodeId,
                success: false,
                error: `Node type "${node.type}" does not support entity refs`,
              });
              continue;
            }
            const data: Record<string, unknown> = {};
            if (refs.characterRefs !== undefined) data.characterRefs = refs.characterRefs;
            if (refs.equipmentRefs !== undefined) data.equipmentRefs = refs.equipmentRefs;
            if (refs.locationRefs !== undefined) data.locationRefs = refs.locationRefs;
            patchUpdates.push({
              id: nodeId,
              changes: { data: mergedNodeData(node, data), updatedAt },
            });
            results.push({ nodeId, success: true });
          } catch (error) {
            results.push({
              nodeId,
              success: false,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }
        await commitNodeUpdates(canvasId, patchUpdates);
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
        return ok({
          updated: results.filter((r) => r.success).length,
          total: workItems.length,
          results,
        });
      } catch (error) {
        return fail(error);
      }
    },
  };

  const setVideoFrames: ToolDefinition = {
    name: 'canvas.setVideoFrames',
    process: 'canvas-graph-and-layout',
    category: 'mutation',
    contextReplay: 'authority_reread',
    resource: NO_TOOL_RESOURCE,
    uiEffects: [{ kind: 'canvas.refresh' }] as const,
    description:
      'Set first and/or last frame reference for video nodes. Accepts a single nodeId or nodeIds array for batch. IMPORTANT: First frame requires an INCOMING edge (image→video), last frame requires an OUTGOING edge (video→image). Connect edges with correct direction BEFORE calling this tool.',
    contexts: CANVAS_CONTEXT,
    tier: 2,
    outputSchema: toolResultSchema(
      unionSchema(
        objectSchema(
          {
            nodeId: stringSchema,
            firstFrameNodeId: stringSchema,
            lastFrameNodeId: stringSchema,
            firstFrameAssetHash: stringSchema,
            lastFrameAssetHash: stringSchema,
          },
          ['nodeId'],
        ),
        arraySchema(
          objectSchema(
            {
              nodeId: stringSchema,
              firstFrameNodeId: stringSchema,
              lastFrameNodeId: stringSchema,
              firstFrameAssetHash: stringSchema,
              lastFrameAssetHash: stringSchema,
            },
            ['nodeId'],
          ),
        ),
      ),
    ),
    projectPublicResult: contextProjector((_result, args) => nodeReplayFacts(args, 'updated')),
    inputSchema: {
      type: 'object',
      properties: {
        canvasId: { type: 'string', description: 'The target canvas ID.' },
        nodeId: { type: 'string', description: 'Single video node ID.' },
        nodeIds: {
          type: 'array',
          items: { type: 'string', description: 'Node ID.' },
          description: 'Array of video node IDs (batch).',
        },
        firstFrameNodeId: {
          type: 'string',
          description: 'ID of a connected image node to use as first frame.',
        },
        lastFrameNodeId: {
          type: 'string',
          description: 'ID of a connected image node to use as last frame.',
        },
        firstFrameAssetHash: {
          type: 'string',
          description: 'Direct asset hash for first frame image.',
        },
        lastFrameAssetHash: {
          type: 'string',
          description: 'Direct asset hash for last frame image.',
        },
      },
      required: ['canvasId'],
    },
    async execute(args) {
      try {
        const canvasId = requireString(args, 'canvasId');
        const ids = resolveNodeIds(args);
        const canvas = await requireCanvas(deps, canvasId);
        const nodesById = indexNodes(canvas);
        const updatedAt = Date.now();
        const patchUpdates: Array<{ id: string; changes: Record<string, unknown> }> = [];
        const results: Array<{ nodeId: string; [k: string]: unknown }> = [];
        for (const nodeId of ids) {
          const node = requireIndexedNode(nodesById, nodeId);
          if (node.type !== 'video') {
            throw new Error(`Node "${nodeId}" type "${node.type}" is not a video node`);
          }
          const data: Record<string, unknown> = {};
          const clearFields: string[] = [];
          if (typeof args.firstFrameNodeId === 'string') {
            data.firstFrameNodeId = args.firstFrameNodeId;
            clearFields.push('firstFrameAssetHash');
          } else if (typeof args.firstFrameAssetHash === 'string') {
            data.firstFrameAssetHash = args.firstFrameAssetHash;
            clearFields.push('firstFrameNodeId');
          }
          if (typeof args.lastFrameNodeId === 'string') {
            data.lastFrameNodeId = args.lastFrameNodeId;
            clearFields.push('lastFrameAssetHash');
          } else if (typeof args.lastFrameAssetHash === 'string') {
            data.lastFrameAssetHash = args.lastFrameAssetHash;
            clearFields.push('lastFrameNodeId');
          }
          patchUpdates.push({
            id: nodeId,
            changes: { data: mergedNodeData(node, data, clearFields), updatedAt },
          });
          results.push({ nodeId, ...data });
        }
        await commitNodeUpdates(canvasId, patchUpdates);
        return ok(results.length === 1 ? results[0] : results);
      } catch (error) {
        return fail(error);
      }
    },
  };

  return [
    generation,
    updateNodes,
    setNodeLayout,
    configureNode,
    setMediaParams,
    resolveResolution,
    selectVariant,
    previewPrompt,
    addNote,
    updateNote,
    deleteNote,
    deleteNode,
    manageEdge,
    setVideoFrames,
    setNodeRefs,
  ];
}

function readOptionalString(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !value.trim()) {
    throw new TypedToolError(`${field} must be a non-empty string`, 'validation');
  }
  return value.trim();
}

function parseProviderConfig(value: unknown): MediaProviderConfig | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypedToolError('providerConfig must be an object', 'validation');
  }
  const config = value as Record<string, unknown>;
  if ('apiKey' in config) {
    throw new TypedToolError('providerConfig.apiKey is not allowed', 'validation');
  }
  const unsupportedKey = Object.keys(config).find((key) => key !== 'baseUrl' && key !== 'model');
  if (unsupportedKey) {
    throw new TypedToolError(
      `providerConfig.${unsupportedKey} is not supported; only baseUrl and model are allowed`,
      'validation',
    );
  }
  const baseUrl = readOptionalString(config.baseUrl, 'providerConfig.baseUrl');
  if (!baseUrl) {
    throw new TypedToolError('providerConfig.baseUrl is required', 'validation');
  }
  const model = readOptionalString(config.model, 'providerConfig.model');
  if (!model) {
    throw new TypedToolError('providerConfig.model is required', 'validation');
  }
  return { baseUrl, model };
}

function parsePromptAssemblyOutput(value: unknown): PromptAssemblyOutputV1 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypedToolError('assembly must be an object', 'validation');
  }
  const record = value as Record<string, unknown>;
  if (record.version !== 1) {
    throw new TypedToolError('assembly.version must be 1', 'validation');
  }
  const assemblyId = readAssemblyString(record, 'assemblyId');
  const inputHash = readAssemblyString(record, 'inputHash');
  const finalPrompt = readAssemblyString(record, 'finalPrompt');
  const summary = readAssemblyString(record, 'summary', true);
  if (!Array.isArray(record.sourceDecisions)) {
    throw new TypedToolError('assembly.sourceDecisions must be an array', 'validation');
  }
  const sourceDecisions: PromptAssemblySourceDecision[] = record.sourceDecisions.map(
    (entry, index) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
        throw new TypedToolError(
          `assembly.sourceDecisions[${index}] must be an object`,
          'validation',
        );
      }
      const decision = entry as Record<string, unknown>;
      const disposition = readAssemblyString(decision, 'disposition');
      if (!['applied', 'omitted', 'conflict-resolved'].includes(disposition)) {
        throw new TypedToolError(
          `assembly.sourceDecisions[${index}].disposition is invalid`,
          'validation',
        );
      }
      return {
        sourceId: readAssemblyString(decision, 'sourceId'),
        sourceHash: readAssemblyString(decision, 'sourceHash'),
        disposition: disposition as PromptAssemblySourceDecision['disposition'],
        ...(typeof decision.reason === 'string' && decision.reason.trim()
          ? { reason: decision.reason.trim() }
          : {}),
      };
    },
  );
  if (!Array.isArray(record.warnings) || record.warnings.some((item) => typeof item !== 'string')) {
    throw new TypedToolError('assembly.warnings must be a string array', 'validation');
  }
  return {
    version: 1,
    assemblyId,
    inputHash,
    finalPrompt,
    ...(typeof record.negativePrompt === 'string' && record.negativePrompt.trim()
      ? { negativePrompt: record.negativePrompt.trim() }
      : {}),
    sourceDecisions,
    summary,
    warnings: (record.warnings as string[]).map((warning) => warning.trim()).filter(Boolean),
  };
}

function readAssemblyString(
  record: Record<string, unknown>,
  key: string,
  allowEmpty = false,
): string {
  const value = record[key];
  if (typeof value !== 'string' || (!allowEmpty && !value.trim())) {
    throw new TypedToolError(`assembly.${key} must be a string`, 'validation');
  }
  return value.trim();
}
