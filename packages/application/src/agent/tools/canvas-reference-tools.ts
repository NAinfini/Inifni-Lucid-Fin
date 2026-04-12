import type { AgentTool, CanvasToolDeps } from './canvas-tool-utils.js';
import {
  CANVAS_CONTEXT,
  ok,
  fail,
  requireString,
  requireNode,
} from './canvas-tool-utils.js';

/** Extract nodeIds from args — supports both single `nodeId` and batch `nodeIds`. */
function resolveNodeIds(args: Record<string, unknown>): string[] {
  if (Array.isArray(args.nodeIds) && args.nodeIds.length > 0) {
    return (args.nodeIds as string[]).map(String);
  }
  if (typeof args.nodeId === 'string' && args.nodeId) {
    return [args.nodeId];
  }
  throw new Error('Either nodeId (string) or nodeIds (string[]) is required');
}

export function createCanvasReferenceTools(deps: CanvasToolDeps): AgentTool[] {
  const setCharacterRefs: AgentTool = {
    name: 'canvas.setCharacterRefs',
    description: 'Assign character references to image/video nodes. Supports batch: pass nodeIds array to update multiple nodes at once.',
    context: CANVAS_CONTEXT,
    tier: 2,
    parameters: {
      type: 'object',
      properties: {
        canvasId: { type: 'string', description: 'The target canvas ID.' },
        nodeId: { type: 'string', description: 'Single node ID to update.' },
        nodeIds: { type: 'array', items: { type: 'string', description: 'Node ID.' }, description: 'Batch: array of node IDs to update with the same refs.' },
        characterRefs: {
          type: 'array',
          description: 'Array of character references.',
          items: {
            type: 'object',
            description: 'A character reference.',
            properties: {
              characterId: { type: 'string', description: 'Character ID.' },
              loadoutId: { type: 'string', description: 'Optional loadout ID.' },
            },
          },
        },
      },
      required: ['canvasId', 'characterRefs'],
    },
    async execute(args) {
      try {
        const canvasId = requireString(args, 'canvasId');
        const nodeIds = resolveNodeIds(args);
        if (!Array.isArray(args.characterRefs)) throw new Error('characterRefs must be an array');
        const characterRefs = (args.characterRefs as Array<Record<string, unknown>>).map((r) => ({
          characterId: String(r.characterId ?? ''),
          loadoutId: typeof r.loadoutId === 'string' ? r.loadoutId : '',
        }));
        const results: Array<{ nodeId: string; success: boolean; error?: string }> = [];
        for (const nodeId of nodeIds) {
          try {
            const { node } = await requireNode(deps, canvasId, nodeId);
            if (node.type !== 'image' && node.type !== 'video') {
              results.push({ nodeId, success: false, error: `Node type "${node.type}" does not support character refs` });
              continue;
            }
            await deps.updateNodeData(canvasId, nodeId, { characterRefs });
            results.push({ nodeId, success: true });
          } catch (error) {
            results.push({ nodeId, success: false, error: error instanceof Error ? error.message : String(error) });
          }
        }
        if (nodeIds.length === 1) {
          return results[0].success ? ok({ nodeId: nodeIds[0], characterRefs }) : fail(results[0].error!);
        }
        return ok({ updated: results.filter((r) => r.success).length, total: nodeIds.length, results });
      } catch (error) {
        return fail(error);
      }
    },
  };

  const setEquipmentRefs: AgentTool = {
    name: 'canvas.setEquipmentRefs',
    description: 'Assign equipment references to image/video nodes. Supports batch: pass nodeIds array to update multiple nodes at once.',
    context: CANVAS_CONTEXT,
    tier: 2,
    parameters: {
      type: 'object',
      properties: {
        canvasId: { type: 'string', description: 'The target canvas ID.' },
        nodeId: { type: 'string', description: 'Single node ID to update.' },
        nodeIds: { type: 'array', items: { type: 'string', description: 'Node ID.' }, description: 'Batch: array of node IDs to update with the same refs.' },
        equipmentRefs: {
          type: 'array',
          description: 'Array of equipment references.',
          items: {
            type: 'object',
            description: 'An equipment reference.',
            properties: {
              equipmentId: { type: 'string', description: 'Equipment ID.' },
            },
          },
        },
      },
      required: ['canvasId', 'equipmentRefs'],
    },
    async execute(args) {
      try {
        const canvasId = requireString(args, 'canvasId');
        const nodeIds = resolveNodeIds(args);
        if (!Array.isArray(args.equipmentRefs)) throw new Error('equipmentRefs must be an array');
        const equipmentRefs = (args.equipmentRefs as Array<Record<string, unknown>>).map((r) => ({
          equipmentId: String(r.equipmentId ?? ''),
        }));
        const results: Array<{ nodeId: string; success: boolean; error?: string }> = [];
        for (const nodeId of nodeIds) {
          try {
            const { node } = await requireNode(deps, canvasId, nodeId);
            if (node.type !== 'image' && node.type !== 'video') {
              results.push({ nodeId, success: false, error: `Node type "${node.type}" does not support equipment refs` });
              continue;
            }
            await deps.updateNodeData(canvasId, nodeId, { equipmentRefs });
            results.push({ nodeId, success: true });
          } catch (error) {
            results.push({ nodeId, success: false, error: error instanceof Error ? error.message : String(error) });
          }
        }
        if (nodeIds.length === 1) {
          return results[0].success ? ok({ nodeId: nodeIds[0], equipmentRefs }) : fail(results[0].error!);
        }
        return ok({ updated: results.filter((r) => r.success).length, total: nodeIds.length, results });
      } catch (error) {
        return fail(error);
      }
    },
  };

  const setLocationRefs: AgentTool = {
    name: 'canvas.setLocationRefs',
    description: 'Assign location references to image/video nodes. Supports batch: pass nodeIds array to update multiple nodes at once.',
    context: CANVAS_CONTEXT,
    tier: 2,
    parameters: {
      type: 'object',
      properties: {
        canvasId: { type: 'string', description: 'The target canvas ID.' },
        nodeId: { type: 'string', description: 'Single node ID to update.' },
        nodeIds: { type: 'array', items: { type: 'string', description: 'Node ID.' }, description: 'Batch: array of node IDs to update with the same refs.' },
        locationRefs: {
          type: 'array',
          description: 'Array of location references.',
          items: {
            type: 'object',
            description: 'A location reference.',
            properties: {
              locationId: { type: 'string', description: 'Location ID.' },
            },
          },
        },
      },
      required: ['canvasId', 'locationRefs'],
    },
    async execute(args) {
      try {
        const canvasId = requireString(args, 'canvasId');
        const nodeIds = resolveNodeIds(args);
        if (!Array.isArray(args.locationRefs)) throw new Error('locationRefs must be an array');
        const locationRefs = (args.locationRefs as Array<Record<string, unknown>>).map((r) => ({
          locationId: String(r.locationId ?? ''),
        }));
        const results: Array<{ nodeId: string; success: boolean; error?: string }> = [];
        for (const nodeId of nodeIds) {
          try {
            const { node } = await requireNode(deps, canvasId, nodeId);
            if (node.type !== 'image' && node.type !== 'video') {
              results.push({ nodeId, success: false, error: `Node type "${node.type}" does not support location refs` });
              continue;
            }
            await deps.updateNodeData(canvasId, nodeId, { locationRefs });
            results.push({ nodeId, success: true });
          } catch (error) {
            results.push({ nodeId, success: false, error: error instanceof Error ? error.message : String(error) });
          }
        }
        if (nodeIds.length === 1) {
          return results[0].success ? ok({ nodeId: nodeIds[0], locationRefs }) : fail(results[0].error!);
        }
        return ok({ updated: results.filter((r) => r.success).length, total: nodeIds.length, results });
      } catch (error) {
        return fail(error);
      }
    },
  };

  return [
    setCharacterRefs, setEquipmentRefs, setLocationRefs,
  ];
}
