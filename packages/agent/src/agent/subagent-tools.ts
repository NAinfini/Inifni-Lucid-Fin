import type {
  ContextAuthority,
  ContextFactRelation,
  PublicContextFact,
  RunResourceBudget,
} from '@lucid-fin/contracts';
import {
  NO_TOOL_RESOURCE,
  toolResultSchema,
  type PublicContextProjection,
  type ToolDefinition,
  type ToolResult,
} from './tool-registry.js';
import type { RunResourceBudgetController } from './run-resource-budget.js';
import {
  arraySchema,
  booleanSchema,
  enumSchema,
  finitePrimitiveSchema,
  nullableSchema,
  numberSchema,
  objectSchema,
  recordSchema,
  stringSchema,
  unionSchema,
} from './tools/tool-runtime-schemas.js';

const runStatusSchema = enumSchema([
  'accepted',
  'running',
  'paused',
  'completed',
  'failed',
  'cancelled',
  'blocked',
  'max_steps',
]);

const contextRefSchema = objectSchema(
  {
    kind: { const: 'authority_ref' },
    authority: enumSchema([
      'commander_run', 'canvas', 'canvas_node', 'asset_entry', 'character', 'equipment',
      'location', 'script', 'preset', 'shot_template', 'snapshot', 'color_style',
      'run_checklist', 'task_list', 'prompt_assembly', 'cas',
    ]),
    relation: enumSchema([
      'run_scope', 'selected_input', 'attachment', 'bound_input', 'retry_source',
      'read', 'created', 'updated', 'deleted', 'produced',
    ]),
    id: stringSchema,
    scopeId: stringSchema,
    revision: numberSchema,
    contentHash: stringSchema,
  },
  ['kind', 'authority', 'relation', 'id'],
);
const childStatusSchema = objectSchema(
  {
    runId: stringSchema,
    status: runStatusSchema,
    displayName: stringSchema,
    objective: stringSchema,
    completed: booleanSchema,
    progress: stringSchema,
  },
  ['runId', 'status', 'completed'],
);
const publicArtifactSchema = unionSchema(
  objectSchema(
    {
      kind: { const: 'checklist' },
      id: stringSchema,
      label: stringSchema,
      items: arraySchema(
        objectSchema({
          id: stringSchema,
          label: stringSchema,
          status: enumSchema(['pending', 'in_progress', 'done']),
        }),
      ),
    },
    ['kind', 'id', 'items'],
  ),
  objectSchema(
    {
      kind: { const: 'asset' },
      id: stringSchema,
      label: stringSchema,
      contentHash: stringSchema,
      mediaType: enumSchema(['image', 'video', 'audio', 'document']),
    },
    ['kind', 'id'],
  ),
  objectSchema(
    {
      kind: { const: 'canvas_node' },
      id: stringSchema,
      label: stringSchema,
      assetHash: stringSchema,
    },
    ['kind', 'id'],
  ),
);
const runBlockerSchema = unionSchema(
  objectSchema({
    kind: { const: 'resource_budget' },
    metric: enumSchema(['tokens', 'tool_calls', 'wall_time', 'cost']),
    reason: enumSchema(['exhausted', 'unavailable']),
  }),
  objectSchema({
    kind: { const: 'safety_limit' },
    limit: enumSchema(['context_window', 'provider_limit', 'recovery_required']),
  }),
);
const childTerminalSchema = objectSchema(
  {
    runId: stringSchema,
    status: runStatusSchema,
    displayName: stringSchema,
    objective: stringSchema,
    summary: stringSchema,
    toolResults: arraySchema(
      objectSchema(
        {
          toolName: stringSchema,
          status: enumSchema(['succeeded', 'failed', 'skipped']),
          summary: stringSchema,
          details: recordSchema(nullableSchema(finitePrimitiveSchema)),
          artifacts: arraySchema(publicArtifactSchema),
        },
        ['toolName', 'status'],
      ),
    ),
    contextRefs: arraySchema(contextRefSchema),
    blocker: runBlockerSchema,
  },
  ['runId', 'status', 'summary', 'toolResults', 'contextRefs'],
);

export type AgentPermissionMode = 'danger' | 'auto' | 'normal' | 'strict';

