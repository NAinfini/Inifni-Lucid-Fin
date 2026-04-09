import type { CanvasNode, CanvasEdge, PresetTrackSet } from '@lucid-fin/contracts';
import type { AgentTool, CanvasToolDeps } from './canvas-tool-utils.js';
import {
  CANVAS_CONTEXT,
  ok,
  fail,
  requireString,
  requireText,
  requireStringArray,
  requireBoolean,
  requirePosition,
  requireDirection,
  requireCanvasNodeType,
  requirePresetCategory,
  requireCanvas,
  requireNode,
  requireCanvasNodeById,
  selectEdgeHandles,
  replaceNodePreservingEdges,
  buildDefaultNodeData,
  buildDuplicatedNodes,
  layoutCanvasNodes,
  createTrackSetWithPreset,
} from './canvas-tool-utils.js';

export function createCanvasCoreTools(deps: CanvasToolDeps): { tools: AgentTool[]; clipboardRef: { nodes: CanvasNode[] } } {
  const clipboardRef = { nodes: [] as CanvasNode[] };

  const addNode: AgentTool = {
    name: 'canvas.addNode',
    description: 'Add a new node to the current canvas at a specific position.',
    context: CANVAS_CONTEXT,
    tier: 2,
    parameters: {
      type: 'object',
      properties: {
        canvasId: { type: 'string', description: 'The target canvas ID.' },
        type: {
          type: 'string',
          description: 'The node type to create.',
          enum: ['text', 'image', 'video', 'audio'],
        },
        title: { type: 'string', description: 'The display title for the node.' },
        content: { type: 'string', description: 'Optional text content for text nodes.' },
        position: {
          type: 'object',
          description: 'The node position on the canvas.',
          properties: {
            x: { type: 'number', description: 'Horizontal coordinate.' },
            y: { type: 'number', description: 'Vertical coordinate.' },
          },
        },
      },
      required: ['canvasId', 'type', 'title', 'position'],
    },
    async execute(args) {
      try {
        const canvasId = requireString(args, 'canvasId');
        const type = requireCanvasNodeType(args);
        const title = requireString(args, 'title');
        const position = requirePosition(args);
        await requireCanvas(deps, canvasId);

        const now = Date.now();
        const node: CanvasNode = {
          id: crypto.randomUUID(),
          type,
          position,
          title,
          data: buildDefaultNodeData(type),
          status: 'idle',
          bypassed: false,
          locked: false,
          createdAt: now,
          updatedAt: now,
        };

        if (type === 'text' && typeof args.content === 'string') {
          node.data = { content: args.content };
        }

        await deps.addNode(canvasId, node);
        return ok(node);
      } catch (error) {
        return fail(error);
      }
    },
  };

  const moveNode: AgentTool = {
    name: 'canvas.moveNode',
    description: 'Move an existing node to a new position on the canvas.',
    context: CANVAS_CONTEXT,
    tier: 2,
    parameters: {
      type: 'object',
      properties: {
        canvasId: { type: 'string', description: 'The target canvas ID.' },
        nodeId: { type: 'string', description: 'The node ID to move.' },
        position: {
          type: 'object',
          description: 'The node position on the canvas.',
          properties: {
            x: { type: 'number', description: 'Horizontal coordinate.' },
            y: { type: 'number', description: 'Vertical coordinate.' },
          },
        },
      },
      required: ['canvasId', 'nodeId', 'position'],
    },
    async execute(args) {
      try {
        const canvasId = requireString(args, 'canvasId');
        const nodeId = requireString(args, 'nodeId');
        const position = requirePosition(args);
        await requireNode(deps, canvasId, nodeId);
        await deps.moveNode(canvasId, nodeId, position);
        return ok({ nodeId, position });
      } catch (error) {
        return fail(error);
      }
    },
  };

  const renameNode: AgentTool = {
    name: 'canvas.renameNode',
    description: 'Rename an existing node.',
    context: CANVAS_CONTEXT,
    tier: 2,
    parameters: {
      type: 'object',
      properties: {
        canvasId: { type: 'string', description: 'The target canvas ID.' },
        nodeId: { type: 'string', description: 'The node ID to rename.' },
        title: { type: 'string', description: 'The new node title.' },
      },
      required: ['canvasId', 'nodeId', 'title'],
    },
    async execute(args) {
      try {
        const canvasId = requireString(args, 'canvasId');
        const nodeId = requireString(args, 'nodeId');
        const title = requireString(args, 'title');
        await requireNode(deps, canvasId, nodeId);
        await deps.renameNode(canvasId, nodeId, title);
        return ok({ nodeId, title });
      } catch (error) {
        return fail(error);
      }
    },
  };

  const renameCanvas: AgentTool = {
    name: 'canvas.renameCanvas',
    description: 'Rename an existing canvas.',
    context: CANVAS_CONTEXT,
    tier: 2,
    parameters: {
      type: 'object',
      properties: {
        canvasId: { type: 'string', description: 'The target canvas ID.' },
        name: { type: 'string', description: 'The new canvas name.' },
      },
      required: ['canvasId', 'name'],
    },
    async execute(args) {
      try {
        const canvasId = requireString(args, 'canvasId');
        const name = requireString(args, 'name');
        await requireCanvas(deps, canvasId);
        await deps.renameCanvas(canvasId, name);
        return ok({ canvasId, name });
      } catch (error) {
        return fail(error);
      }
    },
  };

  const loadCanvas: AgentTool = {
    name: 'canvas.loadCanvas',
    description: 'Load an existing canvas by ID.',
    context: CANVAS_CONTEXT,
    tier: 2,
    parameters: {
      type: 'object',
      properties: {
        canvasId: { type: 'string', description: 'The canvas ID to load.' },
      },
      required: ['canvasId'],
    },
    async execute(args) {
      try {
        const canvasId = requireString(args, 'canvasId');
        await requireCanvas(deps, canvasId);
        await deps.loadCanvas(canvasId);
        return ok({ canvasId });
      } catch (error) {
        return fail(error);
      }
    },
  };

  const saveCanvas: AgentTool = {
    name: 'canvas.saveCanvas',
    description: 'Save the current state of a canvas by ID.',
    context: CANVAS_CONTEXT,
    tier: 2,
    parameters: {
      type: 'object',
      properties: {
        canvasId: { type: 'string', description: 'The canvas ID to save.' },
      },
      required: ['canvasId'],
    },
    async execute(args) {
      try {
        const canvasId = requireString(args, 'canvasId');
        await requireCanvas(deps, canvasId);
        await deps.saveCanvas(canvasId);
        return ok({ canvasId });
      } catch (error) {
        return fail(error);
      }
    },
  };

  const connectNodes: AgentTool = {
    name: 'canvas.connectNodes',
    description: 'Create a directional edge between two nodes.',
    context: CANVAS_CONTEXT,
    tier: 2,
    parameters: {
      type: 'object',
      properties: {
        canvasId: { type: 'string', description: 'The target canvas ID.' },
        sourceId: { type: 'string', description: 'The source node ID.' },
        targetId: { type: 'string', description: 'The target node ID.' },
        label: { type: 'string', description: 'Optional edge label.' },
      },
      required: ['canvasId', 'sourceId', 'targetId'],
    },
    async execute(args) {
      try {
        const canvasId = requireString(args, 'canvasId');
        const sourceId = requireString(args, 'sourceId');
        const targetId = requireString(args, 'targetId');
        const canvas = await requireCanvas(deps, canvasId);
        const sourceNode = requireCanvasNodeById(canvas, sourceId);
        const targetNode = requireCanvasNodeById(canvas, targetId);
        const edge: CanvasEdge = {
          id: crypto.randomUUID(),
          source: sourceId,
          target: targetId,
          ...selectEdgeHandles(sourceNode, targetNode),
          data: {
            label: typeof args.label === 'string' ? args.label : undefined,
            status: 'idle',
          },
        };
        await deps.connectNodes(canvasId, edge);
        return ok(edge);
      } catch (error) {
        return fail(error);
      }
    },
  };

  const duplicateNodes: AgentTool = {
    name: 'canvas.duplicateNodes',
    description: 'Duplicate one or more nodes with new IDs and offset positions by 50 pixels.',
    context: CANVAS_CONTEXT,
    tier: 3,
    parameters: {
      type: 'object',
      properties: {
        canvasId: { type: 'string', description: 'The target canvas ID.' },
        nodeIds: {
          type: 'array',
          description: 'The node IDs to duplicate.',
          items: { type: 'string', description: 'A node ID.' },
        },
      },
      required: ['canvasId', 'nodeIds'],
    },
    async execute(args) {
      try {
        const canvasId = requireString(args, 'canvasId');
        const nodeIds = requireStringArray(args, 'nodeIds');
        const canvas = await requireCanvas(deps, canvasId);
        const duplicatedNodes = buildDuplicatedNodes(canvas, nodeIds);

        for (const node of duplicatedNodes) {
          await deps.addNode(canvasId, node);
        }

        return ok({ nodeIds, nodes: duplicatedNodes });
      } catch (error) {
        return fail(error);
      }
    },
  };

  const deleteCanvas: AgentTool = {
    name: 'canvas.deleteCanvas',
    description: 'Delete an entire canvas by ID.',
    context: CANVAS_CONTEXT,
    tier: 3,
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
        await deps.deleteCanvas(canvasId);
        return ok({ canvasId });
      } catch (error) {
        return fail(error);
      }
    },
  };

  const cutNodes: AgentTool = {
    name: 'canvas.cutNodes',
    description: 'Copy nodes into the internal Commander clipboard, then delete them from the canvas.',
    context: CANVAS_CONTEXT,
    tier: 3,
    parameters: {
      type: 'object',
      properties: {
        canvasId: { type: 'string', description: 'The target canvas ID.' },
        nodeIds: {
          type: 'array',
          description: 'The node IDs to cut.',
          items: { type: 'string', description: 'A node ID.' },
        },
      },
      required: ['canvasId', 'nodeIds'],
    },
    async execute(args) {
      try {
        const canvasId = requireString(args, 'canvasId');
        const nodeIds = requireStringArray(args, 'nodeIds');
        const canvas = await requireCanvas(deps, canvasId);
        const copiedNodes = buildDuplicatedNodes(canvas, nodeIds);
        clipboardRef.nodes = copiedNodes;

        for (const nodeId of nodeIds) {
          await deps.deleteNode(canvasId, nodeId);
        }

        return ok({
          nodeIds,
          clipboardCount: clipboardRef.nodes.length,
          nodes: clipboardRef.nodes,
        });
      } catch (error) {
        return fail(error);
      }
    },
  };

  const toggleBypass: AgentTool = {
    name: 'canvas.toggleBypass',
    description: 'Set the bypassed flag on one or more nodes.',
    context: CANVAS_CONTEXT,
    tier: 3,
    parameters: {
      type: 'object',
      properties: {
        canvasId: { type: 'string', description: 'The target canvas ID.' },
        nodeIds: {
          type: 'array',
          description: 'The node IDs to update.',
          items: { type: 'string', description: 'A node ID.' },
        },
        bypassed: { type: 'boolean', description: 'Whether the nodes should be bypassed.' },
      },
      required: ['canvasId', 'nodeIds', 'bypassed'],
    },
    async execute(args) {
      try {
        const canvasId = requireString(args, 'canvasId');
        const nodeIds = requireStringArray(args, 'nodeIds');
        const bypassed = requireBoolean(args, 'bypassed');
        const updatedNodes: CanvasNode[] = [];

        for (const nodeId of nodeIds) {
          const { node } = await requireNode(deps, canvasId, nodeId);
          updatedNodes.push(await replaceNodePreservingEdges(deps, canvasId, node, { bypassed }));
        }

        return ok({ nodeIds, bypassed, nodes: updatedNodes });
      } catch (error) {
        return fail(error);
      }
    },
  };

  const toggleLock: AgentTool = {
    name: 'canvas.toggleLock',
    description: 'Set the locked flag on one or more nodes.',
    context: CANVAS_CONTEXT,
    tier: 3,
    parameters: {
      type: 'object',
      properties: {
        canvasId: { type: 'string', description: 'The target canvas ID.' },
        nodeIds: {
          type: 'array',
          description: 'The node IDs to update.',
          items: { type: 'string', description: 'A node ID.' },
        },
        locked: { type: 'boolean', description: 'Whether the nodes should be locked.' },
      },
      required: ['canvasId', 'nodeIds', 'locked'],
    },
    async execute(args) {
      try {
        const canvasId = requireString(args, 'canvasId');
        const nodeIds = requireStringArray(args, 'nodeIds');
        const locked = requireBoolean(args, 'locked');
        const updatedNodes: CanvasNode[] = [];

        for (const nodeId of nodeIds) {
          const { node } = await requireNode(deps, canvasId, nodeId);
          updatedNodes.push(await replaceNodePreservingEdges(deps, canvasId, node, { locked }));
        }

        return ok({ nodeIds, locked, nodes: updatedNodes });
      } catch (error) {
        return fail(error);
      }
    },
  };

  const selectNodes: AgentTool = {
    name: 'canvas.selectNodes',
    description: 'Query nodes by type or status and return matching node IDs without changing UI selection.',
    context: CANVAS_CONTEXT,
    tier: 1,
    parameters: {
      type: 'object',
      properties: {
        canvasId: { type: 'string', description: 'The target canvas ID.' },
        filter: {
          type: 'object',
          description: 'Optional query filter.',
          properties: {
            type: {
              type: 'string',
              description: 'Optional node type filter.',
              enum: ['text', 'image', 'video', 'audio', 'backdrop'],
            },
            status: {
              type: 'string',
              description: 'Optional node status filter.',
              enum: ['idle', 'queued', 'generating', 'done', 'failed', 'locked', 'bypassed'],
            },
            all: {
              type: 'boolean',
              description: 'When true, return all nodes unless other filters narrow the result.',
            },
          },
        },
      },
      required: ['canvasId'],
    },
    async execute(args) {
      try {
        const canvasId = requireString(args, 'canvasId');
        const canvas = await requireCanvas(deps, canvasId);
        const filter =
          typeof args.filter === 'object' && args.filter !== null
            ? (args.filter as { type?: CanvasNode['type']; status?: CanvasNode['status']; all?: boolean })
            : undefined;
        const matches = canvas.nodes.filter((node) => {
          if (filter?.type && node.type !== filter.type) {
            return false;
          }
          if (filter?.status && node.status !== filter.status) {
            return false;
          }
          return true;
        });

        return ok({
          nodeIds: matches.map((node) => node.id),
          count: matches.length,
          filter: filter ?? { all: true },
        });
      } catch (error) {
        return fail(error);
      }
    },
  };

  const clearSelection: AgentTool = {
    name: 'canvas.clearSelection',
    description: 'Clear the current canvas selection.',
    context: CANVAS_CONTEXT,
    tier: 1,
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
        await deps.clearSelection(canvasId);
        return ok({ canvasId });
      } catch (error) {
        return fail(error);
      }
    },
  };

  const importWorkflow: AgentTool = {
    name: 'canvas.importWorkflow',
    description: 'Import a workflow JSON document into the current canvas.',
    context: CANVAS_CONTEXT,
    tier: 3,
    parameters: {
      type: 'object',
      properties: {
        canvasId: { type: 'string', description: 'The target canvas ID.' },
        json: { type: 'string', description: 'Serialized workflow JSON document.' },
      },
      required: ['canvasId', 'json'],
    },
    async execute(args) {
      try {
        const canvasId = requireString(args, 'canvasId');
        const json = requireText(args, 'json');
        const canvas = await deps.importWorkflow(canvasId, json);
        return ok(canvas);
      } catch (error) {
        return fail(error);
      }
    },
  };

  const exportWorkflow: AgentTool = {
    name: 'canvas.exportWorkflow',
    description: 'Export the current canvas as a workflow JSON document.',
    context: CANVAS_CONTEXT,
    tier: 1,
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
        const json = await deps.exportWorkflow(canvasId);
        return ok({ json });
      } catch (error) {
        return fail(error);
      }
    },
  };

  const setPresets: AgentTool = {
    name: 'canvas.setPresets',
    description: 'Apply a preset to a specific preset category on an image or video node.',
    context: CANVAS_CONTEXT,
    tier: 2,
    parameters: {
      type: 'object',
      properties: {
        canvasId: { type: 'string', description: 'The target canvas ID.' },
        nodeId: { type: 'string', description: 'The node ID to update.' },
        category: {
          type: 'string',
          description: 'The preset category to update.',
          enum: [
            'camera',
            'lens',
            'look',
            'scene',
            'composition',
            'emotion',
            'flow',
            'technical',
          ],
        },
        presetId: { type: 'string', description: 'The preset definition ID to assign.' },
      },
      required: ['canvasId', 'nodeId', 'category', 'presetId'],
    },
    async execute(args) {
      try {
        const canvasId = requireString(args, 'canvasId');
        const nodeId = requireString(args, 'nodeId');
        const category = requirePresetCategory(args);
        const presetId = requireString(args, 'presetId');
        const { node } = await requireNode(deps, canvasId, nodeId);
        if (node.type !== 'image' && node.type !== 'video') {
          throw new Error(`Node type "${node.type}" does not support presets`);
        }

        const presetTracks = createTrackSetWithPreset(
          (node.data as { presetTracks?: PresetTrackSet }).presetTracks,
          category,
          presetId,
        );
        await deps.setNodePresets(canvasId, nodeId, presetTracks);
        return ok({ nodeId, category, presetId, presetTracks });
      } catch (error) {
        return fail(error);
      }
    },
  };

  const getState: AgentTool = {
    name: 'canvas.getState',
    description: 'Read canvas metadata and edge list only (no node details). Use canvas.searchNodes to find nodes, canvas.getNode for a single node.',
    tags: ['canvas', 'read'],
    context: CANVAS_CONTEXT,
    tier: 1,
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
        const canvas = await requireCanvas(deps, canvasId);
        return ok({
          id: canvas.id,
          name: canvas.name,
          nodeCount: canvas.nodes.length,
          edgeCount: canvas.edges.length,
          edges: canvas.edges.map((e) => ({ id: e.id, source: e.source, target: e.target, label: e.data?.label })),
        });
      } catch (error) {
        return fail(error);
      }
    },
  };

  const searchNodes: AgentTool = {
    name: 'canvas.searchNodes',
    description: 'Search canvas nodes with lightweight summaries. Use canvas.getNode to read full details of a specific node.',
    tags: ['canvas', 'read', 'search'],
    context: CANVAS_CONTEXT,
    tier: 1,
    parameters: {
      type: 'object',
      properties: {
        canvasId: { type: 'string', description: 'The target canvas ID.' },
        type: { type: 'string', description: 'Optional node type filter.' },
        titleContains: { type: 'string', description: 'Optional case-insensitive title substring filter.' },
        status: { type: 'string', description: 'Optional status filter.' },
        providerId: { type: 'string', description: 'Optional provider id filter.' },
        limit: { type: 'number', description: 'Optional max number of summaries to return.' },
      },
      required: ['canvasId'],
    },
    async execute(args) {
      try {
        const canvasId = requireString(args, 'canvasId');
        const canvas = await requireCanvas(deps, canvasId);
        const type = typeof args.type === 'string' ? args.type : undefined;
        const titleContains = typeof args.titleContains === 'string' ? args.titleContains.trim().toLowerCase() : '';
        const status = typeof args.status === 'string' ? args.status : undefined;
        const providerId = typeof args.providerId === 'string' ? args.providerId : undefined;
        const limit =
          typeof args.limit === 'number' && Number.isFinite(args.limit)
            ? Math.max(1, Math.floor(args.limit))
            : canvas.nodes.length;

        return ok(
          canvas.nodes
            .map((node) => {
              const data = node.data as Record<string, unknown>;
              return {
                id: node.id,
                type: node.type,
                title: node.title,
                status: typeof data.status === 'string' ? data.status : node.status,
                providerId: typeof data.providerId === 'string' ? data.providerId : null,
              };
            })
            .filter((node) => (
              (type === undefined || node.type === type)
              && (titleContains.length === 0 || node.title.toLowerCase().includes(titleContains))
              && (status === undefined || node.status === status)
              && (providerId === undefined || node.providerId === providerId)
            ))
            .slice(0, limit),
        );
      } catch (error) {
        return fail(error);
      }
    },
  };

  const getNode: AgentTool = {
    name: 'canvas.getNode',
    description: 'Read full details of a single node by ID, including prompt, presets, refs, variants.',
    tags: ['canvas', 'read'],
    context: CANVAS_CONTEXT,
    tier: 1,
    parameters: {
      type: 'object',
      properties: {
        canvasId: { type: 'string', description: 'The target canvas ID.' },
        nodeId: { type: 'string', description: 'The node ID to read.' },
      },
      required: ['canvasId', 'nodeId'],
    },
    async execute(args) {
      try {
        const canvasId = requireString(args, 'canvasId');
        const nodeId = requireString(args, 'nodeId');
        const canvas = await requireCanvas(deps, canvasId);
        const node = canvas.nodes.find((n) => n.id === nodeId);
        if (!node) return fail(new Error(`Node not found: ${nodeId}`));
        return ok(node);
      } catch (error) {
        return fail(error);
      }
    },
  };

  const layout: AgentTool = {
    name: 'canvas.layout',
    description: 'Automatically arrange nodes either horizontally or vertically.',
    context: CANVAS_CONTEXT,
    tier: 2,
    parameters: {
      type: 'object',
      properties: {
        canvasId: { type: 'string', description: 'The target canvas ID.' },
        direction: {
          type: 'string',
          description: 'Layout direction.',
          enum: ['horizontal', 'vertical'],
        },
      },
      required: ['canvasId', 'direction'],
    },
    async execute(args) {
      try {
        const canvasId = requireString(args, 'canvasId');
        const direction = requireDirection(args);
        const positions = await layoutCanvasNodes(deps, canvasId, direction);
        await deps.layoutNodes(canvasId, direction);
        return ok({ direction, positions });
      } catch (error) {
        return fail(error);
      }
    },
  };

  const batchCreate: AgentTool = {
    name: 'canvas.batchCreate',
    description:
      'Bulk create multiple nodes and edges. Edges use fromIndex/toIndex (0-based) referencing the nodes array.',
    context: CANVAS_CONTEXT,
    tier: 3,
    parameters: {
      type: 'object',
      properties: {
        canvasId: { type: 'string', description: 'The target canvas ID.' },
        nodes: {
          type: 'array',
          description: 'Array of nodes to create.',
          items: {
            type: 'object',
            description: 'A node descriptor.',
            properties: {
              type: { type: 'string', description: 'Node type.', enum: ['text', 'image', 'video', 'audio'] },
              title: { type: 'string', description: 'Node title.' },
              content: { type: 'string', description: 'Text content (text nodes).' },
              prompt: { type: 'string', description: 'Prompt (media nodes).' },
            },
          },
        },
        edges: {
          type: 'array',
          description: 'Array of edges referencing nodes by index.',
          items: {
            type: 'object',
            description: 'An edge descriptor.',
            properties: {
              fromIndex: { type: 'number', description: '0-based index into nodes array.' },
              toIndex: { type: 'number', description: '0-based index into nodes array.' },
              label: { type: 'string', description: 'Optional edge label.' },
            },
          },
        },
      },
      required: ['canvasId', 'nodes'],
    },
    async execute(args) {
      try {
        const canvasId = requireString(args, 'canvasId');
        const canvas = await requireCanvas(deps, canvasId);
        if (!Array.isArray(args.nodes) || args.nodes.length === 0) {
          throw new Error('nodes array is required and must not be empty');
        }

        const maxX = canvas.nodes.reduce(
          (max, n) => Math.max(max, n.position.x + (n.width ?? 200)),
          0,
        );
        const startX = canvas.nodes.length > 0 ? maxX + 300 : 0;
        const spacingX = 300;
        const spacingY = 250;
        const cols = Math.max(1, Math.ceil(Math.sqrt(args.nodes.length)));

        const now = Date.now();
        const nodeDescs = args.nodes as Array<Record<string, unknown>>;
        const createdNodes: CanvasNode[] = [];

        for (let i = 0; i < nodeDescs.length; i++) {
          const desc = nodeDescs[i];
          const type =
            desc.type === 'text' || desc.type === 'image' || desc.type === 'video' || desc.type === 'audio'
              ? (desc.type as CanvasNode['type'])
              : 'text';
          const title = typeof desc.title === 'string' ? desc.title : `Node ${i + 1}`;
          const col = i % cols;
          const row = Math.floor(i / cols);
          const position = { x: startX + col * spacingX, y: row * spacingY };
          const data = buildDefaultNodeData(type);
          if (type === 'text' && typeof desc.content === 'string') {
            (data as { content: string }).content = desc.content;
          } else if (type !== 'text' && typeof desc.prompt === 'string') {
            (data as { prompt?: string }).prompt = desc.prompt;
          }
          const node: CanvasNode = {
            id: crypto.randomUUID(),
            type,
            position,
            title,
            data,
            status: 'idle',
            bypassed: false,
            locked: false,
            createdAt: now,
            updatedAt: now,
          };
          createdNodes.push(node);
          await deps.addNode(canvasId, node);
        }

        const createdEdges: CanvasEdge[] = [];
        if (Array.isArray(args.edges)) {
          for (const edgeDesc of args.edges as Array<Record<string, unknown>>) {
            const fromIdx = edgeDesc.fromIndex as number;
            const toIdx = edgeDesc.toIndex as number;
            if (
              typeof fromIdx !== 'number' ||
              typeof toIdx !== 'number' ||
              fromIdx < 0 ||
              fromIdx >= createdNodes.length ||
              toIdx < 0 ||
              toIdx >= createdNodes.length
            ) {
              continue;
            }
            const edge: CanvasEdge = {
              id: crypto.randomUUID(),
              source: createdNodes[fromIdx].id,
              target: createdNodes[toIdx].id,
              ...selectEdgeHandles(createdNodes[fromIdx], createdNodes[toIdx]),
              data: {
                label: typeof edgeDesc.label === 'string' ? edgeDesc.label : undefined,
                status: 'idle',
              },
            };
            await deps.connectNodes(canvasId, edge);
            createdEdges.push(edge);
          }
        }

        return ok({ nodes: createdNodes, edges: createdEdges });
      } catch (error) {
        return fail(error);
      }
    },
  };

  return {
    tools: [
      addNode, moveNode, renameNode, renameCanvas, loadCanvas, saveCanvas, deleteCanvas, connectNodes, duplicateNodes, cutNodes, toggleBypass, toggleLock,
      selectNodes, clearSelection, importWorkflow, exportWorkflow, setPresets, getState, searchNodes, getNode, layout, batchCreate,
    ],
    clipboardRef,
  };
}
