/**
 * Phase I — option-list markdown detector.
 *
 * Fixes S10: the model sometimes emits "A) opt1 / B) opt2 / C) opt3" as
 * plain assistant text instead of calling `commander.askUser`. The
 * orchestrator runs this detector on every assistant text block; a
 * positive match triggers `phase_note(force_ask_user)` + a forced
 * `tool_choice` on the next turn.
 *
 * Heuristic: at least two lines of the form
 *   `A.` / `A)` / `A:` / `A -` / `A|`  (case-insensitive, letters A–F)
 *   or `1.` / `1)` / `1:` / `1 -`     (digits 1–9)
 * that appear on their own line (with optional leading whitespace).
 *
 * Deliberately conservative — we'd rather miss a borderline case than
 * force `askUser` on every response that happens to contain a list.
 */

const OPTION_LINE_RE =
  /^\s{0,3}(?:[A-Fa-f]|[1-9])\s*[.):|\-–—]\s+\S/gm;

export function detectOptionListMarkdown(text: string): boolean {
  if (!text || text.length < 10) return false;
  const matches = text.match(OPTION_LINE_RE);
  return !!matches && matches.length >= 2;
}
