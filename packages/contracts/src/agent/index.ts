/**
 * Agent namespace barrel — Phase C-1.
 *
 * Exposes the pure-type aggregator (`ToolCatalog`) and re-exports the
 * underlying `ToolDefinitionType` / `UiEffect` shapes so consumers can import
 * everything tool-registry-related from a single surface.
 *
 * Zero runtime — runtime `createCatalog` / `defineTool` live in
 * `@lucid-fin/contracts-parse/src/agent`.
 */

export type {
  ToolCatalog,
  ToolKey,
  ProcessCategory,
} from './tool-catalog-type.js';

export type { ToolDefinitionType, UiEffect } from '../types/tool-types.js';

export { ENTITY_REFRESH_TOOL_ENTITY } from './entity-refresh-map.js';

// ── Commander wire envelope (v2-only) ──────────────────────────
export {
  COMMANDER_WIRE_VERSION,
  COMMANDER_WIRE_VERSION_LATEST,
} from './wire-version.js';
export type {
  CommanderWireVersion,
  WireEnvelope,
  CommanderStreamEnvelope,
} from './wire-version.js';

// ── Phase A: Commander timeline contracts ──────────────────────
export { toolRefKey, parseCanonicalToolName } from './tool-ref.js';
export type { ToolRef } from './tool-ref.js';
export { COMMANDER_ERROR_CODES } from './error-code.js';
export type { CommanderError, CommanderErrorCode } from './error-code.js';
export { PHASE_NOTE_CODES, assertNever } from './timeline-event.js';
export type {
  TimelineEvent,
  TimelineEventKind,
  TimelineExitDecisionMeta,
  PhaseNoteCode,
  RunStartEvent,
  RunEndEvent,
  UserMessageEvent,
  AssistantTextEvent,
  ThinkingEvent,
  ToolCallEvent,
  ToolResultEvent,
  ToolConfirmPromptEvent,
  UserConfirmationEvent,
  QuestionPromptEvent,
  UserAnswerEvent,
  PhaseNoteEvent,
  CancelledEvent,
} from './timeline-event.js';

// ── Phase G2a-1: ContextItem DU + supporting types ─────────────
export type {
  ContextItemId,
  EntityRef,
  UserMessageItem,
  AssistantTurnItem,
  ToolResultItem,
  EntitySnapshotItem,
  GuideItem,
  SessionSummaryItem,
  ReferenceItem,
  ScratchpadItem,
  ContextItem,
  CompactionKeepRules,
  CompactStrategy,
  CompactionPolicy,
  TokenBudget,
  CompactionResult,
} from './context-graph.js';