export interface SubagentSpawnRequest {
  displayName: string;
  objective: string;
  instructions: string;
  authorizedCanvasIds?: string[];
  selectedNodes?: Array<{ canvasId: string; nodeId: string }>;
  contextRefs?: Array<Extract<PublicContextFact, { kind: 'authority_ref' }>>;
  resourceBudget?: RunResourceBudget;
  permissionMode?: AgentPermissionMode;
}

export interface SubagentToolHost {
  spawn(request: SubagentSpawnRequest, operationId: string): Promise<ToolResult>;
  wait(request: { runId: string; timeoutMs: number }): Promise<ToolResult>;
  result(request: { runId: string }): Promise<ToolResult>;
}

export interface SubagentToolHostFactoryRequest {
  parentRunId: string;
  resourceController: RunResourceBudgetController;
  permissionMode: AgentPermissionMode;
}

export type SubagentToolHostFactory = (
  request: SubagentToolHostFactoryRequest,
) => SubagentToolHost;

const AUTHORITIES = new Set<ContextAuthority>([
  'commander_run', 'canvas', 'canvas_node', 'asset_entry', 'character', 'equipment',
  'location', 'script', 'preset', 'shot_template', 'snapshot', 'color_style',
  'run_checklist', 'task_list', 'prompt_assembly', 'cas',
]);
const RELATIONS = new Set<ContextFactRelation>([
  'run_scope', 'selected_input', 'attachment', 'bound_input', 'retry_source',
  'read', 'created', 'updated', 'deleted', 'produced',
]);
const PERMISSION_MODES = new Set<AgentPermissionMode>(['danger', 'auto', 'normal', 'strict']);
const MAX_CANVASES = 16;
const MAX_SELECTED_NODES = 128;
const MAX_CONTEXT_REFS = 128;
const MAX_WAIT_MS = 60_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown, name: string, maxLength: number): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${name} is required`);
  const normalized = value.trim();
  if (normalized.length > maxLength) throw new Error(`${name} exceeds ${maxLength} characters`);
  return normalized;
}

function optionalStringArray(value: unknown, name: string, maxItems: number): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > maxItems) {
    throw new Error(`${name} must contain at most ${maxItems} strings`);
  }
  const normalized = value.map((entry, index) => text(entry, `${name}[${index}]`, 128));
  return [...new Set(normalized)];
}

function selectedNodes(value: unknown): SubagentSpawnRequest['selectedNodes'] {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > MAX_SELECTED_NODES) {
    throw new Error(`selectedNodes must contain at most ${MAX_SELECTED_NODES} entries`);
  }
  return value.map((entry, index) => {
    if (!isRecord(entry)) throw new Error(`selectedNodes[${index}] must be an object`);
    return {
      canvasId: text(entry.canvasId, `selectedNodes[${index}].canvasId`, 128),
      nodeId: text(entry.nodeId, `selectedNodes[${index}].nodeId`, 128),
    };
  });
}

function contextRefs(value: unknown): SubagentSpawnRequest['contextRefs'] {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > MAX_CONTEXT_REFS) {
    throw new Error(`contextRefs must contain at most ${MAX_CONTEXT_REFS} entries`);
  }
  return value.map((entry, index) => {
    if (!isRecord(entry) || entry.kind !== 'authority_ref') {
      throw new Error(`contextRefs[${index}] must be an authority_ref`);
    }
    if (!AUTHORITIES.has(entry.authority as ContextAuthority)) {
      throw new Error(`contextRefs[${index}].authority is invalid`);
    }
    if (!RELATIONS.has(entry.relation as ContextFactRelation)) {
      throw new Error(`contextRefs[${index}].relation is invalid`);
    }
    const ref: Extract<PublicContextFact, { kind: 'authority_ref' }> = {
      kind: 'authority_ref',
      authority: entry.authority as ContextAuthority,
      relation: entry.relation as ContextFactRelation,
      id: text(entry.id, `contextRefs[${index}].id`, 256),
    };
    if (entry.scopeId !== undefined) ref.scopeId = text(entry.scopeId, `contextRefs[${index}].scopeId`, 256);
    if (entry.revision !== undefined) {
      if (!Number.isSafeInteger(entry.revision) || Number(entry.revision) < 0) {
        throw new Error(`contextRefs[${index}].revision must be a non-negative integer`);
      }
      ref.revision = Number(entry.revision);
    }
    if (entry.contentHash !== undefined) {
      ref.contentHash = text(entry.contentHash, `contextRefs[${index}].contentHash`, 256);
    }
    return ref;
  });
}

function resourceBudget(value: unknown): RunResourceBudget | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) throw new Error('resourceBudget must be an object');
  const budget: RunResourceBudget = {};
  for (const key of ['maxTokens', 'maxToolCalls', 'maxWallTimeMs', 'maxCostUsd'] as const) {
    const limit = value[key];
    if (limit === undefined) continue;
    if (typeof limit !== 'number' || !Number.isFinite(limit) || limit < 0) {
      throw new Error(`resourceBudget.${key} must be a non-negative finite number`);
    }
    budget[key] = limit;
  }
  return budget;
}

export function parseSubagentSpawnRequest(args: Record<string, unknown>): SubagentSpawnRequest {
  const permissionMode = args.permissionMode;
  if (permissionMode !== undefined && !PERMISSION_MODES.has(permissionMode as AgentPermissionMode)) {
    throw new Error('permissionMode is invalid');
  }
  return {
    displayName: text(args.displayName, 'displayName', 240),
    objective: text(args.objective, 'objective', 4_000),
    instructions: text(args.instructions, 'instructions', 20_000),
    ...(args.authorizedCanvasIds !== undefined
      ? { authorizedCanvasIds: optionalStringArray(args.authorizedCanvasIds, 'authorizedCanvasIds', MAX_CANVASES)! }
      : {}),
    ...(args.selectedNodes !== undefined ? { selectedNodes: selectedNodes(args.selectedNodes)! } : {}),
    ...(args.contextRefs !== undefined ? { contextRefs: contextRefs(args.contextRefs)! } : {}),
    ...(args.resourceBudget !== undefined ? { resourceBudget: resourceBudget(args.resourceBudget)! } : {}),
    ...(permissionMode !== undefined ? { permissionMode: permissionMode as AgentPermissionMode } : {}),
  };
}

function runId(value: unknown): string {
  return text(value, 'runId', 128);
}

function validationFailure(error: unknown): ToolResult {
  return {
    success: false,
    error: error instanceof Error ? error.message : String(error),
    errorClass: 'validation',
  };
}

function unavailable(): ToolResult {
  return { success: false, error: 'Subagent runtime is unavailable', errorClass: 'fatal' };
}

function dataRecord(result: ToolResult): Record<string, unknown> {
  return result.success && isRecord(result.data) ? result.data : {};
}

function childContext(
  data: Record<string, unknown>,
  relation: ContextFactRelation,
): PublicContextProjection {
  const id = typeof data.runId === 'string' ? data.runId : undefined;
  return id
    ? {
        completeness: 'complete' as const,
        facts: [{ kind: 'authority_ref' as const, authority: 'commander_run' as const, relation, id }],
      }
    : { completeness: 'unavailable', facts: [] };
}

function publicDetails(data: Record<string, unknown>) {
  return {
    ...(typeof data.runId === 'string' ? { runId: data.runId } : {}),
    ...(typeof data.status === 'string' ? { status: data.status } : {}),
    ...(typeof data.displayName === 'string' ? { displayName: data.displayName } : {}),
  };
}

export function createSubagentTools(): ToolDefinition[] {
  const common = {
    process: 'meta',
    category: 'meta' as const,
    contextReplay: 'public_facts' as const,
    resource: NO_TOOL_RESOURCE,
    tier: 1 as const,
    projectPublicArguments: () => ({}),
  };
  return [
    {
      ...common,
      name: 'agent.spawn',
      description: 'Start a named autonomous child Run with instructions and an optional authority subset. The child uses the same guarded tool pipeline and shared resource account.',
      tags: ['meta', 'agent'],
      outputSchema: toolResultSchema(childStatusSchema),
      inputSchema: {
        type: 'object',
        properties: {
          displayName: { type: 'string', description: 'Short user-visible name for the child Run.' },
          objective: { type: 'string', description: 'User-visible outcome the child should achieve.' },
          instructions: { type: 'string', description: 'Task instructions for the child agent.' },
          authorizedCanvasIds: { type: 'array', description: 'Optional subset of the parent Run Canvas IDs.', items: { type: 'string', description: 'Canvas ID.' } },
          selectedNodes: { type: 'array', description: 'Optional subset of the parent selected nodes.', items: { type: 'object', description: 'Selected node.', properties: { canvasId: { type: 'string', description: 'Canvas ID.' }, nodeId: { type: 'string', description: 'Node ID.' } } } },
          contextRefs: {
            type: 'array',
            description: 'Optional subset of public authoritative references already known to the parent.',
            items: contextRefSchema as Extract<typeof contextRefSchema, { type: 'object' }>,
          },
          resourceBudget: {
            type: 'object',
            description: 'Optional resource limits no wider than the parent limits.',
            properties: {
              maxTokens: { type: 'number', description: 'Maximum child tokens.' },
              maxToolCalls: { type: 'number', description: 'Maximum child tool calls.' },
              maxWallTimeMs: { type: 'number', description: 'Maximum child wall time.' },
              maxCostUsd: { type: 'number', description: 'Maximum child provider cost.' },
            },
          },
          permissionMode: { type: 'string', description: 'Optional permission mode no less strict than the parent.', enum: ['danger', 'auto', 'normal', 'strict'] },
        },
        required: ['displayName', 'objective', 'instructions'],
      },
      projectPublicResult(result) {
        const data = dataRecord(result);
        return {
          summary: result.success ? 'Subagent started.' : 'Subagent could not be started.',
          details: publicDetails(data),
          context: childContext(data, 'created'),
        };
      },
      async execute(args, context) {
        let request: SubagentSpawnRequest;
        try { request = parseSubagentSpawnRequest(args); } catch (error) { return validationFailure(error); }
        return context?.subagents && context.operationId
          ? context.subagents.spawn(request, context.operationId)
          : unavailable();
      },
    },
    {
      ...common,
      name: 'agent.wait',
      description: 'Wait for one descendant Run for a bounded interval and return only its public status and progress.',
      tags: ['meta', 'agent'],
      outputSchema: toolResultSchema(childStatusSchema),
      inputSchema: {
        type: 'object',
        properties: {
          runId: { type: 'string', description: 'Descendant Run ID returned by agent.spawn.' },
          timeoutMs: { type: 'number', description: `Wait duration from 0 to ${MAX_WAIT_MS} milliseconds.` },
        },
        required: ['runId'],
      },
      projectPublicResult(result) {
        const data = dataRecord(result);
        return {
          summary: result.success ? 'Subagent status checked.' : 'Subagent wait failed.',
          details: publicDetails(data),
          context: childContext(data, 'read'),
        };
      },
      async execute(args, context) {
        let request: { runId: string; timeoutMs: number };
        try {
          const timeoutMs = args.timeoutMs === undefined ? 30_000 : args.timeoutMs;
          if (!Number.isSafeInteger(timeoutMs) || Number(timeoutMs) < 0 || Number(timeoutMs) > MAX_WAIT_MS) {
            throw new Error(`timeoutMs must be an integer from 0 to ${MAX_WAIT_MS}`);
          }
          request = { runId: runId(args.runId), timeoutMs: Number(timeoutMs) };
        } catch (error) { return validationFailure(error); }
        return context?.subagents ? context.subagents.wait(request) : unavailable();
      },
    },
    {
      ...common,
      name: 'agent.result',
      description: 'Read the bounded public terminal summary, normalized tool results, artifacts, and authority references of one descendant Run.',
      tags: ['meta', 'agent'],
      outputSchema: toolResultSchema(childTerminalSchema),
      inputSchema: {
        type: 'object',
        properties: { runId: { type: 'string', description: 'Terminal descendant Run ID.' } },
        required: ['runId'],
      },
      projectPublicResult(result) {
        const data = dataRecord(result);
        const facts = Array.isArray(data.contextRefs)
          ? data.contextRefs.filter((fact): fact is PublicContextFact => isRecord(fact) && fact.kind === 'authority_ref').slice(0, MAX_CONTEXT_REFS)
          : [];
        const child = childContext(data, 'read');
        return {
          summary: typeof data.summary === 'string'
            ? data.summary.slice(0, 2_000)
            : result.success ? 'Subagent result is available.' : 'Subagent result is unavailable.',
          details: publicDetails(data),
          context: child.completeness === 'complete'
            ? { completeness: 'complete', facts: [...child.facts, ...facts] }
            : child,
        };
      },
      async execute(args, context) {
        let request: { runId: string };
        try { request = { runId: runId(args.runId) }; } catch (error) { return validationFailure(error); }
        return context?.subagents ? context.subagents.result(request) : unavailable();
      },
    },
  ];
}
