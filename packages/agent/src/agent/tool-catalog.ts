/**
 * Phase C-2 master tool catalog.
 *
 * Single source of truth for agent-tool metadata consumed by the main
 * process, renderer (via pure-type import from `@lucid-fin/contracts`),
 * and the commander pipeline.
 *
 * Every tool is declared here via `defineToolMeta` — metadata only (name,
 * process, category, permission, uiEffects). The legacy `AgentTool`
 * objects in `packages/application/src/agent/tools/*.ts` remain the
 * source of truth for JSON-Schema params + `execute()` bodies until a
 * later phase consolidates the two. This split is deliberate: Phase C
 * rips out string-based branching (`mutatingToolNames`, `startsWith`
 * dispatch, `META_TOOL_PREFIXES`, `INITIAL_PROCESS_CATEGORIES`, 7-branch
 * useCommander dispatch) by replacing every lookup with a catalog
 * derivation, without blocking on a 20-file zod-rewrite.
 *
 * **Invariants enforced by tests:**
 * - Catalog covers every tool registered by `registerAgentTools`.
 * - `mutatingKeys` exactly equals the legacy `mutatingToolNames` set
 *   (C-4 removes the duplicated set).
 * - `byProcess` covers every `ProcessCategory` from
 *   `process-detection.ts` (C-3 removes the 12-branch function).
 *
 * **Adding a new tool:** declare it here AND keep the legacy AgentTool
 * registration. The `registerAgentTools` tests cross-check both lists.
 */

import { createCatalog, defineToolMeta } from '@lucid-fin/contracts-parse';

// ── Script (2) ────────────────────────────────────────────────────
const scriptManage = defineToolMeta({
  name: 'script.manage' as const,
  process: 'script-development',
  category: 'mutation',
});
const scriptImport = defineToolMeta({
  name: 'script.import' as const,
  process: 'script-development',
  category: 'mutation',
});

// ── Entity (unified: character + location + equipment) ────────────
const entityList = defineToolMeta({
  name: 'entity.list' as const,
  process: 'entity-management',
  category: 'query',
});
const entityCreate = defineToolMeta({
  name: 'entity.create' as const,
  process: 'entity-management',
  category: 'mutation',
  uiEffects: [{ kind: 'entity.refresh', entity: 'all' }] as const,
});
const entityUpdate = defineToolMeta({
  name: 'entity.update' as const,
  process: 'entity-management',
  category: 'mutation',
  uiEffects: [{ kind: 'entity.refresh', entity: 'all' }] as const,
});
const entityDelete = defineToolMeta({
  name: 'entity.delete' as const,
  process: 'entity-management',
  category: 'mutation',
  uiEffects: [{ kind: 'entity.refresh', entity: 'all' }] as const,
});
const entityGenerateRefImage = defineToolMeta({
  name: 'entity.generateRefImage' as const,
  process: 'entity-ref-image-generation',
  category: 'mutation',
  uiEffects: [{ kind: 'entity.refresh', entity: 'all' }] as const,
});
const entitySetRefImage = defineToolMeta({
  name: 'entity.setRefImage' as const,
  process: 'entity-ref-image-generation',
  category: 'mutation',
  uiEffects: [{ kind: 'entity.refresh', entity: 'all' }] as const,
});
const entityDeleteRefImage = defineToolMeta({
  name: 'entity.deleteRefImage' as const,
  process: 'entity-ref-image-generation',
  category: 'mutation',
  uiEffects: [{ kind: 'entity.refresh', entity: 'all' }] as const,
});
const entitySetRefImageFromNode = defineToolMeta({
  name: 'entity.setRefImageFromNode' as const,
  process: 'entity-ref-image-generation',
  category: 'mutation',
  uiEffects: [{ kind: 'entity.refresh', entity: 'all' }] as const,
});

