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
 *   - **query**:    Stateless transforms (text.transform, vision.describeImage). Treat like get: deep-trim result.
 *
 * When a new tool is added but not listed here, it falls through to the
 * deep-trim step (step 4) which is always safe. A dev-mode console.warn
 * flags unclassified tools so they get added here explicitly.
 */

export type ToolCompactionCategory = 'list' | 'get' | 'log' | 'mutation' | 'meta' | 'query';

const TOOL_CATEGORIES: Record<string, ToolCompactionCategory> = {
  // ── List tools ──────────────────────────────────────────────
  'character.list': 'list',
  'equipment.list': 'list',
  'location.list': 'list',
  'preset.list': 'list',
  'asset.list': 'list',
  'provider.list': 'list',
  'shotTemplate.list': 'list',
  'canvas.listNodes': 'list',
  'canvas.listEdges': 'list',
  'colorStyle.list': 'list',

  // ── Get / read tools ───────────────────────────────────────
  'canvas.getNode': 'get',
  'canvas.getState': 'get',
  'canvas.readNodePresetTracks': 'get',
  'preset.get': 'get',
  'prompt.get': 'get',
  'guide.get': 'get',
  'series.get': 'get',
  'series.listEpisodes': 'list',
  'provider.getActive': 'get',
  'provider.getCapabilities': 'get',
  'script.read': 'get',

  // ── Log / history tools ────────────────────────────────────
  'logger.list': 'log',
  'job.list': 'log',
  'snapshot.list': 'log',

  // ── Meta / infrastructure tools ────────────────────────────
  'tool.get': 'meta',
  'tool.compact': 'meta',
  'commander.askUser': 'meta',

  // ── Query / stateless transforms ───────────────────────────
  'text.transform': 'query',
  'vision.describeImage': 'query',
  'workflow.expandIdea': 'query',
  'canvas.estimateCost': 'query',

  // ── Mutation tools ─────────────────────────────────────────
  // Canvas mutations
  'canvas.addNode': 'mutation',
  'canvas.batchCreate': 'mutation',
  'canvas.connectNodes': 'mutation',
  'canvas.deleteCanvas': 'mutation',
  'canvas.deleteNode': 'mutation',
  'canvas.deleteRef': 'mutation',
  'canvas.duplicateNodes': 'mutation',
  'canvas.layout': 'mutation',
  'canvas.moveNode': 'mutation',
  'canvas.renameCanvas': 'mutation',
  'canvas.setColorTag': 'mutation',
  'canvas.toggleSeedLock': 'mutation',
  'canvas.updateNodeData': 'mutation',
  'canvas.updateNodePresets': 'mutation',
  'canvas.writeNodePresetTracks': 'mutation',
  'canvas.writePresetTracksBatch': 'mutation',
  'canvas.addPresetEntry': 'mutation',
  'canvas.removePresetEntry': 'mutation',
  'canvas.updatePresetEntry': 'mutation',
  'canvas.applyShotTemplate': 'mutation',
  'canvas.exportWorkflow': 'mutation',
  'canvas.importWorkflow': 'mutation',
  'canvas.generate': 'mutation',
  'canvas.cancelGeneration': 'mutation',
  'canvas.updateNodes': 'mutation',
  'canvas.setNodeLayout': 'mutation',
  'canvas.setNodeProvider': 'mutation',
  'canvas.setImageParams': 'mutation',
  'canvas.setVideoParams': 'mutation',
  'canvas.setAudioParams': 'mutation',
  'canvas.selectVariant': 'mutation',
  'canvas.addNote': 'mutation',
  'canvas.updateNote': 'mutation',
  'canvas.deleteNote': 'mutation',
  'canvas.undo': 'mutation',
  'canvas.redo': 'mutation',
  'canvas.deleteEdge': 'mutation',
  'canvas.swapEdgeDirection': 'mutation',
  'canvas.disconnectNode': 'mutation',
  'canvas.updateBackdrop': 'mutation',
  'canvas.setNodeRefs': 'mutation',
  'canvas.setVideoFrames': 'mutation',

  // Entity mutations
  'character.create': 'mutation',
  'character.update': 'mutation',
  'character.delete': 'mutation',
  'character.refImages': 'mutation',
  'equipment.create': 'mutation',
  'equipment.update': 'mutation',
  'equipment.delete': 'mutation',
  'location.create': 'mutation',
  'location.update': 'mutation',
  'location.delete': 'mutation',

  // Preset / template mutations
  'preset.create': 'mutation',
  'preset.update': 'mutation',
  'preset.delete': 'mutation',
  'preset.reset': 'mutation',
  'shotTemplate.create': 'mutation',
  'shotTemplate.update': 'mutation',
  'shotTemplate.delete': 'mutation',

  // Provider mutations
  'provider.setActive': 'mutation',
  'provider.setKey': 'mutation',
  'provider.update': 'mutation',
  'provider.addCustom': 'mutation',
  'provider.removeCustom': 'mutation',

  // Render / generation
  'render.start': 'mutation',
  'render.cancel': 'mutation',
  'render.exportBundle': 'mutation',

  // Script
  'script.import': 'mutation',
  'script.write': 'mutation',

  // Prompt
  'prompt.setCustom': 'mutation',

  // Asset
  'asset.import': 'mutation',

  // Color style
  'colorStyle.save': 'mutation',
  'colorStyle.delete': 'mutation',

  // Series
  'series.update': 'mutation',
  'series.addEpisode': 'mutation',
  'series.removeEpisode': 'mutation',
  'series.reorderEpisodes': 'mutation',

  // Snapshot
  'snapshot.create': 'mutation',
  'snapshot.restore': 'mutation',

  // Workflow / job
  'workflow.control': 'mutation',
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
