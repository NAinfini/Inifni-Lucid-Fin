import { describe, expect, it } from 'vitest';

import { LRUCache } from './lru-cache.js';

describe('LRUCache', () => {
  it('stores and retrieves values', () => {
    const cache = new LRUCache<string, number>(3);
    cache.set('a', 1);
    cache.set('b', 2);
    expect(cache.get('a')).toBe(1);
    expect(cache.get('b')).toBe(2);
    expect(cache.get('c')).toBeUndefined();
    expect(cache.size).toBe(2);
  });

  it('evicts least-recently-used when capacity is exceeded', () => {
    const cache = new LRUCache<string, number>(2);
    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('c', 3);
    expect(cache.get('a')).toBeUndefined();
    expect(cache.get('b')).toBe(2);
    expect(cache.get('c')).toBe(3);
  });

  it('promotes accessed entries', () => {
    const cache = new LRUCache<string, number>(2);
    cache.set('a', 1);
    cache.set('b', 2);
    cache.get('a');
    cache.set('c', 3);
    expect(cache.get('a')).toBe(1);
    expect(cache.get('b')).toBeUndefined();
  });

  it('supports delete, clear, and has', () => {
    const cache = new LRUCache<string, number>(2);
    cache.set('a', 1);
    expect(cache.has('a')).toBe(true);
    expect(cache.delete('a')).toBe(true);
    cache.set('b', 2);
    cache.clear();
    expect(cache.size).toBe(0);
  });

  it('calls the eviction callback', () => {
    const evicted: Array<[string, number]> = [];
    const cache = new LRUCache<string, number>(1, {
      onEvict: (key, value) => evicted.push([key, value]),
    });
    cache.set('a', 1);
    cache.set('b', 2);
    expect(evicted).toEqual([['a', 1]]);
  });

  it('rejects invalid capacity', () => {
    expect(() => new LRUCache(0)).toThrow(RangeError);
  });
});