// ── Canvas structure ──────────────────────────────────────────────
const canvasCreateNodes = defineToolMeta({
  name: 'canvas.createNodes' as const,
  process: 'canvas-structure',
  category: 'mutation',
});
const canvasDuplicateNodes = defineToolMeta({
  name: 'canvas.duplicateNodes' as const,
  process: 'canvas-structure',
  category: 'query',
});
const canvasManage = defineToolMeta({
  name: 'canvas.manage' as const,
  process: 'canvas-structure',
  category: 'mutation',
});
const canvasDeleteCanvas = defineToolMeta({
  name: 'canvas.deleteCanvas' as const,
  process: 'canvas-structure',
  category: 'mutation',
});
const canvasAddNote = defineToolMeta({
  name: 'canvas.addNote' as const,
  process: 'canvas-structure',
  category: 'mutation',
});
const canvasImportWorkflow = defineToolMeta({
  name: 'canvas.importWorkflow' as const,
  process: 'canvas-structure',
  category: 'mutation',
});
const canvasExportWorkflow = defineToolMeta({
  name: 'canvas.exportWorkflow' as const,
  process: 'canvas-structure',
  category: 'query',
});
const canvasGetInfo = defineToolMeta({
  name: 'canvas.getInfo' as const,
  process: 'canvas-structure',
  category: 'query',
});
const canvasListNodes = defineToolMeta({
  name: 'canvas.listNodes' as const,
  process: 'canvas-structure',
  category: 'query',
});
const canvasListEdges = defineToolMeta({
  name: 'canvas.listEdges' as const,
  process: 'canvas-structure',
  category: 'query',
});
const canvasGetNode = defineToolMeta({
  name: 'canvas.getNode' as const,
  process: 'canvas-structure',
  category: 'query',
});
const canvasDeleteNode = defineToolMeta({
  name: 'canvas.deleteNode' as const,
  process: 'canvas-structure',
  category: 'mutation',
});
const canvasUpdateNote = defineToolMeta({
  name: 'canvas.updateNote' as const,
  process: 'canvas-structure',
  category: 'mutation',
});
const canvasDeleteNote = defineToolMeta({
  name: 'canvas.deleteNote' as const,
  process: 'canvas-structure',
  category: 'mutation',
});

// ── Canvas-scoped settings (1) ────────────────────────────────────
const canvasSetSettings = defineToolMeta({
  name: 'canvas.setSettings' as const,
  process: 'canvas-settings',
  category: 'mutation',
});

// ── Canvas graph-and-layout ───────────────────────────────────────
const canvasConnectNodes = defineToolMeta({
  name: 'canvas.connectNodes' as const,
  process: 'canvas-graph-and-layout',
  category: 'mutation',
});
const canvasLayout = defineToolMeta({
  name: 'canvas.layout' as const,
  process: 'canvas-graph-and-layout',
  category: 'mutation',
});
const canvasManageEdge = defineToolMeta({
  name: 'canvas.manageEdge' as const,
  process: 'canvas-graph-and-layout',
  category: 'mutation',
});
const canvasSetVideoFrames = defineToolMeta({
  name: 'canvas.setVideoFrames' as const,
  process: 'canvas-graph-and-layout',
  category: 'mutation',
});

// ── Canvas node-editing ───────────────────────────────────────────
const canvasUpdateNodes = defineToolMeta({
  name: 'canvas.updateNodes' as const,
  process: 'canvas-node-editing',
  category: 'mutation',
});
const canvasSetNodeLayout = defineToolMeta({
  name: 'canvas.setNodeLayout' as const,
  process: 'canvas-node-editing',
  category: 'mutation',
});
const canvasSetNodeRefs = defineToolMeta({
  name: 'canvas.setNodeRefs' as const,
  process: 'canvas-node-editing',
  category: 'mutation',
});
const canvasSelectVariant = defineToolMeta({
  name: 'canvas.selectVariant' as const,
  process: 'canvas-node-editing',
  category: 'mutation',
});
const canvasUndo = defineToolMeta({
  name: 'canvas.undo' as const,
  process: 'canvas-node-editing',
  category: 'mutation',
});
const canvasRedo = defineToolMeta({
  name: 'canvas.redo' as const,
  process: 'canvas-node-editing',
  category: 'mutation',
});
const canvasPreviewPrompt = defineToolMeta({
  name: 'canvas.previewPrompt' as const,
  process: 'canvas-node-editing',
  category: 'query',
});

