import type { CanvasNode, CanvasEdge, CanvasSettings } from '@lucid-fin/contracts';
import { tryProviderId } from '@lucid-fin/contracts-parse';
import type { AgentTool, CanvasToolDeps } from './canvas-tool-utils.js';
import {
  CANVAS_CONTEXT,
  ok,
  fail,
  requireString,
  requireText,
  requireStringArray,
  requirePosition,
  requireDirection,
  requireCanvasNodeType,
  requireCanvas,
  requireCanvasNodeById,
  selectEdgeHandles,
  buildDefaultNodeData,
  buildDuplicatedNodes,
  layoutCanvasNodes,
  autoPositionNode,
} from './canvas-tool-utils.js';

export function createCanvasCoreTools(deps: CanvasToolDeps): { tools: AgentTool[]; clipboardRef: { nodes: CanvasNode[] } } {
  const clipboardRef = { nodes: [] as CanvasNode[] };

  const addNode: AgentTool = {
    name: 'canvas.addNode',
    description: 'Add a new node to the current canvas. Position is optional — if omitted, the node is auto-placed in the correct column based on type (image nodes left, video center, text/audio right). For image/video nodes, you can set prompt, provider, and entity refs (characters, locations, equipment) in one call.',
    context: CANVAS_CONTEXT,
    tier: 2,
    parameters: {
      type: 'object',
      properties: {
        canvasId: { type: 'string', description: 'The target canvas ID.' },
        type: {
          type: 'string',
          description: 'The node type to create.',
          enum: ['text', 'image', 'video', 'audio', 'backdrop'],
        },
        title: { type: 'string', description: 'The display title for the node.' },
        content: { type: 'string', description: 'Text content (text nodes only).' },
        prompt: { type: 'string', description: 'Generation prompt (image/video/audio nodes).' },
        providerId: { type: 'string', description: 'AI provider ID for generation.' },
        characterIds: { type: 'array', description: 'Character IDs to attach as refs.', items: { type: 'string', description: 'Character ID.' } },
        locationIds: { type: 'array', description: 'Location IDs to attach as refs.', items: { type: 'string', description: 'Location ID.' } },
        equipmentIds: { type: 'array', description: 'Equipment IDs to attach as refs.', items: { type: 'string', description: 'Equipment ID.' } },
        position: {
          type: 'object',
          description: 'Optional. If omitted, auto-placed based on type column.',
          properties: {
            x: { type: 'number', description: 'Horizontal coordinate.' },
            y: { type: 'number', description: 'Vertical coordinate.' },
          },
        },
      },
      required: ['canvasId', 'type', 'title'],
    },
    async execute(args) {
      try {
        const canvasId = requireString(args, 'canvasId');
        const type = requireCanvasNodeType(args);
        const title = requireString(args, 'title');
        const canvas = await requireCanvas(deps, canvasId);

        // Auto-position if not provided
        let position: { x: number; y: number };
        if (args.position && typeof (args.position as Record<string, unknown>).x === 'number' && typeof (args.position as Record<string, unknown>).y === 'number') {
          position = requirePosition(args);
        } else {
          position = autoPositionNode(canvas, type);
        }

        const now = Date.now();
        const defaultDimensions: Record<string, { width: number; height: number }> = {
          text: { width: 300, height: 200 },
          image: { width: 280, height: 280 },
          video: { width: 280, height: 220 },
          audio: { width: 260, height: 140 },
          backdrop: { width: 600, height: 400 },
        };
        const dims = defaultDimensions[type];
        const node: CanvasNode = {
          id: crypto.randomUUID(),
          type,
          position,
          title,
          data: buildDefaultNodeData(type),
          status: 'idle',
          bypassed: false,
          locked: false,
          width: dims?.width,
          height: dims?.height,
          createdAt: now,
          updatedAt: now,
        };

        if (type === 'text' && typeof args.content === 'string') {
          node.data = { content: args.content };
        }
        if (type !== 'text') {
          const mediaData = node.data as Record<string, unknown>;
          if (typeof args.prompt === 'string') mediaData.prompt = args.prompt;
          // Auto-assign provider: explicit arg > default from settings > none
          const providerId = tryProviderId(args.providerId)
            ?? deps.getDefaultProviderId?.(type as 'image' | 'video' | 'audio');
          if (providerId) mediaData.providerId = providerId;
          if (Array.isArray(args.characterIds)) {
            mediaData.characterRefs = (args.characterIds as string[]).map((id) => ({ characterId: id }));
          }
          if (Array.isArray(args.locationIds)) {
            mediaData.locationRefs = (args.locationIds as string[]).map((id) => ({ locationId: id }));
          }
          if (Array.isArray(args.equipmentIds)) {
            mediaData.equipmentRefs = (args.equipmentIds as string[]).map((id) => ({ equipmentId: id }));
          }
        }

        await deps.addNode(canvasId, node);
        return ok(node);
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

  const connectNodes: AgentTool = {
    name: 'canvas.connectNodes',
    description: 'Create directional edges between nodes. Single pair: pass sourceId+targetId. Batch: pass "connections" array of {sourceId, targetId, label?} objects.',
    context: CANVAS_CONTEXT,
    tier: 2,
    parameters: {
      type: 'object',
      properties: {
        canvasId: { type: 'string', description: 'The target canvas ID.' },
        sourceId: { type: 'string', description: 'Source node ID (single connection).' },
        targetId: { type: 'string', description: 'Target node ID (single connection).' },
        label: { type: 'string', description: 'Optional edge label (single connection).' },
        connections: {
          type: 'array',
          description: 'Batch: array of connection descriptors.',
          items: {
            type: 'object',
            description: 'A connection descriptor.',
            properties: {
              sourceId: { type: 'string', description: 'Source node ID.' },
              targetId: { type: 'string', description: 'Target node ID.' },
              label: { type: 'string', description: 'Optional edge label.' },
            },
          },
        },
      },
      required: ['canvasId'],
    },
    async execute(args) {
      try {
        const canvasId = requireString(args, 'canvasId');
        // Resolve connection descriptors
        type ConnDesc = { sourceId: string; targetId: string; label?: string };
        let pairs: ConnDesc[];
        if (Array.isArray(args.connections) && args.connections.length > 0) {
          pairs = (args.connections as Array<Record<string, unknown>>).map((c) => ({
            sourceId: String(c.sourceId ?? ''),
            targetId: String(c.targetId ?? ''),
            label: typeof c.label === 'string' ? c.label : undefined,
          }));
        } else {
          pairs = [{
            sourceId: requireString(args, 'sourceId'),
            targetId: requireString(args, 'targetId'),
            label: typeof args.label === 'string' ? args.label : undefined,
          }];
        }
        const canvas = await requireCanvas(deps, canvasId);
        const results: Array<{ sourceId: string; targetId: string; success: boolean; edge?: CanvasEdge; error?: string }> = [];
        for (const pair of pairs) {
          try {
            const sourceNode = requireCanvasNodeById(canvas, pair.sourceId);
            const targetNode = requireCanvasNodeById(canvas, pair.targetId);
            const edge: CanvasEdge = {
              id: crypto.randomUUID(),
              source: pair.sourceId,
              target: pair.targetId,
              ...selectEdgeHandles(sourceNode, targetNode),
              data: {
                label: pair.label,
                status: 'idle',
              },
            };
            await deps.connectNodes(canvasId, edge);
            results.push({ sourceId: pair.sourceId, targetId: pair.targetId, success: true, edge });
          } catch (error) {
            results.push({ sourceId: pair.sourceId, targetId: pair.targetId, success: false, error: error instanceof Error ? error.message : String(error) });
          }
        }
        if (pairs.length === 1) return results[0].success ? ok(results[0].edge!) : fail(results[0].error!);
        return ok({ connected: results.filter((r) => r.success).length, total: pairs.length, results });
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
    description: 'Delete an entire canvas by ID. This is irreversible.',
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
        await deps.deleteCanvas(canvasId);
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

  const getState: AgentTool = {
    name: 'canvas.getState',
    description: 'Read canvas metadata and edge list only (no node details). Use canvas.listNodes to find nodes, canvas.getNode for a single node.',
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

  const listNodes: AgentTool = {
    name: 'canvas.listNodes',
    description: 'List nodes on a canvas with pagination. Returns { total, offset, limit, nodes[] }. '
      + 'Check "total" — if total > offset+limit, there are more pages. '
      + 'Use types filter to get nodes of specific kinds (e.g. types=["image"]). Default limit is 50. '
      + 'Pass detail=true to include full node data (prompt, presets, refs, variants) inline — '
      + 'prefer this over listNodes + N× getNode when you need to read many nodes.',
    tags: ['canvas', 'read'],
    context: CANVAS_CONTEXT,
    tier: 1,
    parameters: {
      type: 'object',
      properties: {
        canvasId: { type: 'string', description: 'The target canvas ID.' },
        offset: { type: 'number', description: 'Start index (0-based). Default 0.' },
        limit: { type: 'number', description: 'Max nodes to return. Default 50.' },
        type: { type: 'string', description: 'Filter by node type: text, image, video, audio, backdrop. Omit to list all types.', enum: ['text', 'image', 'video', 'audio', 'backdrop'] },
        types: { type: 'array', description: 'Filter by one or more node types (OR-matched). e.g. ["image", "video"]. Overrides "type" if both provided.', items: { type: 'string', description: 'A node type.' } },
        query: { type: 'string', description: 'Optional search query. Matches against node title or prompt (case-insensitive OR logic).' },
        detail: { type: 'boolean', description: 'If true, include full node data (equivalent to canvas.getNode on every returned id) in a single call. Default false.' },
      },
      required: ['canvasId'],
    },
    async execute(args) {
      try {
        const canvasId = requireString(args, 'canvasId');
        const canvas = await requireCanvas(deps, canvasId);

        // Resolve type filter: `types` array takes precedence over singular `type`
        let typeSet: Set<string> | undefined;
        if (Array.isArray(args.types) && args.types.length > 0) {
          typeSet = new Set((args.types as string[]).filter((t) => typeof t === 'string' && t.length > 0));
        } else if (typeof args.type === 'string' && args.type) {
          typeSet = new Set([args.type]);
        }

        const query = typeof args.query === 'string' && args.query.length > 0
          ? args.query.toLowerCase()
          : undefined;

        const offset = typeof args.offset === 'number' && args.offset >= 0 ? Math.floor(args.offset) : 0;
        const limit = typeof args.limit === 'number' && args.limit > 0 ? Math.floor(args.limit) : 50;
        const detail = args.detail === true;

        let filtered = canvas.nodes;
        if (typeSet) {
          filtered = filtered.filter((n) => typeSet!.has(n.type));
        }
        if (query) {
          filtered = filtered.filter((n) => {
            if (n.title?.toLowerCase().includes(query)) return true;
            const data = n.data as Record<string, unknown>;
            if (typeof data.prompt === 'string' && data.prompt.toLowerCase().includes(query)) return true;
            return false;
          });
        }

        const slice = filtered.slice(offset, offset + limit);
        const page = detail
          ? slice
          : slice.map((node) => {
              const data = node.data as Record<string, unknown>;
              return {
                id: node.id,
                type: node.type,
                title: node.title,
                position: node.position,
                width: node.width,
                height: node.height,
                status: typeof data.status === 'string' ? data.status : node.status,
              };
            });
        return ok({ total: filtered.length, offset, limit, nodes: page });
      } catch (error) {
        return fail(error);
      }
    },
  };

  const listEdges: AgentTool = {
    name: 'canvas.listEdges',
    description: 'List edges on a canvas with pagination. Returns { total, offset, limit, edges[] }. '
      + 'Check "total" — if total > offset+limit, there are more pages. Direction matters: source→target.',
    tags: ['canvas', 'read'],
    context: CANVAS_CONTEXT,
    tier: 1,
    parameters: {
      type: 'object',
      properties: {
        canvasId: { type: 'string', description: 'The target canvas ID.' },
        offset: { type: 'number', description: 'Start index (0-based). Default 0.' },
        limit: { type: 'number', description: 'Max edges to return. Default 50.' },
      },
      required: ['canvasId'],
    },
    async execute(args) {
      try {
        const canvasId = requireString(args, 'canvasId');
        const canvas = await requireCanvas(deps, canvasId);
        const offset = typeof args.offset === 'number' && args.offset >= 0 ? Math.floor(args.offset) : 0;
        const limit = typeof args.limit === 'number' && args.limit > 0 ? Math.floor(args.limit) : 50;
        const page = canvas.edges.slice(offset, offset + limit).map((edge) => ({
          id: edge.id,
          source: edge.source,
          target: edge.target,
          label: edge.data?.label,
        }));
        return ok({ total: canvas.edges.length, offset, limit, edges: page });
      } catch (error) {
        return fail(error);
      }
    },
  };

  const getNode: AgentTool = {
    name: 'canvas.getNode',
    description:
      'Read full details (prompt, presets, refs, variants) for one or more nodes. '
      + 'IMPORTANT: Pass ALL the node IDs you need in a single call as an array — '
      + 'do NOT call this tool once per node in a loop. One batched call is orders of '
      + 'magnitude cheaper than N sequential calls. Single-ID string form is only for the '
      + 'truly-one-node case; for 2+ nodes, always use the array form.',
    tags: ['canvas', 'read'],
    context: CANVAS_CONTEXT,
    tier: 1,
    parameters: {
      type: 'object',
      properties: {
        canvasId: { type: 'string', description: 'The target canvas ID.' },
        nodeIds: { type: 'array', items: { type: 'string', description: 'Node ID.' }, description: 'Array of node IDs to fetch in one call (preferred). Pass every ID you need here, not one per call. A single string is also accepted for the one-node case.' },
      },
      required: ['canvasId', 'nodeIds'],
    },
    async execute(args) {
      try {
        const canvasId = requireString(args, 'canvasId');
        const rawIds = args.nodeIds;
        const canvas = await requireCanvas(deps, canvasId);
        if (Array.isArray(rawIds) && rawIds.length === 0) {
          return fail('nodeIds array must not be empty');
        }
        if (typeof rawIds === 'string') {
          const nodeId = rawIds.trim();
          const node = canvas.nodes.find((n) => n.id === nodeId);
          if (!node) return fail(new Error(`Node not found: ${nodeId}`));
          return ok(node);
        }
        if (Array.isArray(rawIds)) {
          const results = [];
          for (const entry of rawIds) {
            const nodeId = typeof entry === 'string' ? entry.trim() : String(entry);
            const node = canvas.nodes.find((n) => n.id === nodeId);
            if (!node) return fail(new Error(`Node not found: ${nodeId}`));
            results.push(node);
          }
          return ok(results);
        }
        return fail('nodeIds must be a string or array of strings');
      } catch (error) {
        return fail(error);
      }
    },
  };

  const layout: AgentTool = {
    name: 'canvas.layout',
    description: 'Arrange all canvas nodes. "auto" arranges by type and edge connections into columns: first-frame images (left) | video (center) | last-frame images (right) | text (far right). "horizontal"/"vertical" arrange in a single line.',
    context: CANVAS_CONTEXT,
    tier: 2,
    parameters: {
      type: 'object',
      properties: {
        canvasId: { type: 'string', description: 'The target canvas ID.' },
        direction: {
          type: 'string',
          description: 'Layout direction. Use "auto" for smart edge-aware arrangement.',
          enum: ['horizontal', 'vertical', 'auto'],
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
      'Bulk create multiple nodes and edges. Edges use fromIndex/toIndex (0-based) referencing the nodes array. ' +
      'Nodes are auto-arranged in columns by type and edge role: first-frame images (left) | video (center) | last-frame images (right) | text/audio (far right). ' +
      'For each video shot, include BOTH a first-frame image node AND a last-frame image node, with edges image→video (first frame) and video→image (last frame).',
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
        const colGap = 360;
        const rowGap = 280;

        const nodeDescs = args.nodes as Array<Record<string, unknown>>;
        const edgeDescs = Array.isArray(args.edges) ? (args.edges as Array<Record<string, unknown>>) : [];

        // Classify image nodes by edge role: first-frame (image→video) or last-frame (video→image)
        const firstFrameIndices = new Set<number>();
        const lastFrameIndices = new Set<number>();
        for (const e of edgeDescs) {
          const fromIdx = e.fromIndex as number;
          const toIdx = e.toIndex as number;
          if (typeof fromIdx !== 'number' || typeof toIdx !== 'number') continue;
          if (fromIdx < 0 || fromIdx >= nodeDescs.length || toIdx < 0 || toIdx >= nodeDescs.length) continue;
          const fromType = nodeDescs[fromIdx].type;
          const toType = nodeDescs[toIdx].type;
          if (fromType === 'image' && toType === 'video') firstFrameIndices.add(fromIdx);
          if (fromType === 'video' && toType === 'image') lastFrameIndices.add(toIdx);
        }

        // Build columns: first-frame images | video | last-frame images | text/audio
        const columns: number[][] = [[], [], [], []]; // [firstFrame, video, lastFrame, textAudio]
        for (let i = 0; i < nodeDescs.length; i++) {
          const type = typeof nodeDescs[i].type === 'string' ? nodeDescs[i].type as string : 'text';
          if (type === 'image' && firstFrameIndices.has(i)) {
            columns[0].push(i);
          } else if (type === 'video') {
            columns[1].push(i);
          } else if (type === 'image' && lastFrameIndices.has(i)) {
            columns[2].push(i);
          } else if (type === 'image') {
            // Unconnected image → treat as first-frame column
            columns[0].push(i);
          } else {
            // text, audio
            columns[3].push(i);
          }
        }

        // Assign position per node: each non-empty column gets its own x offset
        const positions: Map<number, { x: number; y: number }> = new Map();
        let colIdx = 0;
        for (const col of columns) {
          if (col.length === 0) continue;
          for (let row = 0; row < col.length; row++) {
            positions.set(col[row], { x: startX + colIdx * colGap, y: row * rowGap });
          }
          colIdx++;
        }

        const now = Date.now();
        const createdNodes: CanvasNode[] = [];

        for (let i = 0; i < nodeDescs.length; i++) {
          const desc = nodeDescs[i];
          const type =
            desc.type === 'text' || desc.type === 'image' || desc.type === 'video' || desc.type === 'audio'
              ? (desc.type as CanvasNode['type'])
              : 'text';
          const title = typeof desc.title === 'string' ? desc.title : `Node ${i + 1}`;
          const position = positions.get(i) ?? { x: startX, y: i * rowGap };
          const data = buildDefaultNodeData(type);
          if (type === 'text' && typeof desc.content === 'string') {
            (data as { content: string }).content = desc.content;
          } else if (type !== 'text') {
            const mediaData = data as Record<string, unknown>;
            if (typeof desc.prompt === 'string') mediaData.prompt = desc.prompt;
            const batchProviderId = typeof desc.providerId === 'string'
              ? desc.providerId
              : deps.getDefaultProviderId?.(type as 'image' | 'video' | 'audio');
            if (batchProviderId) mediaData.providerId = batchProviderId;
            if (Array.isArray(desc.characterIds)) {
              mediaData.characterRefs = (desc.characterIds as string[]).map((id) => ({ characterId: id }));
            }
            if (Array.isArray(desc.locationIds)) {
              mediaData.locationRefs = (desc.locationIds as string[]).map((id) => ({ locationId: id }));
            }
            if (Array.isArray(desc.equipmentIds)) {
              mediaData.equipmentRefs = (desc.equipmentIds as string[]).map((id) => ({ equipmentId: id }));
            }
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
            width: type === 'text' ? 300 : type === 'image' ? 280 : type === 'video' ? 280 : 260,
            height: type === 'text' ? 200 : type === 'image' ? 280 : type === 'video' ? 220 : 140,
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

  const getSettings: AgentTool = {
    name: 'canvas.getSettings',
    description:
      'Read canvas-scoped settings (style plate prompt, aspect ratio, provider ids). '
      + 'Returns only fields this canvas has explicitly set; missing fields simply have no canvas-level value. '
      + 'Use this before canvas.setSettings to preview the current state.',
    tags: ['canvas', 'read', 'settings'],
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
        if (!deps.getCanvasSettings) {
          return fail('canvas.getSettings is not wired in this environment');
        }
        const settings = await deps.getCanvasSettings(canvasId);
        return ok({ canvasId, settings });
      } catch (error) {
        return fail(error);
      }
    },
  };

  const setSettings: AgentTool = {
    name: 'canvas.setSettings',
    description:
      'Patch canvas-scoped settings. Include only the fields you want to change. '
      + 'Pass null for a field to clear it. '
      + 'stylePlate is a free-form style prompt describing the visual look of this canvas/video; '
      + 'it is prepended to every ref-image generation prompt as the leading style anchor. '
      + 'negativePrompt is a free-form "avoid" prompt appended to every ref-image generation. '
      + 'defaultResolution sets the default output size for ref-image generation (overrides per-entity defaults). '
      + 'Valid aspectRatio: 16:9 | 9:16 | 1:1 | 2.39:1.',
    tags: ['canvas', 'write', 'settings'],
    context: CANVAS_CONTEXT,
    tier: 2,
    parameters: {
      type: 'object',
      properties: {
        canvasId: { type: 'string', description: 'The target canvas ID.' },
        stylePlate: {
          type: 'string',
          description:
            'Free-form style prompt (e.g. "neo-noir watercolor, muted teal and ochre palette, soft chiaroscuro lighting"). '
            + 'Pass null to clear.',
        },
        negativePrompt: {
          type: 'string',
          description:
            'Free-form negative prompt (e.g. "text, watermark, blurry, low-quality, extra limbs"). '
            + 'Appended to every ref-image prompt as "Avoid: …". Pass null to clear.',
        },
        defaultResolution: {
          type: 'object',
          description:
            'Default output resolution for ref-image generation. Both width and height are required when set. Pass null to clear.',
          properties: {
            width:  { type: 'number', description: 'Image width in pixels.' },
            height: { type: 'number', description: 'Image height in pixels.' },
          },
        },
        aspectRatio: {
          type: 'string',
          description: 'Publishing aspect ratio override.',
          enum: ['16:9', '9:16', '1:1', '2.39:1'],
        },
        llmProviderId:   { type: 'string', description: 'Active LLM provider id for this canvas.' },
        imageProviderId: { type: 'string', description: 'Active image provider id for this canvas.' },
        videoProviderId: { type: 'string', description: 'Active video provider id for this canvas.' },
        audioProviderId: { type: 'string', description: 'Active audio provider id for this canvas.' },
      },
      required: ['canvasId'],
    },
    async execute(args) {
      try {
        const canvasId = requireString(args, 'canvasId');
        await requireCanvas(deps, canvasId);
        if (!deps.patchCanvasSettings) {
          return fail('canvas.setSettings is not wired in this environment');
        }
        const patch: CanvasSettings = {};
        const copy = <K extends keyof CanvasSettings>(key: K) => {
          if (key in args) {
            const value = args[key as string];
            if (value === null) {
              (patch as Record<string, unknown>)[key] = null;
            } else if (typeof value === 'string' && value.length > 0) {
              (patch as Record<string, unknown>)[key] = value;
            }
          }
        };
        copy('stylePlate');
        copy('negativePrompt');
        copy('aspectRatio');
        copy('llmProviderId');
        copy('imageProviderId');
        copy('videoProviderId');
        copy('audioProviderId');
        if ('defaultResolution' in args) {
          const raw = args.defaultResolution;
          if (raw === null) {
            (patch as Record<string, unknown>).defaultResolution = null;
          } else if (raw && typeof raw === 'object') {
            const obj = raw as { width?: unknown; height?: unknown };
            const w = typeof obj.width === 'number' && obj.width > 0 ? Math.floor(obj.width) : null;
            const h = typeof obj.height === 'number' && obj.height > 0 ? Math.floor(obj.height) : null;
            if (w !== null && h !== null) {
              patch.defaultResolution = { width: w, height: h };
            } else {
              return fail('defaultResolution requires positive numeric width and height');
            }
          }
        }
        const settings = await deps.patchCanvasSettings(canvasId, patch);
        return ok({ canvasId, settings });
      } catch (error) {
        return fail(error);
      }
    },
  };

  return {
    tools: [
      addNode, renameCanvas, deleteCanvas, connectNodes, duplicateNodes,
      importWorkflow, exportWorkflow, getState, listNodes, listEdges, getNode, layout, batchCreate,
      getSettings, setSettings,
    ],
    clipboardRef,
  };
}
