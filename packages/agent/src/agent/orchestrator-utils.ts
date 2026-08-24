import type { LLMToolCall, LLMFinishReason, LLMToolDefinition } from '@lucid-fin/contracts';
import type { ExitDecision, RunIntent } from './exit-contract/index.js';

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
  resourceUsage?: {
    promptTokens?: number;
    completionTokens?: number;
    reasoningTokens?: number;
  };
  exitDecision?: ExitDecision;
  exitIntent?: RunIntent;
}

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
