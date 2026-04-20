/**
 * Generate a unique `runId` for a single orchestrator execute() cycle.
 *
 * `runId` is one of the three provenance fields stamped onto every
 * `CommanderStreamEvent` (alongside `step` and `emittedAt`) so the renderer
 * can reliably group events belonging to a single run — across process
 * boundaries, retries, reconnects, and out-of-order IPC delivery.
 *
 * Not cryptographic. Format is `run_<timestamp>_<random>`:
 *   - `timestamp` keeps ids sortable by wall clock for logs / traces.
 *   - `random` eliminates collisions inside the same millisecond.
 */
export function freshRunId(): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 10);
  return `run_${ts}_${rand}`;
}
