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

// ── Script (3) ────────────────────────────────────────────────────
const scriptRead = defineToolMeta({
  name: 'script.read' as const,
  process: 'script-development',
  category: 'query',
});
const scriptWrite = defineToolMeta({
  name: 'script.write' as const,
  process: 'script-development',
  category: 'mutation',
});
const scriptImport = defineToolMeta({
  name: 'script.import' as const,
  process: 'script-development',
  category: 'mutation',
});

// ── Character (4 core + 4 refImage) ───────────────────────────────
const characterList = defineToolMeta({
  name: 'character.list' as const,
  process: 'character-management',
  category: 'query',
});
const characterCreate = defineToolMeta({
  name: 'character.create' as const,
  process: 'character-management',
  category: 'mutation',
  uiEffects: [{ kind: 'entity.refresh', entity: 'character' }] as const,
});
const characterUpdate = defineToolMeta({
  name: 'character.update' as const,
  process: 'character-management',
  category: 'mutation',
  uiEffects: [{ kind: 'entity.refresh', entity: 'character' }] as const,
});
const characterDelete = defineToolMeta({
  name: 'character.delete' as const,
  process: 'character-management',
  category: 'mutation',
  uiEffects: [{ kind: 'entity.refresh', entity: 'character' }] as const,
});
const characterGenerateRefImage = defineToolMeta({
  name: 'character.generateRefImage' as const,
  process: 'character-ref-image-generation',
  category: 'mutation',
  uiEffects: [{ kind: 'entity.refresh', entity: 'character' }] as const,
});
const characterSetRefImage = defineToolMeta({
  name: 'character.setRefImage' as const,
  process: 'character-ref-image-generation',
  category: 'mutation',
  uiEffects: [{ kind: 'entity.refresh', entity: 'character' }] as const,
});
const characterDeleteRefImage = defineToolMeta({
  name: 'character.deleteRefImage' as const,
  process: 'character-ref-image-generation',
  category: 'mutation',
  uiEffects: [{ kind: 'entity.refresh', entity: 'character' }] as const,
});
const characterSetRefImageFromNode = defineToolMeta({
  name: 'character.setRefImageFromNode' as const,
  process: 'character-ref-image-generation',
  category: 'mutation',
  uiEffects: [{ kind: 'entity.refresh', entity: 'character' }] as const,
});

// ── Location (4 core + 4 refImage) ────────────────────────────────
const locationList = defineToolMeta({
  name: 'location.list' as const,
  process: 'location-management',
  category: 'query',
});
const locationCreate = defineToolMeta({
  name: 'location.create' as const,
  process: 'location-management',
  category: 'mutation',
  uiEffects: [{ kind: 'entity.refresh', entity: 'location' }] as const,
});
const locationUpdate = defineToolMeta({
  name: 'location.update' as const,
  process: 'location-management',
  category: 'mutation',
  uiEffects: [{ kind: 'entity.refresh', entity: 'location' }] as const,
});
const locationDelete = defineToolMeta({
  name: 'location.delete' as const,
  process: 'location-management',
  category: 'mutation',
  uiEffects: [{ kind: 'entity.refresh', entity: 'location' }] as const,
});
const locationGenerateRefImage = defineToolMeta({
  name: 'location.generateRefImage' as const,
  process: 'location-ref-image-generation',
  category: 'mutation',
  uiEffects: [{ kind: 'entity.refresh', entity: 'location' }] as const,
});
const locationSetRefImage = defineToolMeta({
  name: 'location.setRefImage' as const,
  process: 'location-ref-image-generation',
  category: 'mutation',
  uiEffects: [{ kind: 'entity.refresh', entity: 'location' }] as const,
});
const locationDeleteRefImage = defineToolMeta({
  name: 'location.deleteRefImage' as const,
  process: 'location-ref-image-generation',
  category: 'mutation',
  uiEffects: [{ kind: 'entity.refresh', entity: 'location' }] as const,
});
const locationSetRefImageFromNode = defineToolMeta({
  name: 'location.setRefImageFromNode' as const,
  process: 'location-ref-image-generation',
  category: 'mutation',
  uiEffects: [{ kind: 'entity.refresh', entity: 'location' }] as const,
});