// ── Node preset tracks (1) ────────────────────────────────────────
const canvasPresetTracks = defineToolMeta({
  name: 'canvas.presetTracks' as const,
  process: 'node-preset-tracks',
  category: 'mutation',
});

// ── Shot templates (1) ────────────────────────────────────────────
const shotTemplateManage = defineToolMeta({
  name: 'shotTemplate.manage' as const,
  process: 'shot-template-management',
  category: 'mutation',
});

// ── Preset definitions (1) ────────────────────────────────────────
const presetManage = defineToolMeta({
  name: 'preset.manage' as const,
  process: 'preset-definition-management',
  category: 'mutation',
});

// ── Color styles (1) ──────────────────────────────────────────────
const colorStyleManage = defineToolMeta({
  name: 'colorStyle.manage' as const,
  process: 'color-style-management',
  category: 'mutation',
});

// ── Canvas generation (1) ─────────────────────────────────────────
const canvasGeneration = defineToolMeta({
  name: 'canvas.generation' as const,
  process: 'image-node-generation',
  category: 'mutation',
});

// ── Provider management (5) ───────────────────────────────────────
const providerManage = defineToolMeta({
  name: 'provider.manage' as const,
  process: 'provider-management',
  category: 'query',
});
const providerSetKey = defineToolMeta({
  name: 'provider.setKey' as const,
  process: 'provider-management',
  category: 'mutation',
});
const providerUpdate = defineToolMeta({
  name: 'provider.update' as const,
  process: 'provider-management',
  category: 'mutation',
});
const providerAddCustom = defineToolMeta({
  name: 'provider.addCustom' as const,
  process: 'provider-management',
  category: 'mutation',
});
const providerRemoveCustom = defineToolMeta({
  name: 'provider.removeCustom' as const,
  process: 'provider-management',
  category: 'mutation',
});

// ── Node provider/config (2) ──────────────────────────────────────
const canvasConfigureNode = defineToolMeta({
  name: 'canvas.configureNode' as const,
  process: 'node-provider-selection',
  category: 'mutation',
});
const canvasSetMediaParams = defineToolMeta({
  name: 'canvas.setMediaParams' as const,
  process: 'media-config',
  category: 'mutation',
});

// ── Series (6) ────────────────────────────────────────────────────
const seriesGet = defineToolMeta({
  name: 'series.get' as const,
  process: 'series-management',
  category: 'query',
});
const seriesUpdate = defineToolMeta({
  name: 'series.update' as const,
  process: 'series-management',
  category: 'mutation',
});
const seriesListEpisodes = defineToolMeta({
  name: 'series.listEpisodes' as const,
  process: 'series-management',
  category: 'query',
});
const seriesAddEpisode = defineToolMeta({
  name: 'series.addEpisode' as const,
  process: 'series-management',
  category: 'mutation',
});
const seriesRemoveEpisode = defineToolMeta({
  name: 'series.removeEpisode' as const,
  process: 'series-management',
  category: 'mutation',
});
const seriesReorderEpisodes = defineToolMeta({
  name: 'series.reorderEpisodes' as const,
  process: 'series-management',
  category: 'mutation',
});

// ── Prompts (2) ───────────────────────────────────────────────────
const promptGet = defineToolMeta({
  name: 'prompt.get' as const,
  process: 'prompt-template-management',
  category: 'query',
});
const promptSetCustom = defineToolMeta({
  name: 'prompt.setCustom' as const,
  process: 'prompt-template-management',
  category: 'mutation',
});

