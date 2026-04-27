/**
 * Commander tool reference — Phase A.
 *
 * `ToolRef` is the structured, adapter-agnostic identifier for a tool
 * invocation. Replaces raw string tool names on the wire (W2 in the
 * parent PRD). Adapters sanitize canonical `domain.action` into API-safe
 * forms (e.g. OpenAI disallows `.` in function names → `domain_action`);
 * the orchestrator converts sanitized names back to `ToolRef` before
 * emission so downstream code never sees adapter quirks.
 *
 * Canonical form:
 *   - `domain` — lowercase (`character`, `canvas`, `commander`)
 *   - `action` — camelCase (`list`, `askUser`, `getSettings`)
 *   - `version` — optional integer for future breaking-change tool revs
 */

export interface ToolRef {
  domain: string;
  action: string;
  version?: number;
}

/**
 * Stable hash-friendly key. Used by dedup, persistence, and telemetry.
 */
export function toolRefKey(ref: ToolRef): string {
  return `${ref.domain}.${ref.action}${ref.version != null ? `@${ref.version}` : ''}`;
}

/**
 * Parse a canonical (`character.list`) or adapter-sanitized
 * (`character_list`) tool name into a `ToolRef`. The canonical form is
 * preferred — the sanitized form is accepted because some legacy code
 * paths still hand us the OpenAI-safe variant.
 *
 * No Title-Case heuristic — this function is deterministic. Missing a
 * separator falls back to `domain='unknown', action=<original>` so the
 * caller sees the raw string and can log a drift warning.
 */
export function parseCanonicalToolName(name: string): ToolRef {
  if (name.includes('.')) {
    const [domain, ...rest] = name.split('.');
    return { domain, action: rest.join('.') };
  }
  if (name.includes('_')) {
    const firstUnderscore = name.indexOf('_');
    return {
      domain: name.slice(0, firstUnderscore),
      action: name.slice(firstUnderscore + 1),
    };
  }
  return { domain: 'unknown', action: name };
}
