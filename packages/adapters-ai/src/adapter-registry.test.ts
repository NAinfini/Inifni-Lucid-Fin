import { describe, it, expect, vi } from 'vitest';
import { AdapterRegistry } from '../src/adapter-registry.js';
import type { AIProviderAdapter, AdapterType } from '@lucid-fin/contracts';

function mockAdapter(id = 'mock', type: string = 'image'): AIProviderAdapter {
  return {
    id,
    name: `Mock ${id}`,
    type: type as AdapterType,
    capabilities: [type as AdapterType],
    maxConcurrent: 2,
    configure: vi.fn(),
    validate: vi.fn().mockResolvedValue(true),
    generate: vi.fn().mockResolvedValue({ assetHash: '', assetPath: '', provider: id }),
    estimateCost: vi
      .fn()
      .mockReturnValue({ provider: id, estimatedCost: 0, currency: 'USD', unit: 'each' }),
    checkStatus: vi.fn().mockResolvedValue('completed'),
    cancel: vi.fn().mockResolvedValue(undefined),
  };
}

describe('AdapterRegistry', () => {
  it('registers and retrieves an adapter', () => {
    const reg = new AdapterRegistry();
    const adapter = mockAdapter('dalle');
    reg.register(adapter);
    expect(reg.get('dalle')).toBe(adapter);
  });

  it('returns undefined for unknown adapter', () => {
    const reg = new AdapterRegistry();
    expect(reg.get('nope')).toBeUndefined();
  });

  it('lists all adapters', () => {
    const reg = new AdapterRegistry();
    reg.register(mockAdapter('a', 'image'));
    reg.register(mockAdapter('b', 'video'));
    expect(reg.list()).toHaveLength(2);
  });

  it('filters by type', () => {
    const reg = new AdapterRegistry();
    reg.register(mockAdapter('a', 'image'));
    reg.register(mockAdapter('b', 'video'));
    reg.register(mockAdapter('c', 'image'));
    expect(reg.list('image' as AdapterType)).toHaveLength(2);
    expect(reg.list('video' as AdapterType)).toHaveLength(1);
  });

  it('unregisters an adapter', () => {
    const reg = new AdapterRegistry();
    reg.register(mockAdapter('a'));
    expect(reg.unregister('a')).toBe(true);
    expect(reg.get('a')).toBeUndefined();
    expect(reg.unregister('a')).toBe(false);
  });

  it('isConfigured delegates to adapter.validate()', async () => {
    const reg = new AdapterRegistry();
    const adapter = mockAdapter('a');
    reg.register(adapter);
    expect(await reg.isConfigured('a')).toBe(true);
    expect(adapter.validate).toHaveBeenCalled();
  });

  it('isConfigured returns false for unknown adapter', async () => {
    const reg = new AdapterRegistry();
    expect(await reg.isConfigured('nope')).toBe(false);
  });

  it('overwrites adapter with same id', () => {
    const reg = new AdapterRegistry();
    reg.register(mockAdapter('a', 'image'));
    reg.register(mockAdapter('a', 'video'));
    expect(reg.get('a')!.type).toBe('video');
    expect(reg.list()).toHaveLength(1);
  });
});
