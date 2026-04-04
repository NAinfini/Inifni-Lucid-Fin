/**
 * Cascade Update Engine
 *
 * Builds a dependency graph between entities (character → keyframe → segment)
 * and propagates "needs update" flags when upstream entities change.
 * Batch-marks rather than instant regeneration — user confirms before triggering.
 */

export type EntityType = 'character' | 'style' | 'keyframe' | 'segment' | 'audio' | 'subtitle';

export interface DependencyNode {
  id: string;
  type: EntityType;
  /** IDs of nodes this node depends on (upstream) */
  dependsOn: Set<string>;
  /** IDs of nodes that depend on this node (downstream) */
  dependedBy: Set<string>;
  /** Whether this node needs regeneration */
  stale: boolean;
  /** Timestamp of last update */
  updatedAt: number;
}

export interface CascadeEvent {
  sourceId: string;
  sourceType: EntityType;
  affectedIds: string[];
  timestamp: number;
}

export class DependencyGraph {
  private nodes = new Map<string, DependencyNode>();
  private eventLog: CascadeEvent[] = [];

  /** Register an entity in the graph */
  addNode(id: string, type: EntityType): void {
    if (this.nodes.has(id)) return;
    this.nodes.set(id, {
      id,
      type,
      dependsOn: new Set(),
      dependedBy: new Set(),
      stale: false,
      updatedAt: Date.now(),
    });
  }

  /** Remove an entity and all its edges */
  removeNode(id: string): void {
    const node = this.nodes.get(id);
    if (!node) return;
    for (const upId of node.dependsOn) {
      this.nodes.get(upId)?.dependedBy.delete(id);
    }
    for (const downId of node.dependedBy) {
      this.nodes.get(downId)?.dependsOn.delete(id);
    }
    this.nodes.delete(id);
  }

  /** Declare that `downstream` depends on `upstream`. Returns false if it would create a cycle. */
  addEdge(upstreamId: string, downstreamId: string): boolean {
    const up = this.nodes.get(upstreamId);
    const down = this.nodes.get(downstreamId);
    if (!up || !down) return false;
    if (upstreamId === downstreamId) return false;

    // Cycle check: would adding this edge create a path from downstream back to upstream?
    if (this.hasPath(downstreamId, upstreamId)) return false;

    up.dependedBy.add(downstreamId);
    down.dependsOn.add(upstreamId);
    return true;
  }

  /** Remove a dependency edge */
  removeEdge(upstreamId: string, downstreamId: string): void {
    this.nodes.get(upstreamId)?.dependedBy.delete(downstreamId);
    this.nodes.get(downstreamId)?.dependsOn.delete(upstreamId);
  }

  /** Check if there is a path from `fromId` to `toId` via dependedBy edges (BFS) */
  private hasPath(fromId: string, toId: string): boolean {
    const visited = new Set<string>();
    const queue = [fromId];
    while (queue.length > 0) {
      const id = queue.shift()!;
      if (id === toId) return true;
      if (visited.has(id)) continue;
      visited.add(id);
      const node = this.nodes.get(id);
      if (node) {
        for (const next of node.dependedBy) {
          if (!visited.has(next)) queue.push(next);
        }
      }
    }
    return false;
  }

  /**
   * Mark an entity as changed and propagate staleness downstream.
   * Returns all affected node IDs (breadth-first).
   */
  markChanged(sourceId: string): string[] {
    const source = this.nodes.get(sourceId);
    if (!source) return [];

    source.updatedAt = Date.now();
    const affected: string[] = [];
    const queue = [...source.dependedBy];
    const visited = new Set<string>();

    while (queue.length > 0) {
      const id = queue.shift()!;
      if (visited.has(id)) continue;
      visited.add(id);

      const node = this.nodes.get(id);
      if (!node) continue;

      node.stale = true;
      affected.push(id);

      for (const downId of node.dependedBy) {
        if (!visited.has(downId)) queue.push(downId);
      }
    }

    if (affected.length > 0) {
      this.eventLog.push({
        sourceId,
        sourceType: source.type,
        affectedIds: affected,
        timestamp: Date.now(),
      });
      if (this.eventLog.length > 500) this.eventLog.shift();
    }

    return affected;
  }

  /** Clear stale flag after regeneration */
  markFresh(id: string): void {
    const node = this.nodes.get(id);
    if (node) {
      node.stale = false;
      node.updatedAt = Date.now();
    }
  }

  /** Batch clear stale flags */
  markFreshBatch(ids: string[]): void {
    for (const id of ids) this.markFresh(id);
  }

  /** Get all stale nodes */
  getStaleNodes(): DependencyNode[] {
    return [...this.nodes.values()].filter((n) => n.stale);
  }

  /** Get stale nodes grouped by type */
  getStaleByType(): Map<EntityType, DependencyNode[]> {
    const result = new Map<EntityType, DependencyNode[]>();
    for (const node of this.nodes.values()) {
      if (!node.stale) continue;
      const list = result.get(node.type) ?? [];
      list.push(node);
      result.set(node.type, list);
    }
    return result;
  }

  /** Get direct upstream dependencies of a node */
  getUpstream(id: string): DependencyNode[] {
    const node = this.nodes.get(id);
    if (!node) return [];
    return [...node.dependsOn]
      .map((uid) => this.nodes.get(uid))
      .filter(Boolean) as DependencyNode[];
  }

  /** Get direct downstream dependents of a node */
  getDownstream(id: string): DependencyNode[] {
    const node = this.nodes.get(id);
    if (!node) return [];
    return [...node.dependedBy]
      .map((did) => this.nodes.get(did))
      .filter(Boolean) as DependencyNode[];
  }

  /** Get a node by ID */
  getNode(id: string): DependencyNode | undefined {
    return this.nodes.get(id);
  }

  /** Get all nodes */
  getAllNodes(): DependencyNode[] {
    return [...this.nodes.values()];
  }

  /** Get recent cascade events */
  getEventLog(limit = 50): CascadeEvent[] {
    return this.eventLog.slice(-limit);
  }

  /** Serialize for persistence */
  serialize(): {
    nodes: Array<{
      id: string;
      type: EntityType;
      dependsOn: string[];
      stale: boolean;
      updatedAt: number;
    }>;
  } {
    return {
      nodes: [...this.nodes.values()].map((n) => ({
        id: n.id,
        type: n.type,
        dependsOn: [...n.dependsOn],
        stale: n.stale,
        updatedAt: n.updatedAt,
      })),
    };
  }

  /** Restore from persistence */
  static deserialize(data: ReturnType<DependencyGraph['serialize']>): DependencyGraph {
    const graph = new DependencyGraph();
    for (const n of data.nodes) {
      graph.addNode(n.id, n.type);
      const node = graph.nodes.get(n.id)!;
      node.stale = n.stale;
      node.updatedAt = n.updatedAt;
    }
    // Restore edges
    for (const n of data.nodes) {
      for (const upId of n.dependsOn) {
        graph.addEdge(upId, n.id);
      }
    }
    return graph;
  }
}
