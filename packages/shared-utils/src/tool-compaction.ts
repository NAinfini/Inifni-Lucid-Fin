/**
 * Type-safe tool compaction classification.
 *
 * Every tool is explicitly assigned a compaction category so the
 * compaction reducer doesn't rely on fragile string-suffix matching.
 *
 * Categories:
 *   - **list**:     Returns a collection. Multiple calls → merge & deduplicate.
 *   - **get**:      Returns a single entity by ID. Multiple calls for the same ID → keep last.
 *   - **log**:      Returns log/history entries. Paginate to N most recent.
 *   - **mutation**: One-shot write operations. Summarize as a one-liner and discard result.
 *   - **meta**:     Infrastructure tools (tool.get, commander.askUser). Lightweight, no special compaction.
 *   - **query**:    Stateless transforms (text.transform, text.analyze). Treat like get: deep-trim result.
 *
 * When a new tool is added but not listed here, it falls through to the
 * deep-trim step (step 4) which is always safe. A dev-mode console.warn
 * flags unclassified tools so they get added here explicitly.
 */

export type ToolCompactionCategory = 'list' | 'get' | 'log' | 'mutation' | 'meta' | 'query';

const TOOL_CATEGORIES: Record<string, ToolCompactionCategory> = {
  // ── List tools ──────────────────────────────────────────────
  'entity.list': 'list',
  'asset.list': 'list',
  'canvas.listNodes': 'list',
  'canvas.listEdges': 'list',

  // ── Get / read tools ───────────────────────────────────────
  'canvas.getNode': 'get',
  'canvas.getInfo': 'get',
  'prompt.get': 'get',
  'guide.get': 'get',
  'series.get': 'get',
  'series.listEpisodes': 'list',

  // ── Log / history tools ────────────────────────────────────
  'logger.list': 'log',
  'job.list': 'log',
  'snapshot.list': 'log',

  // ── Meta / infrastructure tools ────────────────────────────
  'tool.get': 'meta',
  'tool.compact': 'meta',
  'commander.askUser': 'meta',
  'todo.manage': 'meta',

  // ── Query / stateless transforms ───────────────────────────
  'text.analyze': 'query',
  'canvas.previewPrompt': 'query',

  // ── Manage tools (mixed read/write — compacted as mutation) ─
  'preset.manage': 'mutation',
  'colorStyle.manage': 'mutation',
  'provider.manage': 'mutation',
  'script.manage': 'mutation',
  'workflow.manage': 'mutation',
  'shotTemplate.manage': 'mutation',
  'canvas.presetTracks': 'mutation',

  // ── Mutation tools ─────────────────────────────────────────
  // Canvas mutations
  'canvas.createNodes': 'mutation',
  'canvas.connectNodes': 'mutation',
  'canvas.deleteCanvas': 'mutation',
  'canvas.deleteNode': 'mutation',
  'canvas.deleteRef': 'mutation',
  'canvas.duplicateNodes': 'mutation',
  'canvas.layout': 'mutation',
  'canvas.moveNode': 'mutation',
  'canvas.manage': 'mutation',
  'canvas.setColorTag': 'mutation',
  'canvas.toggleSeedLock': 'mutation',
  'canvas.updateNodeData': 'mutation',
  'canvas.updateNodePresets': 'mutation',
  'canvas.exportWorkflow': 'mutation',
  'canvas.importWorkflow': 'mutation',
  'canvas.generation': 'mutation',
  'canvas.updateNodes': 'mutation',
  'canvas.setNodeLayout': 'mutation',
  'canvas.configureNode': 'mutation',
  'canvas.setMediaParams': 'mutation',
  'canvas.selectVariant': 'mutation',
  'canvas.addNote': 'mutation',
  'canvas.updateNote': 'mutation',
  'canvas.deleteNote': 'mutation',
  'canvas.undo': 'mutation',
  'canvas.redo': 'mutation',
  'canvas.manageEdge': 'mutation',
  'canvas.setNodeRefs': 'mutation',
  'canvas.setVideoFrames': 'mutation',
  'canvas.setSettings': 'mutation',

  // Entity mutations
  'entity.create': 'mutation',
  'entity.update': 'mutation',
  'entity.delete': 'mutation',
  'entity.generateRefImage': 'mutation',
  'entity.setRefImage': 'mutation',
  'entity.deleteRefImage': 'mutation',
  'entity.setRefImageFromNode': 'mutation',

  // Provider admin mutations (excluded from Commander AI)
  'provider.setKey': 'mutation',
  'provider.update': 'mutation',
  'provider.addCustom': 'mutation',
  'provider.removeCustom': 'mutation',

  // Render / generation (excluded from Commander AI)
  'render.start': 'mutation',
  'render.cancel': 'mutation',
  'render.exportBundle': 'mutation',

  // Script (excluded from Commander AI)
  'script.import': 'mutation',

  // Prompt
  'prompt.setCustom': 'mutation',

  // Asset (excluded from Commander AI)
  'asset.import': 'mutation',

  // Series (excluded from Commander AI)
  'series.update': 'mutation',
  'series.addEpisode': 'mutation',
  'series.removeEpisode': 'mutation',
  'series.reorderEpisodes': 'mutation',

  // Snapshot
  'snapshot.create': 'mutation',
  'snapshot.restore': 'mutation',

  // Job (excluded from Commander AI)
  'job.control': 'mutation',
};

/**
 * Look up the compaction category for a tool name.
 * Returns `undefined` for unclassified tools (they fall through to deep-trim).
 */
export function getToolCompactionCategory(toolName: string): ToolCompactionCategory | undefined {
  return TOOL_CATEGORIES[toolName];
}

/** All tool names known to the classification. Useful for completeness checks in tests. */
export function getClassifiedToolNames(): ReadonlySet<string> {
  return new Set(Object.keys(TOOL_CATEGORIES));
}
