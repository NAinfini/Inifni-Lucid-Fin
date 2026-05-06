/**
 * Generic base registry: a keyed Map with register / get / list / unregister.
 * Subclasses add domain-specific methods (type filtering, isConfigured, etc.).
 */
export class BaseRegistry<T extends { id: string }> {
  protected adapters = new Map<string, T>();

  register(adapter: T): void {
    this.adapters.set(adapter.id, adapter);
  }

  get(providerId: string): T | undefined {
    return this.adapters.get(providerId);
  }

  list(): T[] {
    return Array.from(this.adapters.values());
  }

  unregister(providerId: string): boolean {
    return this.adapters.delete(providerId);
  }
}
