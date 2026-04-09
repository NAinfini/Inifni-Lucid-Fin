import type { PayloadAction } from '@reduxjs/toolkit';
import type { Connection } from '@xyflow/react';
import type {
  CanvasEdge,
  CanvasNodeType,
  CanvasNodeData,
  EdgeStatus,
} from '@lucid-fin/contracts';
import type { CanvasSliceState } from './canvas.js';
import {
  findActiveCanvas,
  ensureEdgeLabel,
  getAutoEdgeLabel,
  getCanvasNodeType,
  createEntityId,
  createNodeRecord,
} from './canvas-helpers.js';

// ---------------------------------------------------------------------------
// Edge CRUD
// ---------------------------------------------------------------------------

export function addEdge(state: CanvasSliceState, action: PayloadAction<CanvasEdge>): void {
  const canvas = findActiveCanvas(state);
  if (!canvas) return;
  const edge = ensureEdgeLabel(canvas, action.payload);
  const exists = canvas.edges.some(
    (e) =>
      e.source === edge.source &&
      e.target === edge.target &&
      e.sourceHandle === edge.sourceHandle &&
      e.targetHandle === edge.targetHandle,
  );
  if (!exists) {
    canvas.edges.push(edge);
    canvas.updatedAt = Date.now();
  }
}

export function removeEdges(state: CanvasSliceState, action: PayloadAction<string[]>): void {
  const canvas = findActiveCanvas(state);
  if (!canvas) return;
  const ids = new Set(action.payload);
  const removedEdges = canvas.edges.filter((e) => ids.has(e.id));
  canvas.edges = canvas.edges.filter((e) => !ids.has(e.id));
  state.selectedEdgeIds = state.selectedEdgeIds.filter((id) => !ids.has(id));
  for (const edge of removedEdges) {
    const targetNode = canvas.nodes.find((n) => n.id === edge.target);
    if (targetNode?.type === 'video') {
      const data = targetNode.data as import('@lucid-fin/contracts').VideoNodeData;
      if (data.firstFrameNodeId === edge.source) data.firstFrameNodeId = undefined;
    }
    const sourceNode = canvas.nodes.find((n) => n.id === edge.source);
    if (sourceNode?.type === 'video') {
      const data = sourceNode.data as import('@lucid-fin/contracts').VideoNodeData;
      if (data.lastFrameNodeId === edge.target) data.lastFrameNodeId = undefined;
    }
  }
  canvas.updatedAt = Date.now();
}

export function updateEdge(
  state: CanvasSliceState,
  action: PayloadAction<{ id: string; changes: Partial<CanvasEdge> }>,
): void {
  const canvas = findActiveCanvas(state);
  if (!canvas) return;
  const edge = canvas.edges.find((e) => e.id === action.payload.id);
  if (edge) {
    Object.assign(edge, action.payload.changes);
    canvas.updatedAt = Date.now();
  }
}

export function reconnectCanvasEdge(
  state: CanvasSliceState,
  action: PayloadAction<{
    edgeId: string;
    connection: Pick<Connection, 'source' | 'target' | 'sourceHandle' | 'targetHandle'>;
  }>,
): void {
  const canvas = findActiveCanvas(state);
  if (!canvas) return;
  const edge = canvas.edges.find((item) => item.id === action.payload.edgeId);
  const { source, target, sourceHandle, targetHandle } = action.payload.connection;
  if (!edge || !source || !target) return;

  edge.source = source;
  edge.target = target;
  edge.sourceHandle = sourceHandle ?? undefined;
  edge.targetHandle = targetHandle ?? undefined;

  if (edge.data.autoLabel) {
    edge.data.label = getAutoEdgeLabel(
      getCanvasNodeType(canvas, edge.source),
      getCanvasNodeType(canvas, edge.target),
    );
  }

  canvas.updatedAt = Date.now();
}

export function setEdgeStatus(
  state: CanvasSliceState,
  action: PayloadAction<{ id: string; status: EdgeStatus }>,
): void {
  const canvas = findActiveCanvas(state);
  if (!canvas) return;
  const edge = canvas.edges.find((e) => e.id === action.payload.id);
  if (edge) {
    edge.data.status = action.payload.status;
    canvas.updatedAt = Date.now();
  }
}

export function swapEdgeDirection(state: CanvasSliceState, action: PayloadAction<string>): void {
  const canvas = findActiveCanvas(state);
  if (!canvas) return;
  const edge = canvas.edges.find((e) => e.id === action.payload);
  if (edge) {
    const tmp = edge.source;
    edge.source = edge.target;
    edge.target = tmp;
    const tmpH = edge.sourceHandle;
    edge.sourceHandle = edge.targetHandle;
    edge.targetHandle = tmpH;
    if (edge.data.autoLabel) {
      edge.data.label = getAutoEdgeLabel(
        getCanvasNodeType(canvas, edge.source),
        getCanvasNodeType(canvas, edge.target),
      );
    }
    canvas.updatedAt = Date.now();
  }
}

export function disconnectNode(state: CanvasSliceState, action: PayloadAction<string>): void {
  const canvas = findActiveCanvas(state);
  if (!canvas) return;
  canvas.edges = canvas.edges.filter(
    (e) => e.source !== action.payload && e.target !== action.payload,
  );
  canvas.updatedAt = Date.now();
}

export function insertNodeIntoEdge(
  state: CanvasSliceState,
  action: PayloadAction<{
    edgeId: string;
    nodeType: CanvasNodeType;
    position: { x: number; y: number };
    title?: string;
    data?: CanvasNodeData;
    id?: string;
    width?: number;
    height?: number;
  }>,
): void {
  const canvas = findActiveCanvas(state);
  if (!canvas) return;

  const edgeIndex = canvas.edges.findIndex((edge) => edge.id === action.payload.edgeId);
  if (edgeIndex === -1) return;

  const edge = canvas.edges[edgeIndex]!;
  const insertedNode = createNodeRecord({
    id: action.payload.id ?? createEntityId('node'),
    type: action.payload.nodeType,
    position: action.payload.position,
    title: action.payload.title,
    data: action.payload.data,
    width: action.payload.width,
    height: action.payload.height,
  });

  canvas.nodes.push(insertedNode);
  canvas.edges.splice(edgeIndex, 1);

  const status = edge.data.status;
  canvas.edges.push(
    {
      id: createEntityId('edge'),
      source: edge.source,
      target: insertedNode.id,
      sourceHandle: edge.sourceHandle,
      data: {
        status,
        label: getAutoEdgeLabel(getCanvasNodeType(canvas, edge.source), insertedNode.type),
        autoLabel: true,
      },
    },
    {
      id: createEntityId('edge'),
      source: insertedNode.id,
      target: edge.target,
      targetHandle: edge.targetHandle,
      data: {
        status,
        label: getAutoEdgeLabel(insertedNode.type, getCanvasNodeType(canvas, edge.target)),
        autoLabel: true,
      },
    },
  );

  canvas.updatedAt = Date.now();
  state.selectedNodeIds = [insertedNode.id];
  state.selectedEdgeIds = [];
}
