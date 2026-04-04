import type { LLMAdapter } from '@lucid-fin/contracts';

export class LLMRegistry {
  private adapters = new Map<string, LLMAdapter>();

  register(adapter: LLMAdapter): void {
    this.adapters.set(adapter.id, adapter);
  }

  get(providerId: string): LLMAdapter | undefined {
    return this.adapters.get(providerId);
  }

  list(): LLMAdapter[] {
    return Array.from(this.adapters.values());
  }

  unregister(providerId: string): boolean {
    return this.adapters.delete(providerId);
  }
}
