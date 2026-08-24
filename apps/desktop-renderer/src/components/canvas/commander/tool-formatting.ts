/**
 * Some LLM adapters rewrite `.` to `_` in tool names because those APIs
 * disallow dots in function names. Normalize either form for display.
 */
function splitToolName(name: string): { domain: string; action: string } {
  if (name.includes('.')) {
    const parts = name.split('.');
    return { domain: parts[0] ?? '', action: parts[parts.length - 1] ?? name };
  }
  const firstUnderscore = name.indexOf('_');
  if (firstUnderscore > 0) {
    return {
      domain: name.slice(0, firstUnderscore),
      action: name.slice(firstUnderscore + 1),
    };
  }
  return { domain: '', action: name };
}

/** Format camelCase or snake_case action names for display. */
export function formatAction(action: string, t?: (key: string) => string): string {
  if (t) {
    const snakeToCamel = action.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
    for (const key of [action, snakeToCamel]) {
      const localized = t(`commander.toolAction.${key}`);
      if (!localized.startsWith('commander.toolAction.')) return localized;
    }
  }
  return action
    .replace(/_/g, ' ')
    .replace(/([A-Z])/g, ' $1')
    .replace(/\s+/g, ' ')
    .replace(/^./, (c) => c.toUpperCase())
    .trim()
    .replace(/\b([a-z])/g, (c) => c.toUpperCase());
}

/** Format a canonical public tool name for display. */
export function formatToolName(name: string, t?: (key: string) => string): string {
  const { domain, action } = splitToolName(name);
  if (domain) {
    const localizedDomain = t?.(`commander.toolDomain.${domain}`);
    const domainLabel =
      localizedDomain && !localizedDomain.startsWith('commander.toolDomain.')
        ? localizedDomain
        : domain.replace(/^./, (c) => c.toUpperCase());
    return `${domainLabel}: ${formatAction(action, t)}`;
  }
  return formatAction(action, t);
}
