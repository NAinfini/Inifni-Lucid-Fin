// apps/desktop-renderer/src/components/canvas/commander/tool-formatting.ts

/**
 * Some LLM adapters (OpenAI Responses, Claude) rewrite `.` to `_` in tool
 * names because those APIs disallow dots in function names. Live-progress
 * chips occasionally surface the wire-format name (e.g. `commander_ask_user`)
 * before the orchestrator maps it back. Normalize by splitting on `.` OR
 * the first `_` so display is stable regardless of which form arrives.
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

/** Format camelCase or snake_case action name to human-readable. e.g. "generateReferenceImage" or "generate_reference_image" → "Generate Reference Image" */
export function formatAction(action: string, t?: (key: string) => string): string {
  // Try localized action name first — try both camelCase and snake→camel.
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

/** Format full tool name for display. e.g. "character.list" → "角色: 列表" (localized) */
export function formatToolName(name: string, t?: (key: string) => string): string {
  const { domain, action } = splitToolName(name);
  if (domain) {
    const localizedDomain = t?.(`commander.toolDomain.${domain}`);
    const domainLabel = localizedDomain && !localizedDomain.startsWith('commander.toolDomain.')
      ? localizedDomain
      : domain.replace(/^./, (c) => c.toUpperCase());
    return `${domainLabel}: ${formatAction(action, t)}`;
  }
  return formatAction(action, t);
}

/**
 * Return a production-language display name for well-known tool patterns.
 * Returns `null` when no match is found so callers can fall back to
 * `formatToolName`.
 */
export function formatProductionToolName(
  toolName: string,
  args: Record<string, unknown>,
  result: unknown,
  t: (key: string) => string,
): string | null {
  const { domain, action } = splitToolName(toolName);
  const r = (result && typeof result === 'object' ? result : {}) as Record<string, unknown>;
  const a = args ?? {};

  if (domain === 'canvas' && action === 'batchCreate') {
    const nodes = Array.isArray(r.nodes) ? r.nodes : [];
    const count = nodes.length || (Array.isArray(a.nodes) ? a.nodes.length : 0);
    if (count > 0) return t('commander.productionTool.createdNodes').replace('{count}', String(count));
  }

  if (domain === 'canvas' && action === 'addNode') {
    const nodeType = typeof a.type === 'string' ? a.type : '';
    const title = typeof a.title === 'string' ? a.title : '';
    if (nodeType || title) {
      return t('commander.productionTool.addedNode')
        .replace('{type}', nodeType)
        .replace('{title}', title || nodeType);
    }
  }

  if (domain === 'canvas' && action === 'connectNodes') {
    const nodeIds = Array.isArray(a.nodeIds) ? a.nodeIds : [];
    const count = nodeIds.length || 2;
    return t('commander.productionTool.connectedNodes').replace('{count}', String(count));
  }

  if (domain === 'canvas' && action === 'updateNodes') {
    const nodeIds = Array.isArray(a.nodeIds) ? a.nodeIds : [];
    const count = nodeIds.length || (a.nodeId ? 1 : 0);
    if (count > 0) return t('commander.productionTool.updatedNodes').replace('{count}', String(count));
  }

  if (domain === 'canvas' && action === 'deleteNode') {
    return t('commander.productionTool.deletedNode');
  }

  if (domain === 'canvas' && action === 'generate') {
    const title = typeof a.title === 'string' ? a.title : typeof a.nodeId === 'string' ? a.nodeId.slice(0, 8) : '';
    const done = r.success === true || (r.status === 'done');
    const key = done ? 'commander.productionTool.generated' : 'commander.productionTool.generating';
    return t(key).replace('{title}', title);
  }

  if (domain === 'character' && action === 'create') {
    const name = typeof a.name === 'string' ? a.name : typeof r.name === 'string' ? r.name : '';
    if (name) return t('commander.productionTool.createdCharacter').replace('{name}', name);
  }

  if (domain === 'character' && action === 'update') {
    const name = typeof a.name === 'string' ? a.name : typeof r.name === 'string' ? r.name : '';
    if (name) return t('commander.productionTool.updatedCharacter').replace('{name}', name);
  }

  if (domain === 'snapshot' && action === 'create') {
    return t('commander.productionTool.createdRollback');
  }

  return null;
}

/** Build a human-readable one-line summary of what a tool call will do. */
export function summarizeToolAction(
  toolName: string,
  args: Record<string, unknown>,
  t: (key: string) => string,
): { action: string; detail: string } {
  const parts = toolName.split('.');
  const domain = parts[0] ?? '';
  const method = parts[parts.length - 1] ?? '';

  // Count nodeIds if present (batch operations)
  const nodeIds = Array.isArray(args.nodeIds) ? args.nodeIds : [];
  const nodeCount = nodeIds.length || (args.nodeId ? 1 : 0);

  // Identify the target entity
  const name = typeof args.name === 'string' ? args.name : undefined;
  const id = typeof args.id === 'string' ? args.id.slice(0, 8) : undefined;
  const canvasId = typeof args.canvasId === 'string' ? args.canvasId.slice(0, 8) : undefined;

  // Domain labels
  const domainLabels: Record<string, string> = {
    canvas: t('commander.toolDomain.canvas'),
    character: t('commander.toolDomain.character'),
    equipment: t('commander.toolDomain.equipment'),
    location: t('commander.toolDomain.location'),
    scene: t('commander.toolDomain.scene'),
    preset: t('commander.toolDomain.preset'),
    provider: t('commander.toolDomain.provider'),
    workflow: t('commander.toolDomain.workflow'),
    script: t('commander.toolDomain.script'),
    render: t('commander.toolDomain.render'),
    project: t('commander.toolDomain.project'),
    series: t('commander.toolDomain.series'),
    settings: t('commander.toolDomain.settings'),
    asset: t('commander.toolDomain.asset'),
    vision: t('commander.toolDomain.vision'),
    tool: t('commander.toolDomain.tool'),
    guide: t('commander.toolDomain.guide'),
    commander: t('commander.toolDomain.commander'),
    logger: t('commander.toolDomain.logger'),
    shotTemplate: t('commander.toolDomain.shotTemplate'),
    colorStyle: t('commander.toolDomain.colorStyle'),
    text: t('commander.toolDomain.text'),
    job: t('commander.toolDomain.job'),
    snapshot: t('commander.toolDomain.snapshot'),
  };
  const domainLabel = domainLabels[domain] ?? domain;

  // Action-specific summaries
  const action = formatAction(method, t);

  // Build detail string
  const detailParts: string[] = [];
  if (nodeCount > 1) detailParts.push(`${nodeCount} ${t('commander.toolSummary.nodes')}`);
  else if (nodeCount === 1) detailParts.push(`1 ${t('commander.toolSummary.node')}`);
  if (name) detailParts.push(`"${name}"`);
  else if (id) detailParts.push(`#${id}…`);
  if (canvasId && !name) detailParts.push(`${t('commander.toolSummary.canvas')} #${canvasId}…`);

  // Slot info
  if (typeof args.slot === 'string') detailParts.push(`slot: ${args.slot}`);

  // Provider info
  if (typeof args.providerId === 'string') detailParts.push(args.providerId as string);

  // Prompt snippet — only if non-empty
  if (typeof args.prompt === 'string' && (args.prompt as string).trim().length > 0) {
    const prompt = (args.prompt as string).trim();
    detailParts.push(`"${prompt.length > 40 ? prompt.slice(0, 40) + '…' : prompt}"`);
  }

  return {
    action: `${domainLabel} — ${action}`,
    detail: detailParts.join(' · ') || method,
  };
}
