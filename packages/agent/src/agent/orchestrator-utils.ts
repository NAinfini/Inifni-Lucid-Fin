import type {
  LLMToolCall,
  LLMFinishReason,
  LLMToolDefinition,
} from '@lucid-fin/contracts';
import type { ProcessCategory } from './process-detection.js';
import { ToolCatalog } from './tool-catalog.js';
import type { ExitDecision, ProcessPromptSpec, RunIntent } from './exit-contract/index.js';

// ---------------------------------------------------------------------------
// OrchestratorCompletion — shared with the main orchestrator module
// ---------------------------------------------------------------------------

/**
 * Orchestrator-internal completion shape. Adapters no longer return this —
 * they expose an `AsyncIterable<LLMStreamEvent>` that the orchestrator folds
 * into this shape while also forwarding every delta to the renderer. Keeps
 * the rest of the agent loop (tool-call dispatch, dedup, finish detection)
 * unchanged.
 *
 * Phase F — terminal return values from `execute()` carry the ExitDecision
 * so callers can hard-enforce the contract outcome without re-reading the
 * stream. Intermediate loop iterations still use `OrchestratorCompletion`
 * without `exitDecision` (the decision is only meaningful at run end).
 */
export interface OrchestratorCompletion {
  content: string;
  reasoning?: string;
  toolCalls: LLMToolCall[];
  finishReason: LLMFinishReason;
  exitDecision?: ExitDecision;
  exitIntent?: RunIntent;
}

// ---------------------------------------------------------------------------
// ProcessPromptKey — type + constants
// ---------------------------------------------------------------------------

/**
 * Free-standing process-prompt keys that are NOT tool-derived categories but
 * still flow through the same injection/stripping machinery. These come from
 * `processPromptSpecs` — each spec registered below contributes its `key` to
 * the standalone set via `buildStandaloneSpecKeys()`. Phase C ships one
 * standalone spec (`style-plate-lock`); new specs can be added to the spec
 * list without touching this constant.
 */
export type ProcessPromptKey =
  | ProcessCategory
  | 'style-plate-lock'
  | 'entities-before-generation'
  | 'batch-create-guidance'
  | 'prompt-quality-gate'
  | 'story-workflow-phase';

export const STANDALONE_SPEC_KEYS: ReadonlySet<Exclude<ProcessPromptKey, ProcessCategory>> =
  new Set([
    'style-plate-lock',
    'entities-before-generation',
    'batch-create-guidance',
    'prompt-quality-gate',
    'story-workflow-phase',
  ]);

// ---------------------------------------------------------------------------
// Standalone helper functions
// ---------------------------------------------------------------------------

/**
 * Strip context-injected parameters from a tool schema. These parameters are
 * auto-supplied by the tool executor at runtime, so the LLM shouldn't see or
 * fill them — saves tokens and eliminates a class of "required field missing"
 * errors.
 */
export function stripInjectedParamsFromTool(
  tool: LLMToolDefinition,
  params: string[],
): LLMToolDefinition {
  const props = tool.parameters.properties;
  const hasAny = params.some((p) => p in props);
  if (!hasAny) return tool;
  const newProps = { ...props };
  for (const p of params) delete newProps[p];
  const newRequired = tool.parameters.required?.filter((r) => !params.includes(r));
  return {
    ...tool,
    parameters: {
      ...tool.parameters,
      properties: newProps,
      required: newRequired?.length ? newRequired : undefined,
    },
  };
}

/**
 * Un-sanitize tool names and dedup tool call IDs in an LLM response.
 * Mirrors the previous `destructLLMResponse` helper; co-located here so the
 * graph serializer's reverse map feeds it directly.
 */
export function destructResponse(
  raw: OrchestratorCompletion,
  reverseMap: ReadonlyMap<string, string>,
): OrchestratorCompletion {
  if (!raw.toolCalls || raw.toolCalls.length === 0) return raw;
  const seenIds = new Set<string>();
  const deduped: LLMToolCall[] = [];
  for (const tc of raw.toolCalls) {
    if (seenIds.has(tc.id)) continue;
    seenIds.add(tc.id);
    const name = reverseMap.size > 0 ? (reverseMap.get(tc.name) ?? tc.name) : tc.name;
    deduped.push({ ...tc, name });
  }
  return { ...raw, toolCalls: deduped };
}

export function isProcessCategory(value: unknown): value is ProcessCategory {
  if (typeof value !== 'string') return false;
  // Catalog-derived: every distinct `process` declared via defineToolMeta
  // shows up as a key of `byProcess`. The meta bucket ('meta') exists there
  // too, but callers here only pass domain categories, so no extra filter
  // is needed.
  return value in ToolCatalog.byProcess && value !== 'meta';
}

export function isProcessPromptKey(value: unknown): value is ProcessPromptKey {
  if (typeof value !== 'string') return false;
  if (isProcessCategory(value)) return true;
  return (STANDALONE_SPEC_KEYS as ReadonlySet<string>).has(value);
}

/**
 * Display name used in UI banners and stream `thinking_delta` text. Tool-
 * derived categories resolve via `getProcessCategoryName`; standalone spec
 * keys look up the ProcessPromptSpec list injected on the orchestrator.
 */
export function getStandaloneDisplayName(
  key: Exclude<ProcessPromptKey, ProcessCategory>,
  specs: ReadonlyArray<ProcessPromptSpec>,
): string {
  return specs.find((s) => s.key === key)?.displayName ?? key;
}

/** Extract an entity id from mutation args. Keep this field list in sync
 * with `ContextGraph._extractEntityIdFromArgs` so the orchestrator's
 * rebuild-watermark scoping matches the in-memory graph's invalidation. */
export function extractEntityIdFromArgs(args: Record<string, unknown>): string | undefined {
  for (const field of [
    'id',
    'nodeId',
    'characterId',
    'equipmentId',
    'locationId',
    'presetId',
    'templateId',
  ] as const) {
    const value = args[field];
    if (typeof value === 'string' && value) return value;
  }
  return undefined;
}
