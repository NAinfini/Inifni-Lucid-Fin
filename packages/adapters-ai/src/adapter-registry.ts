import {
  resolveBuiltinMediaAdapterId,
  resolveBuiltinProviderId,
  resolveUnambiguousBuiltinMediaAdapterId,
  type AIProviderAdapter,
  type AdapterType,
  type GenerationType,
} from '@lucid-fin/contracts';

export class AdapterRegistry {
  private adapters = new Map<string, AIProviderAdapter>();

  register(adapter: AIProviderAdapter): void {
    this.adapters.set(adapter.id, adapter);
  }

  get(providerId: string): AIProviderAdapter | undefined {
    const normalizedProviderId = providerId.trim().toLowerCase();
    const direct = this.adapters.get(normalizedProviderId);
    if (direct) return direct;

    const catalogAdapterId = resolveUnambiguousBuiltinMediaAdapterId(normalizedProviderId);
    if (catalogAdapterId) return this.adapters.get(catalogAdapterId);

    return this.adapters.get(resolveBuiltinProviderId(normalizedProviderId) ?? '');
  }

  /** Resolve a persisted media provider ID with image/video context. */
  resolve(providerId: string, generationType: GenerationType): AIProviderAdapter | undefined {
    if (generationType === 'image' || generationType === 'video') {
      const adapterId = resolveBuiltinMediaAdapterId(providerId, generationType);
      if (adapterId) return this.adapters.get(adapterId);
    }
    return this.get(providerId);
  }

  list(type?: AdapterType): AIProviderAdapter[] {
    const all = Array.from(this.adapters.values());
    if (!type) return all;
    return all.filter((a) => {
      const types = Array.isArray(a.type) ? a.type : [a.type];
      return types.includes(type);
    });
  }

  async isConfigured(providerId: string, generationType?: GenerationType): Promise<boolean> {
    const adapter = generationType
      ? this.resolve(providerId, generationType)
      : this.get(providerId);
    if (!adapter) return false;
    return adapter.validate();
  }

  unregister(providerId: string): boolean {
    const adapter = this.get(providerId);
    return adapter ? this.adapters.delete(adapter.id) : false;
  }
}
