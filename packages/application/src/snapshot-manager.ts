/**
 * Snapshot Manager — named snapshots with JSON diff and restore.
 */

export interface Snapshot {
  id: string;
  name: string;
  description?: string;
  timestamp: number;
  data: Record<string, unknown>;
}

export interface DiffEntry {
  path: string;
  type: 'added' | 'removed' | 'changed';
  oldValue?: unknown;
  newValue?: unknown;
}

export class SnapshotManager {
  private snapshots: Snapshot[] = [];
  private idCounter = 0;

  /** Create a named snapshot of the current state */
  create(name: string, data: Record<string, unknown>, description?: string): Snapshot {
    const snap: Snapshot = {
      id: `snap-${++this.idCounter}`,
      name,
      description,
      timestamp: Date.now(),
      data: structuredClone(data),
    };
    this.snapshots.push(snap);
    return snap;
  }

  /** Get a snapshot by ID */
  get(id: string): Snapshot | undefined {
    return this.snapshots.find((s) => s.id === id);
  }

  /** List all snapshots, newest first */
  list(): readonly Snapshot[] {
    return [...this.snapshots].sort((a, b) => b.timestamp - a.timestamp);
  }

  /** Delete a snapshot */
  remove(id: string): boolean {
    const idx = this.snapshots.findIndex((s) => s.id === id);
    if (idx < 0) return false;
    this.snapshots.splice(idx, 1);
    return true;
  }

  /** Rename a snapshot */
  rename(id: string, name: string): boolean {
    const snap = this.snapshots.find((s) => s.id === id);
    if (!snap) return false;
    snap.name = name;
    return true;
  }

  /** Compare two snapshots and return a list of differences */
  diff(idA: string, idB: string): DiffEntry[] {
    const a = this.get(idA);
    const b = this.get(idB);
    if (!a || !b) return [];
    return deepDiff(a.data, b.data, '');
  }

  /** Compare a snapshot against current state */
  diffWithCurrent(id: string, currentData: Record<string, unknown>): DiffEntry[] {
    const snap = this.get(id);
    if (!snap) return [];
    return deepDiff(snap.data, currentData, '');
  }

  /** Get snapshot data for restore */
  getRestoreData(id: string): Record<string, unknown> | null {
    const snap = this.get(id);
    return snap ? structuredClone(snap.data) : null;
  }

  /** Load snapshots from persistence */
  loadSnapshots(snapshots: Snapshot[]): void {
    this.snapshots = snapshots.map((s) => structuredClone(s));
    this.idCounter = snapshots.reduce((max, s) => {
      const n = parseInt(s.id.replace('snap-', ''), 10);
      return isNaN(n) ? max : Math.max(max, n);
    }, 0);
  }

  /** Get all snapshots for persistence */
  getSnapshots(): Snapshot[] {
    return this.snapshots.map((s) => structuredClone(s));
  }
}

/** Deep diff two objects, returning a flat list of changes */
function deepDiff(a: unknown, b: unknown, path: string): DiffEntry[] {
  if (a === b) return [];

  // Primitives or type mismatch
  if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') {
    if (a === undefined) return [{ path, type: 'added', newValue: b }];
    if (b === undefined) return [{ path, type: 'removed', oldValue: a }];
    return [{ path, type: 'changed', oldValue: a, newValue: b }];
  }

  // Arrays
  if (Array.isArray(a) && Array.isArray(b)) {
    const entries: DiffEntry[] = [];
    const maxLen = Math.max(a.length, b.length);
    for (let i = 0; i < maxLen; i++) {
      const p = path ? `${path}[${i}]` : `[${i}]`;
      if (i >= a.length) entries.push({ path: p, type: 'added', newValue: b[i] });
      else if (i >= b.length) entries.push({ path: p, type: 'removed', oldValue: a[i] });
      else entries.push(...deepDiff(a[i], b[i], p));
    }
    return entries;
  }

  // Objects
  const aObj = a as Record<string, unknown>;
  const bObj = b as Record<string, unknown>;
  const allKeys = new Set([...Object.keys(aObj), ...Object.keys(bObj)]);
  const entries: DiffEntry[] = [];

  for (const key of allKeys) {
    const p = path ? `${path}.${key}` : key;
    if (!(key in aObj)) entries.push({ path: p, type: 'added', newValue: bObj[key] });
    else if (!(key in bObj)) entries.push({ path: p, type: 'removed', oldValue: aObj[key] });
    else entries.push(...deepDiff(aObj[key], bObj[key], p));
  }

  return entries;
}