// ── Equipment (4 core + 4 refImage) ───────────────────────────────
const equipmentList = defineToolMeta({
  name: 'equipment.list' as const,
  process: 'equipment-management',
  category: 'query',
});
const equipmentCreate = defineToolMeta({
  name: 'equipment.create' as const,
  process: 'equipment-management',
  category: 'mutation',
  uiEffects: [{ kind: 'entity.refresh', entity: 'equipment' }] as const,
});
const equipmentUpdate = defineToolMeta({
  name: 'equipment.update' as const,
  process: 'equipment-management',
  category: 'mutation',
  uiEffects: [{ kind: 'entity.refresh', entity: 'equipment' }] as const,
});
const equipmentDelete = defineToolMeta({
  name: 'equipment.delete' as const,
  process: 'equipment-management',
  category: 'mutation',
  uiEffects: [{ kind: 'entity.refresh', entity: 'equipment' }] as const,
});
const equipmentGenerateRefImage = defineToolMeta({
  name: 'equipment.generateRefImage' as const,
  process: 'equipment-ref-image-generation',
  category: 'mutation',
  uiEffects: [{ kind: 'entity.refresh', entity: 'equipment' }] as const,
});
const equipmentSetRefImage = defineToolMeta({
  name: 'equipment.setRefImage' as const,
  process: 'equipment-ref-image-generation',
  category: 'mutation',
  uiEffects: [{ kind: 'entity.refresh', entity: 'equipment' }] as const,
});
const equipmentDeleteRefImage = defineToolMeta({
  name: 'equipment.deleteRefImage' as const,
  process: 'equipment-ref-image-generation',
  category: 'mutation',
  uiEffects: [{ kind: 'entity.refresh', entity: 'equipment' }] as const,
});
const equipmentSetRefImageFromNode = defineToolMeta({
  name: 'equipment.setRefImageFromNode' as const,
  process: 'equipment-ref-image-generation',
  category: 'mutation',
  uiEffects: [{ kind: 'entity.refresh', entity: 'equipment' }] as const,
});

