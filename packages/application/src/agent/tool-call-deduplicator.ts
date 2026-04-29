/**
 * Per-turn tool-call deduplicator — Phase G.
 *
 * Kills the 15× identical-tool-call pathology (S8) and the
 * validation-error-retry-same-call pathology (S9) by hashing
 * `(toolRef, argsHash)` per run and short-circuiting repeats with a
 * synthetic `tool_result` + `phase_note(tool_skipped_dedup)`.
 *
 * Scope is per-run (orchestrator-owned). A new run gets a fresh
 * deduplicator so persistent state can't cross sessions.
 *
 * Stale-window: if a prior hit is older than `windowSteps` model steps,
 * it's evicted — the world may have changed, so the model gets to
 * re-call. Default window is 3 steps per PRD.
 */

import { toolRefKey, type ToolRef } from '@lucid-fin/contracts';

export interface DedupRecord {
  /** The `toolCallId` the prior execution emitted. */
  toolCallId: string;
  /** The model-step the prior call ran at. */
  step: number;
  /** Whether the prior call ended with a `tool_result.error`. */
  wasError: boolean;
}

/**
 * Stable JSON stringify — deterministic key order so
 * `{a:1,b:2}` and `{b:2,a:1}` hash to the same bucket. Strips
 * `undefined` values the way LLM adapters drop them.
 */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map((v) => stableStringify(v)).join(',') + ']';
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return (
    '{' + entries.map(([k, v]) => JSON.stringify(k) + ':' + stableStringify(v)).join(',') + '}'
  );
}

/**
 * Short args hash suitable for a Map key. Not cryptographic — we only
 * need collision resistance within a single run's tool-call graph
 * (hundreds of entries max). 16-char DJB2 hash on the stable stringify.
 */
export function argsHash(args: Record<string, unknown>): string {
  const s = stableStringify(args);
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  }
  // Fold into 8 hex chars, then repeat for a cheap 16-char handle.
  const hex = h.toString(16).padStart(8, '0');
  return hex + hex;
}

export class ToolCallDeduplicator {
  private readonly records = new Map<string, DedupRecord>();
  private readonly windowSteps: number;

  constructor(windowSteps = 3) {
    this.windowSteps = windowSteps;
  }

  private key(toolRef: ToolRef, args: Record<string, unknown>): string {
    return toolRefKey(toolRef) + '|' + argsHash(args);
  }

  /**
   * Return the prior record if this `(toolRef, args)` pair was seen
   * within `windowSteps`. Evicts stale records on miss so the Map
   * doesn't grow unbounded.
   */
  check(toolRef: ToolRef, args: Record<string, unknown>, currentStep: number): DedupRecord | null {
    const k = this.key(toolRef, args);
    const prior = this.records.get(k);
    if (!prior) return null;
    if (currentStep - prior.step > this.windowSteps) {
      this.records.delete(k);
      return null;
    }
    return prior;
  }

  register(toolRef: ToolRef, args: Record<string, unknown>, record: DedupRecord): void {
    this.records.set(this.key(toolRef, args), record);
  }

  reset(): void {
    this.records.clear();
  }

  /** Introspection helper — number of live records. */
  size(): number {
    return this.records.size;
  }
}
