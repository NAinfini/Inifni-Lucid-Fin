// apps/desktop-renderer/src/components/canvas/commander/tool-formatting.ts

/** Format camelCase action name to human-readable. e.g. "generateReferenceImage" → "Generate Reference Image" */
export function formatAction(action: string, t?: (key: string) => string): string {
  // Try localized action name first
  if (t) {
    const localized = t(`commander.toolAction.${action}`);
    if (!localized.startsWith('commander.toolAction.')) return localized;
  }
  return action
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, (c) => c.toUpperCase())
    .trim();
}

/** Format full tool name for display. e.g. "character.list" → "角色: 列表" (localized) */
export function formatToolName(name: string, t?: (key: string) => string): string {
  const parts = name.split('.');
  const domain = parts[0] ?? '';
  const action = parts[parts.length - 1] ?? name;
  if (parts.length > 1) {
    const localizedDomain = t?.(`commander.toolDomain.${domain}`);
    const domainLabel = localizedDomain && !localizedDomain.startsWith('commander.toolDomain.')
      ? localizedDomain
      : domain.replace(/^./, (c) => c.toUpperCase());
    return `${domainLabel}: ${formatAction(action, t)}`;
  }
  return formatAction(action, t);
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