// ── Canvas structure ──────────────────────────────────────────────
const canvasAddNode = defineToolMeta({
  name: 'canvas.addNode' as const,
  process: 'canvas-structure',
  category: 'mutation',
});
const canvasBatchCreate = defineToolMeta({
  name: 'canvas.batchCreate' as const,
  process: 'canvas-structure',
  category: 'mutation',
});
const canvasDuplicateNodes = defineToolMeta({
  name: 'canvas.duplicateNodes' as const,
  process: 'canvas-structure',
  category: 'query',
});
const canvasRenameCanvas = defineToolMeta({
  name: 'canvas.renameCanvas' as const,
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
const canvasUpdateBackdrop = defineToolMeta({
  name: 'canvas.updateBackdrop' as const,
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
const canvasDeleteEdge = defineToolMeta({
  name: 'canvas.deleteEdge' as const,
  process: 'canvas-graph-and-layout',
  category: 'mutation',
});
const canvasSwapEdgeDirection = defineToolMeta({
  name: 'canvas.swapEdgeDirection' as const,
  process: 'canvas-graph-and-layout',
  category: 'mutation',
});
const canvasDisconnectNode = defineToolMeta({
  name: 'canvas.disconnectNode' as const,
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

// ── Canvas reads / queries (non-mutating canvas.*) ────────────────
const canvasGetState = defineToolMeta({
  name: 'canvas.getState' as const,
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
const canvasPreviewPrompt = defineToolMeta({
  name: 'canvas.previewPrompt' as const,
  process: 'canvas-node-editing',
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

// ── Canvas-scoped settings (2) ────────────────────────────────────
const canvasGetSettings = defineToolMeta({
  name: 'canvas.getSettings' as const,
  process: 'canvas-settings',
  category: 'query',
});
const canvasSetSettings = defineToolMeta({
  name: 'canvas.setSettings' as const,
  process: 'canvas-settings',
  category: 'mutation',
});

// ── Node preset tracks (6) ────────────────────────────────────────
const canvasReadNodePresetTracks = defineToolMeta({
  name: 'canvas.readNodePresetTracks' as const,
  process: 'node-preset-tracks',
  category: 'query',
});
const canvasWriteNodePresetTracks = defineToolMeta({
  name: 'canvas.writeNodePresetTracks' as const,
  process: 'node-preset-tracks',
  category: 'mutation',
});
const canvasWritePresetTracksBatch = defineToolMeta({
  name: 'canvas.writePresetTracksBatch' as const,
  process: 'node-preset-tracks',
  category: 'mutation',
});
const canvasAddPresetEntry = defineToolMeta({
  name: 'canvas.addPresetEntry' as const,
  process: 'node-preset-tracks',
  category: 'mutation',
});
const canvasRemovePresetEntry = defineToolMeta({
  name: 'canvas.removePresetEntry' as const,
  process: 'node-preset-tracks',
  category: 'mutation',
});
const canvasUpdatePresetEntry = defineToolMeta({
  name: 'canvas.updatePresetEntry' as const,
  process: 'node-preset-tracks',
  category: 'mutation',
});

// ── Shot templates (5) ────────────────────────────────────────────
const canvasApplyShotTemplate = defineToolMeta({
  name: 'canvas.applyShotTemplate' as const,
  process: 'shot-template-management',
  category: 'mutation',
});
const shotTemplateList = defineToolMeta({
  name: 'shotTemplate.list' as const,
  process: 'shot-template-management',
  category: 'query',
});
const shotTemplateCreate = defineToolMeta({
  name: 'shotTemplate.create' as const,
  process: 'shot-template-management',
  category: 'mutation',
});
const shotTemplateUpdate = defineToolMeta({
  name: 'shotTemplate.update' as const,
  process: 'shot-template-management',
  category: 'mutation',
});
const shotTemplateDelete = defineToolMeta({
  name: 'shotTemplate.delete' as const,
  process: 'shot-template-management',
  category: 'mutation',
});

// ── Preset definitions (6) ────────────────────────────────────────
const presetList = defineToolMeta({
  name: 'preset.list' as const,
  process: 'preset-definition-management',
  category: 'query',
});
const presetGet = defineToolMeta({
  name: 'preset.get' as const,
  process: 'preset-definition-management',
  category: 'query',
});
const presetCreate = defineToolMeta({
  name: 'preset.create' as const,
  process: 'preset-definition-management',
  category: 'mutation',
});
const presetUpdate = defineToolMeta({
  name: 'preset.update' as const,
  process: 'preset-definition-management',
  category: 'mutation',
});
const presetDelete = defineToolMeta({
  name: 'preset.delete' as const,
  process: 'preset-definition-management',
  category: 'mutation',
});
const presetReset = defineToolMeta({
  name: 'preset.reset' as const,
  process: 'preset-definition-management',
  category: 'mutation',
});

// ── Color styles (3) ──────────────────────────────────────────────
const colorStyleList = defineToolMeta({
  name: 'colorStyle.list' as const,
  process: 'color-style-management',
  category: 'query',
});
const colorStyleSave = defineToolMeta({
  name: 'colorStyle.save' as const,
  process: 'color-style-management',
  category: 'mutation',
});
const colorStyleDelete = defineToolMeta({
  name: 'colorStyle.delete' as const,
  process: 'color-style-management',
  category: 'mutation',
});

// ── Canvas generation (2) ─────────────────────────────────────────
const canvasGenerate = defineToolMeta({
  name: 'canvas.generate' as const,
  process: 'image-node-generation', // dynamic via args — see getProcessCategory override
  category: 'mutation',
});
const canvasCancelGeneration = defineToolMeta({
  name: 'canvas.cancelGeneration' as const,
  process: 'image-node-generation',
  category: 'mutation',
});
const canvasEstimateCost = defineToolMeta({
  name: 'canvas.estimateCost' as const,
  process: 'node-provider-selection',
  category: 'query',
});

// ── Provider management (7) ───────────────────────────────────────
const providerList = defineToolMeta({
  name: 'provider.list' as const,
  process: 'provider-management',
  category: 'query',
});
const providerGetActive = defineToolMeta({
  name: 'provider.getActive' as const,
  process: 'provider-management',
  category: 'query',
});
const providerGetCapabilities = defineToolMeta({
  name: 'provider.getCapabilities' as const,
  process: 'provider-management',
  category: 'query',
});
const providerSetActive = defineToolMeta({
  name: 'provider.setActive' as const,
  process: 'provider-management',
  category: 'mutation',
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

// ── Node provider/config (4) ──────────────────────────────────────
const canvasSetNodeProvider = defineToolMeta({
  name: 'canvas.setNodeProvider' as const,
  process: 'node-provider-selection',
  category: 'mutation',
});
const canvasSetImageParams = defineToolMeta({
  name: 'canvas.setImageParams' as const,
  process: 'image-config',
  category: 'mutation',
});
const canvasSetVideoParams = defineToolMeta({
  name: 'canvas.setVideoParams' as const,
  process: 'video-config',
  category: 'mutation',
});
const canvasSetAudioParams = defineToolMeta({
  name: 'canvas.setAudioParams' as const,
  process: 'audio-config',
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

// ── Workflow (2) ──────────────────────────────────────────────────
const workflowControl = defineToolMeta({
  name: 'workflow.control' as const,
  process: 'workflow-orchestration',
  category: 'mutation',
});
const workflowExpandIdea = defineToolMeta({
  name: 'workflow.expandIdea' as const,
  process: 'workflow-orchestration',
  category: 'query',
});

// ── Vision / copywriting (2) ──────────────────────────────────────
const visionDescribeImage = defineToolMeta({
  name: 'vision.describeImage' as const,
  process: 'vision-analysis',
  category: 'query',
});
const textTransform = defineToolMeta({
  name: 'text.transform' as const,
  process: 'vision-analysis', // grouped with other stateless transforms
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

// ── Catalog aggregate ─────────────────────────────────────────────
export const ToolCatalog = createCatalog([
  // script
  scriptRead, scriptWrite, scriptImport,
  // character
  characterList, characterCreate, characterUpdate, characterDelete,
  characterGenerateRefImage, characterSetRefImage, characterDeleteRefImage, characterSetRefImageFromNode,
  // location
  locationList, locationCreate, locationUpdate, locationDelete,
  locationGenerateRefImage, locationSetRefImage, locationDeleteRefImage, locationSetRefImageFromNode,
  // equipment
  equipmentList, equipmentCreate, equipmentUpdate, equipmentDelete,
  equipmentGenerateRefImage, equipmentSetRefImage, equipmentDeleteRefImage, equipmentSetRefImageFromNode,
  // canvas structure
  canvasAddNode, canvasBatchCreate, canvasDuplicateNodes, canvasRenameCanvas, canvasDeleteCanvas,
  canvasAddNote, canvasUpdateBackdrop, canvasImportWorkflow, canvasExportWorkflow,
  canvasGetState, canvasListNodes, canvasListEdges, canvasGetNode,
  canvasDeleteNode, canvasUpdateNote, canvasDeleteNote,
  // canvas settings
  canvasGetSettings, canvasSetSettings,
  // canvas graph/layout
  canvasConnectNodes, canvasLayout, canvasDeleteEdge, canvasSwapEdgeDirection,
  canvasDisconnectNode, canvasSetVideoFrames,
  // canvas node editing
  canvasUpdateNodes, canvasSetNodeLayout, canvasSetNodeRefs, canvasSelectVariant,
  canvasUndo, canvasRedo, canvasPreviewPrompt,
  // preset tracks
  canvasReadNodePresetTracks, canvasWriteNodePresetTracks, canvasWritePresetTracksBatch,
  canvasAddPresetEntry, canvasRemovePresetEntry, canvasUpdatePresetEntry,
  // shot templates
  canvasApplyShotTemplate, shotTemplateList, shotTemplateCreate, shotTemplateUpdate, shotTemplateDelete,
  // presets
  presetList, presetGet, presetCreate, presetUpdate, presetDelete, presetReset,
  // color styles
  colorStyleList, colorStyleSave, colorStyleDelete,
  // generation
  canvasGenerate, canvasCancelGeneration, canvasEstimateCost,
  // providers
  providerList, providerGetActive, providerGetCapabilities, providerSetActive,
  providerSetKey, providerUpdate, providerAddCustom, providerRemoveCustom,
  // node provider/config
  canvasSetNodeProvider, canvasSetImageParams, canvasSetVideoParams, canvasSetAudioParams,
  // series
  seriesGet, seriesUpdate, seriesListEpisodes, seriesAddEpisode, seriesRemoveEpisode, seriesReorderEpisodes,
  // prompts / assets / jobs
  promptGet, promptSetCustom, assetList, assetImport, jobList, jobControl,
  // snapshot / render / workflow
  snapshotCreate, snapshotList, snapshotRestore,
  renderStart, renderCancel, renderExportBundle,
  workflowControl, workflowExpandIdea,
  // vision / text / meta
  visionDescribeImage, textTransform,
  toolGet, toolCompact, guideGet, commanderAskUser, loggerList,
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