// ── Assets (2) ────────────────────────────────────────────────────
const assetList = defineToolMeta({
  name: 'asset.list' as const,
  process: 'asset-library-management',
  category: 'query',
});
const assetImport = defineToolMeta({
  name: 'asset.import' as const,
  process: 'asset-library-management',
  category: 'mutation',
});

// ── Jobs (2) ──────────────────────────────────────────────────────
const jobList = defineToolMeta({
  name: 'job.list' as const,
  process: 'job-control',
  category: 'query',
});
const jobControl = defineToolMeta({
  name: 'job.control' as const,
  process: 'job-control',
  category: 'mutation',
});

// ── Snapshot (3) ──────────────────────────────────────────────────
const snapshotCreate = defineToolMeta({
  name: 'snapshot.create' as const,
  process: 'snapshot-and-rollback',
  category: 'mutation',
});
const snapshotList = defineToolMeta({
  name: 'snapshot.list' as const,
  process: 'snapshot-and-rollback',
  category: 'query',
});
const snapshotRestore = defineToolMeta({
  name: 'snapshot.restore' as const,
  process: 'snapshot-and-rollback',
  category: 'mutation',
});

// ── Render (3) ────────────────────────────────────────────────────
const renderStart = defineToolMeta({
  name: 'render.start' as const,
  process: 'render-and-export',
  category: 'mutation',
});
const renderCancel = defineToolMeta({
  name: 'render.cancel' as const,
  process: 'render-and-export',
  category: 'mutation',
});
const renderExportBundle = defineToolMeta({
  name: 'render.exportBundle' as const,
  process: 'render-and-export',
  category: 'mutation',
});

// ── Workflow (1) ──────────────────────────────────────────────────
const workflowManage = defineToolMeta({
  name: 'workflow.manage' as const,
  process: 'workflow-orchestration',
  category: 'mutation',
});

// ── Vision / text analysis (1) ────────────────────────────────────
const textAnalyze = defineToolMeta({
  name: 'text.analyze' as const,
  process: 'vision-analysis',
  category: 'query',
});

// ── Meta (4) ──────────────────────────────────────────────────────
// Meta tools are process='meta' — they don't belong to any domain
// category. `tool.get`, `tool.compact`, `guide.get`, `commander.askUser`.
const toolGet = defineToolMeta({
  name: 'tool.get' as const,
  process: 'meta',
  category: 'meta',
});
const toolCompact = defineToolMeta({
  name: 'tool.compact' as const,
  process: 'meta',
  category: 'meta',
});
const guideGet = defineToolMeta({
  name: 'guide.get' as const,
  process: 'meta',
  category: 'meta',
});
const commanderAskUser = defineToolMeta({
  name: 'commander.askUser' as const,
  process: 'meta',
  category: 'meta',
});
const loggerList = defineToolMeta({
  name: 'logger.list' as const,
  process: 'meta',
  category: 'query',
});

// ── Todo (1) ─────────────────────────────────────────────────────
const todoManage = defineToolMeta({
  name: 'todo.manage' as const,
  process: 'meta',
  category: 'meta',
});

