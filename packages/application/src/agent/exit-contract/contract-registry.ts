import type { CompletionContract, RunIntent } from './types.js';

/**
 * Runtime registry of `CompletionContract`s keyed by stable id.
 *
 * - `register(contract)` is the public registration API. Idempotent on
 *   contract identity: re-registering the same contract object under the
 *   same id is a no-op (safe on repeated module imports / HMR). A
 *   DIFFERENT contract under an existing id is a loud error — contract
 *   ids identify decisions in logs, reports, and study metrics, so silent
 *   override would hide drift.
 * - `unregister(id)` removes a contract. Safe to call on unknown ids.
 *   Test-only helper; production contracts are registered once at
 *   module-load time and never removed.
 * - `select(intent)` resolves the contract for an intent at run start. For
 *   `informational` / `browse` we return the `info-answer` fallback so the
 *   engine's info-exemption short-circuit still fires; for
 *   `execution` / `mixed` we look up by `workflow` id (e.g. 'story-to-video'),
 *   falling back to `info-answer` if the classifier could not name one.
 * - Phase F exposes `register` / `unregister` as the stable plugin surface
 *   via `packages/application/src/index.ts`.
 *
 * The registry is a module-level singleton. Each contract file imports it
 * and self-registers on first load; the registry barrel
 * (`contracts/index.ts`) owns the import order so registration happens
 * exactly once.
 */
class ContractRegistry {
  private readonly byId = new Map<string, CompletionContract>();
  private fallbackId: string | null = null;

  register(contract: CompletionContract): void {
    const existing = this.byId.get(contract.id);
    if (existing !== undefined) {
      // Idempotent on identity — re-registering the exact same object is a
      // no-op. This makes the plugin surface safe against double-imports
      // (module graph cycles, HMR, test harnesses that re-import the
      // package) without papering over real conflicts.
      if (existing === contract) return;
      throw new Error(`contract-registry: duplicate id "${contract.id}"`);
    }
    this.byId.set(contract.id, contract);
  }

  /**
   * Remove a contract by id. Safe on unknown ids. If the removed contract
   * was the fallback, the fallback pointer is cleared too — the next
   * `select()` call will throw until a new fallback is set.
   */
  unregister(id: string): void {
    this.byId.delete(id);
    if (this.fallbackId === id) this.fallbackId = null;
  }

  /**
   * Designate the contract used when no other match applies. Called once
   * by `contracts/info-answer.ts`. Re-setting is an error (same rationale
   * as duplicate-id detection).
   */
  setFallback(contractId: string): void {
    if (!this.byId.has(contractId)) {
      throw new Error(`contract-registry: fallback "${contractId}" not registered`);
    }
    if (this.fallbackId !== null && this.fallbackId !== contractId) {
      throw new Error(`contract-registry: fallback already set to "${this.fallbackId}"`);
    }
    this.fallbackId = contractId;
  }

  get(id: string): CompletionContract | undefined {
    return this.byId.get(id);
  }

  ids(): string[] {
    return Array.from(this.byId.keys());
  }

  select(intent: RunIntent): CompletionContract {
    const fallback = this.requireFallback();

    switch (intent.kind) {
      case 'informational':
      case 'browse':
        return fallback;
      case 'execution':
      case 'mixed': {
        if (intent.workflow) {
          const hit = this.byId.get(intent.workflow);
          if (hit) return hit;
        }
        return fallback;
      }
    }
  }

  /** Test-only reset. Never called from production code. */
  _resetForTests(): void {
    this.byId.clear();
    this.fallbackId = null;
  }

  private requireFallback(): CompletionContract {
    if (!this.fallbackId) {
      throw new Error(
        'contract-registry: no fallback contract registered. ' +
          'Make sure contracts/info-answer.ts is imported before select() is called.',
      );
    }
    const fallback = this.byId.get(this.fallbackId);
    if (!fallback) {
      throw new Error(`contract-registry: fallback id "${this.fallbackId}" vanished from map`);
    }
    return fallback;
  }
}

export const contractRegistry = new ContractRegistry();
