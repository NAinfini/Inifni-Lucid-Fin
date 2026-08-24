import type { BackdropNodeData, CanvasNode } from '@lucid-fin/contracts';

const DEFAULT_NODE_WIDTH = 200;
const DEFAULT_NODE_HEIGHT = 100;
const DEFAULT_BACKDROP_WIDTH = 420;
const DEFAULT_BACKDROP_HEIGHT = 240;
const SPATIAL_CELL_SIZE = 512;
const MAX_INDEXED_CELLS_PER_BACKDROP = 256;

interface BackdropBounds {
  id: string;
  left: number;
  top: number;
  right: number;
  bottom: number;
  collapsed: boolean;
}

export interface BackdropContainment {
  backdropChildCounts: Map<string, number>;
  hiddenNodeIds: Set<string>;
}

function cellKey(x: number, y: number): string {
  return `${x}:${y}`;
}

function contains(bounds: BackdropBounds, x: number, y: number): boolean {
  return x >= bounds.left && x <= bounds.right && y >= bounds.top && y <= bounds.bottom;
}

/**
 * Computes geometric backdrop membership without scanning every backdrop for
 * every node. Backdrops that cover an unusually large number of grid cells are
 * kept in a small overflow list so a single giant backdrop cannot explode the
 * index size.
 */
export function computeBackdropContainment(nodes: readonly CanvasNode[]): BackdropContainment {
  const backdropChildCounts = new Map<string, number>();
  const hiddenNodeIds = new Set<string>();
  const buckets = new Map<string, BackdropBounds[]>();
  const overflow: BackdropBounds[] = [];

  for (const node of nodes) {
    if (node.type !== 'backdrop') continue;

    const width = node.width ?? DEFAULT_BACKDROP_WIDTH;
    const height = node.height ?? DEFAULT_BACKDROP_HEIGHT;
    const bounds: BackdropBounds = {
      id: node.id,
      left: node.position.x,
      top: node.position.y,
      right: node.position.x + width,
      bottom: node.position.y + height,
      collapsed: Boolean((node.data as BackdropNodeData).collapsed),
    };
    backdropChildCounts.set(node.id, 0);

    const minCellX = Math.floor(bounds.left / SPATIAL_CELL_SIZE);
    const maxCellX = Math.floor(bounds.right / SPATIAL_CELL_SIZE);
    const minCellY = Math.floor(bounds.top / SPATIAL_CELL_SIZE);
    const maxCellY = Math.floor(bounds.bottom / SPATIAL_CELL_SIZE);
    const coveredCellCount = (maxCellX - minCellX + 1) * (maxCellY - minCellY + 1);

    if (coveredCellCount > MAX_INDEXED_CELLS_PER_BACKDROP) {
      overflow.push(bounds);
      continue;
    }

    for (let cellX = minCellX; cellX <= maxCellX; cellX++) {
      for (let cellY = minCellY; cellY <= maxCellY; cellY++) {
        const key = cellKey(cellX, cellY);
        const bucket = buckets.get(key);
        if (bucket) bucket.push(bounds);
        else buckets.set(key, [bounds]);
      }
    }
  }

  const recordMembership = (nodeId: string, centerX: number, centerY: number, bounds: BackdropBounds) => {
    if (!contains(bounds, centerX, centerY)) return;
    backdropChildCounts.set(bounds.id, (backdropChildCounts.get(bounds.id) ?? 0) + 1);
    if (bounds.collapsed) hiddenNodeIds.add(nodeId);
  };

  for (const node of nodes) {
    if (node.type === 'backdrop') continue;
    const centerX = node.position.x + (node.width ?? DEFAULT_NODE_WIDTH) / 2;
    const centerY = node.position.y + (node.height ?? DEFAULT_NODE_HEIGHT) / 2;
    const bucket = buckets.get(
      cellKey(Math.floor(centerX / SPATIAL_CELL_SIZE), Math.floor(centerY / SPATIAL_CELL_SIZE)),
    );

    if (bucket) {
      for (const bounds of bucket) recordMembership(node.id, centerX, centerY, bounds);
    }
    for (const bounds of overflow) recordMembership(node.id, centerX, centerY, bounds);
  }

  return { backdropChildCounts, hiddenNodeIds };
}
