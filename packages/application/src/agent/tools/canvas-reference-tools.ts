import type { AgentTool, CanvasToolDeps } from './canvas-tool-utils.js';
import {
  CANVAS_CONTEXT,
  ok,
  fail,
  requireString,
  requireNode,
} from './canvas-tool-utils.js';

export function createCanvasReferenceTools(deps: CanvasToolDeps): AgentTool[] {
  const setCharacterRefs: AgentTool = {
    name: 'canvas.setCharacterRefs',
    description: 'Assign character references to an image or video node. Pass empty array to clear all refs.',
    context: CANVAS_CONTEXT,
    tier: 2,
    parameters: {
      type: 'object',
      properties: {
        canvasId: { type: 'string', description: 'The target canvas ID.' },
        nodeId: { type: 'string', description: 'The node ID to update.' },
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
      required: ['canvasId', 'nodeId', 'characterRefs'],
    },
    async execute(args) {
      try {
        const canvasId = requireString(args, 'canvasId');
        const nodeId = requireString(args, 'nodeId');
        const { node } = await requireNode(deps, canvasId, nodeId);
        if (node.type !== 'image' && node.type !== 'video') {
          throw new Error(`Node type "${node.type}" does not support character refs`);
        }
        if (!Array.isArray(args.characterRefs)) throw new Error('characterRefs must be an array');
        const characterRefs = (args.characterRefs as Array<Record<string, unknown>>).map((r) => ({
          characterId: String(r.characterId ?? ''),
          loadoutId: typeof r.loadoutId === 'string' ? r.loadoutId : '',
        }));
        await deps.updateNodeData(canvasId, nodeId, { characterRefs });
        return ok({ nodeId, characterRefs });
      } catch (error) {
        return fail(error);
      }
    },
  };

  const setEquipmentRefs: AgentTool = {
    name: 'canvas.setEquipmentRefs',
    description: 'Assign equipment references to an image or video node. Pass empty array to clear all refs.',
    context: CANVAS_CONTEXT,
    tier: 2,
    parameters: {
      type: 'object',
      properties: {
        canvasId: { type: 'string', description: 'The target canvas ID.' },
        nodeId: { type: 'string', description: 'The node ID to update.' },
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
      required: ['canvasId', 'nodeId', 'equipmentRefs'],
    },
    async execute(args) {
      try {
        const canvasId = requireString(args, 'canvasId');
        const nodeId = requireString(args, 'nodeId');
        const { node } = await requireNode(deps, canvasId, nodeId);
        if (node.type !== 'image' && node.type !== 'video') {
          throw new Error(`Node type "${node.type}" does not support equipment refs`);
        }
        if (!Array.isArray(args.equipmentRefs)) throw new Error('equipmentRefs must be an array');
        const equipmentRefs = (args.equipmentRefs as Array<Record<string, unknown>>).map((r) => ({
          equipmentId: String(r.equipmentId ?? ''),
        }));
        await deps.updateNodeData(canvasId, nodeId, { equipmentRefs });
        return ok({ nodeId, equipmentRefs });
      } catch (error) {
        return fail(error);
      }
    },
  };

  const setLocationRefs: AgentTool = {
    name: 'canvas.setLocationRefs',
    description: 'Assign location references to an image or video node. Pass empty array to clear all refs.',
    context: CANVAS_CONTEXT,
    tier: 2,
    parameters: {
      type: 'object',
      properties: {
        canvasId: { type: 'string', description: 'The target canvas ID.' },
        nodeId: { type: 'string', description: 'The node ID to update.' },
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
      required: ['canvasId', 'nodeId', 'locationRefs'],
    },
    async execute(args) {
      try {
        const canvasId = requireString(args, 'canvasId');
        const nodeId = requireString(args, 'nodeId');
        const { node } = await requireNode(deps, canvasId, nodeId);
        if (node.type !== 'image' && node.type !== 'video') {
          throw new Error(`Node type "${node.type}" does not support location refs`);
        }
        if (!Array.isArray(args.locationRefs)) throw new Error('locationRefs must be an array');
        const locationRefs = (args.locationRefs as Array<Record<string, unknown>>).map((r) => ({
          locationId: String(r.locationId ?? ''),
        }));
        await deps.updateNodeData(canvasId, nodeId, { locationRefs });
        return ok({ nodeId, locationRefs });
      } catch (error) {
        return fail(error);
      }
    },
  };

  return [
    setCharacterRefs, setEquipmentRefs, setLocationRefs,
  ];
}
