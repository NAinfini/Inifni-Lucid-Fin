export interface LRUCacheOptions<K, V> {
  onEvict?: (key: K, value: V) => void;
}

/**
 * Generic bounded LRU cache backed by a Map (insertion-ordered in JS).
 * O(1) get/set/delete. Evicts least-recently-used entries when capacity is exceeded.
 */
export class LRUCache<K, V> {
  private readonly map = new Map<K, V>();
  private readonly onEvict?: (key: K, value: V) => void;

  constructor(
    private readonly capacity: number,
    options?: LRUCacheOptions<K, V>,
  ) {
    if (capacity < 1) throw new RangeError('LRUCache capacity must be >= 1');
    this.onEvict = options?.onEvict;
  }

  get size(): number {
    return this.map.size;
  }

  get(key: K): V | undefined {
    const value = this.map.get(key);
    if (value === undefined) return undefined;
    // Promote: delete + re-insert moves to end (most recent)
    this.map.delete(key);
    this.map.set(key, value);
    return value;
  }

  has(key: K): boolean {
    return this.map.has(key);
  }

  set(key: K, value: V): void {
    if (this.map.has(key)) {
      this.map.delete(key);
    } else if (this.map.size >= this.capacity) {
      const oldest = this.map.keys().next().value!;
      const oldestValue = this.map.get(oldest)!;
      this.map.delete(oldest);
      this.onEvict?.(oldest, oldestValue);
    }
    this.map.set(key, value);
  }

  delete(key: K): boolean {
    return this.map.delete(key);
  }

  clear(): void {
    this.map.clear();
  }
}
