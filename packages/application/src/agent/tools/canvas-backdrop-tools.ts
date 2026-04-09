import type { AgentTool, CanvasToolDeps } from './canvas-tool-utils.js';
import {
  CANVAS_CONTEXT,
  ok,
  fail,
  requireString,
  requireNumber,
  requireBoolean,
  requireBackdropBorderStyle,
  requireBackdropTitleSize,
  requireNode,
  requireBackdropNode,
} from './canvas-tool-utils.js';

export function createCanvasBackdropTools(deps: CanvasToolDeps): AgentTool[] {
  const setBackdropOpacity: AgentTool = {
    name: 'canvas.setBackdropOpacity',
    description: 'Set the opacity of a backdrop node.',
    context: CANVAS_CONTEXT,
    tier: 2,
    parameters: {
      type: 'object',
      properties: {
        canvasId: { type: 'string', description: 'The target canvas ID.' },
        nodeId: { type: 'string', description: 'The backdrop node ID to update.' },
        opacity: { type: 'number', description: 'Backdrop opacity value.' },
      },
      required: ['canvasId', 'nodeId', 'opacity'],
    },
    async execute(args) {
      try {
        const canvasId = requireString(args, 'canvasId');
        const nodeId = requireString(args, 'nodeId');
        const opacity = requireNumber(args, 'opacity');
        const { node } = await requireNode(deps, canvasId, nodeId);
        requireBackdropNode(node);
        await deps.updateNodeData(canvasId, nodeId, { opacity });
        return ok({ nodeId, opacity });
      } catch (error) {
        return fail(error);
      }
    },
  };

  const setBackdropColor: AgentTool = {
    name: 'canvas.setBackdropColor',
    description: 'Set the background color of a backdrop node.',
    context: CANVAS_CONTEXT,
    tier: 2,
    parameters: {
      type: 'object',
      properties: {
        canvasId: { type: 'string', description: 'The target canvas ID.' },
        nodeId: { type: 'string', description: 'The backdrop node ID to update.' },
        color: { type: 'string', description: 'Backdrop color string.' },
      },
      required: ['canvasId', 'nodeId', 'color'],
    },
    async execute(args) {
      try {
        const canvasId = requireString(args, 'canvasId');
        const nodeId = requireString(args, 'nodeId');
        const color = requireString(args, 'color');
        const { node } = await requireNode(deps, canvasId, nodeId);
        requireBackdropNode(node);
        await deps.updateNodeData(canvasId, nodeId, { color });
        return ok({ nodeId, color });
      } catch (error) {
        return fail(error);
      }
    },
  };

  const setBackdropBorderStyle: AgentTool = {
    name: 'canvas.setBackdropBorderStyle',
    description: 'Set the border style of a backdrop node.',
    context: CANVAS_CONTEXT,
    tier: 2,
    parameters: {
      type: 'object',
      properties: {
        canvasId: { type: 'string', description: 'The target canvas ID.' },
        nodeId: { type: 'string', description: 'The backdrop node ID to update.' },
        borderStyle: {
          type: 'string',
          description: 'Backdrop border style.',
          enum: ['dashed', 'solid', 'dotted'],
        },
      },
      required: ['canvasId', 'nodeId', 'borderStyle'],
    },
    async execute(args) {
      try {
        const canvasId = requireString(args, 'canvasId');
        const nodeId = requireString(args, 'nodeId');
        const borderStyle = requireBackdropBorderStyle(args);
        const { node } = await requireNode(deps, canvasId, nodeId);
        requireBackdropNode(node);
        await deps.updateNodeData(canvasId, nodeId, { borderStyle });
        return ok({ nodeId, borderStyle });
      } catch (error) {
        return fail(error);
      }
    },
  };

  const setBackdropTitleSize: AgentTool = {
    name: 'canvas.setBackdropTitleSize',
    description: 'Set the title size of a backdrop node.',
    context: CANVAS_CONTEXT,
    tier: 2,
    parameters: {
      type: 'object',
      properties: {
        canvasId: { type: 'string', description: 'The target canvas ID.' },
        nodeId: { type: 'string', description: 'The backdrop node ID to update.' },
        titleSize: {
          type: 'string',
          description: 'Backdrop title size.',
          enum: ['sm', 'md', 'lg'],
        },
      },
      required: ['canvasId', 'nodeId', 'titleSize'],
    },
    async execute(args) {
      try {
        const canvasId = requireString(args, 'canvasId');
        const nodeId = requireString(args, 'nodeId');
        const titleSize = requireBackdropTitleSize(args);
        const { node } = await requireNode(deps, canvasId, nodeId);
        requireBackdropNode(node);
        await deps.updateNodeData(canvasId, nodeId, { titleSize });
        return ok({ nodeId, titleSize });
      } catch (error) {
        return fail(error);
      }
    },
  };

  const setBackdropLockChildren: AgentTool = {
    name: 'canvas.setBackdropLockChildren',
    description: 'Lock or unlock child movement inside a backdrop node.',
    context: CANVAS_CONTEXT,
    tier: 2,
    parameters: {
      type: 'object',
      properties: {
        canvasId: { type: 'string', description: 'The target canvas ID.' },
        nodeId: { type: 'string', description: 'The backdrop node ID to update.' },
        locked: { type: 'boolean', description: 'Whether child nodes are locked inside the backdrop.' },
      },
      required: ['canvasId', 'nodeId', 'locked'],
    },
    async execute(args) {
      try {
        const canvasId = requireString(args, 'canvasId');
        const nodeId = requireString(args, 'nodeId');
        const locked = requireBoolean(args, 'locked');
        const { node } = await requireNode(deps, canvasId, nodeId);
        requireBackdropNode(node);
        await deps.updateNodeData(canvasId, nodeId, { lockChildren: locked });
        return ok({ nodeId, locked });
      } catch (error) {
        return fail(error);
      }
    },
  };

  const toggleBackdropCollapse: AgentTool = {
    name: 'canvas.toggleBackdropCollapse',
    description: 'Toggle the collapsed state of a backdrop node.',
    context: CANVAS_CONTEXT,
    tier: 2,
    parameters: {
      type: 'object',
      properties: {
        canvasId: { type: 'string', description: 'The target canvas ID.' },
        nodeId: { type: 'string', description: 'The backdrop node ID to update.' },
      },
      required: ['canvasId', 'nodeId'],
    },
    async execute(args) {
      try {
        const canvasId = requireString(args, 'canvasId');
        const nodeId = requireString(args, 'nodeId');
        const { node } = await requireNode(deps, canvasId, nodeId);
        requireBackdropNode(node);
        const collapsed = !((node.data as { collapsed?: boolean }).collapsed ?? false);
        await deps.updateNodeData(canvasId, nodeId, { collapsed });
        return ok({ nodeId, collapsed });
      } catch (error) {
        return fail(error);
      }
    },
  };

  return [
    setBackdropOpacity, setBackdropColor, setBackdropBorderStyle,
    setBackdropTitleSize, setBackdropLockChildren, toggleBackdropCollapse,
  ];
}