// ── Catalog aggregate ─────────────────────────────────────────────
export const ToolCatalog = createCatalog([
  // script
  scriptManage,
  scriptImport,
  // entity (unified)
  entityList,
  entityCreate,
  entityUpdate,
  entityDelete,
  entityGenerateRefImage,
  entitySetRefImage,
  entityDeleteRefImage,
  entitySetRefImageFromNode,
  // canvas structure
  canvasCreateNodes,
  canvasDuplicateNodes,
  canvasManage,
  canvasDeleteCanvas,
  canvasAddNote,
  canvasImportWorkflow,
  canvasExportWorkflow,
  canvasGetInfo,
  canvasListNodes,
  canvasListEdges,
  canvasGetNode,
  canvasDeleteNode,
  canvasUpdateNote,
  canvasDeleteNote,
  // canvas settings
  canvasSetSettings,
  // canvas graph/layout
  canvasConnectNodes,
  canvasLayout,
  canvasManageEdge,
  canvasSetVideoFrames,
  // canvas node editing
  canvasUpdateNodes,
  canvasSetNodeLayout,
  canvasSetNodeRefs,
  canvasSelectVariant,
  canvasUndo,
  canvasRedo,
  canvasPreviewPrompt,
  // preset tracks
  canvasPresetTracks,
  // shot templates
  shotTemplateManage,
  // presets
  presetManage,
  // color styles
  colorStyleManage,
  // generation
  canvasGeneration,
  // providers
  providerManage,
  providerSetKey,
  providerUpdate,
  providerAddCustom,
  providerRemoveCustom,
  // node provider/config
  canvasConfigureNode,
  canvasSetMediaParams,
  // series
  seriesGet,
  seriesUpdate,
  seriesListEpisodes,
  seriesAddEpisode,
  seriesRemoveEpisode,
  seriesReorderEpisodes,
  // prompts / assets / jobs
  promptGet,
  promptSetCustom,
  assetList,
  assetImport,
  jobList,
  jobControl,
  // snapshot / render / workflow
  snapshotCreate,
  snapshotList,
  snapshotRestore,
  renderStart,
  renderCancel,
  renderExportBundle,
  workflowManage,
  // vision / text / meta
  textAnalyze,
  toolGet,
  toolCompact,
  guideGet,
  commanderAskUser,
  loggerList,
  // todo
  todoManage,
] as const);

export type AppToolCatalog = typeof ToolCatalog;
export type AppToolKey = keyof AppToolCatalog['byKey'];
export type AppProcessCategory = keyof AppToolCatalog['byProcess'];

// ── Catalog-derived helpers ───────────────────────────────────────
// Instead of hand-maintained `Set<string>` copies of mutating tool
// names, consumers (IPC emit handler, commander dispatch) read these
// views directly — the catalog is the single source of truth.

/**
 * Tool names that trigger a domain-entity refresh (character/location/
 * equipment). Derived from tools declaring a `uiEffect` of kind
 * `entity.refresh`.
 */
export const entityMutatingToolNames: ReadonlySet<string> = new Set(
  ToolCatalog.mutatingKeys.filter((name) => {
    const effects = ToolCatalog.uiEffectsByKey[name];
    return effects?.some((effect) => effect.kind === 'entity.refresh');
  }),
);

/**
 * Tool names that trigger a canvas-state re-broadcast (canvas.*,
 * render.*, series.update, preset/shotTemplate/snapshot mutations).
 *
 * Derived by prefix/name match against the catalog's mutating set so
 * non-canvas mutations (provider.*, asset.*, script.*, job.*,
 * workflow.*, etc.) do NOT trigger an unnecessary canvas rebroadcast.
 * The previous "all-mutations-except-entity-refresh" rule swept in
 * unrelated tools and could overwrite renderer-side edits with stale
 * main-side snapshots.
 *
 * Long-term fix: add a `canvas.sync` uiEffect kind to the catalog
 * schema and annotate these tools directly (discriminated-union
 * source-of-truth). Until then, the prefix match mirrors the JSDoc
 * intent exactly.
 */
const CANVAS_SYNC_DOMAIN_PREFIXES = ['canvas.', 'render.', 'preset.', 'shotTemplate.'] as const;
const CANVAS_SYNC_EXACT_NAMES = new Set<string>(['series.update', 'snapshot.restore']);

export const canvasSyncMutatingToolNames: ReadonlySet<string> = new Set(
  ToolCatalog.mutatingKeys.filter((name) => {
    if (entityMutatingToolNames.has(name)) return false;
    if (CANVAS_SYNC_DOMAIN_PREFIXES.some((p) => name.startsWith(p))) return true;
    return CANVAS_SYNC_EXACT_NAMES.has(name);
  }),
);
