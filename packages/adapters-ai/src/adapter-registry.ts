import type { AIProviderAdapter, AdapterType } from '@lucid-fin/contracts';

export class AdapterRegistry {
  private adapters = new Map<string, AIProviderAdapter>();

  register(adapter: AIProviderAdapter): void {
    this.adapters.set(adapter.id, adapter);
  }

  get(providerId: string): AIProviderAdapter | undefined {
    return this.adapters.get(providerId);
  }

  list(type?: AdapterType): AIProviderAdapter[] {
    const all = Array.from(this.adapters.values());
    if (!type) return all;
    return all.filter((a) => {
      const types = Array.isArray(a.type) ? a.type : [a.type];
      return types.includes(type);
    });
  }

  async isConfigured(providerId: string): Promise<boolean> {
    const adapter = this.adapters.get(providerId);
    if (!adapter) return false;
    return adapter.validate();
  }

  unregister(providerId: string): boolean {
    return this.adapters.delete(providerId);
  }
}
