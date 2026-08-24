import type { RunBlocker } from '@lucid-fin/contracts';
import {
  NO_TOOL_RESOURCE,
  toolResultSchema,
  type ToolDefinition,
  type ToolErrorClass,
  type ToolResult,
} from './tool-registry.js';
import {
  arraySchema,
  canonicalJsonSchema,
  enumSchema,
  numberSchema,
  objectSchema,
  stringSchema,
} from './tools/tool-runtime-schemas.js';

export const TOOL_PROGRAM_LIMITS = Object.freeze({
  maxBytes: 32 * 1024,
  maxSteps: 32,
  maxCalls: 64,
  maxMapItems: 64,
  maxConcurrency: 4,
  maxPathSegments: 16,
});

export type ToolProgramPath = Array<string | number>;

export type ToolProgramValueRef =
  | { kind: 'literal'; value: unknown }
  | { kind: 'input'; path?: ToolProgramPath }
  | { kind: 'step'; stepId: string; path?: ToolProgramPath }
  | { kind: 'item'; path?: ToolProgramPath };

export interface ToolProgramCall {
  tool: string;
  args: Record<string, ToolProgramValueRef>;
}

export type ToolProgramStep =
  | ({ id: string; op: 'call' } & ToolProgramCall)
  | ({
      id: string;
      op: 'map';
      source: ToolProgramValueRef;
      maxItems: number;
      concurrency: number;
    } & ToolProgramCall)
  | {
      id: string;
      op: 'validate';
      value: ToolProgramValueRef;
      expect: {
        type: 'array' | 'object' | 'string' | 'number' | 'boolean' | 'null';
        required?: string[];
        minItems?: number;
        maxItems?: number;
      };
    }
  | {
      id: string;
      op: 'sort';
      source: ToolProgramValueRef;
      path?: ToolProgramPath;
      direction: 'asc' | 'desc';
    }
  | { id: string; op: 'take'; source: ToolProgramValueRef; count: number }
  | { id: string; op: 'batch'; calls: ToolProgramCall[]; concurrency: number };

export interface ToolProgram {
  version: 1;
  displayName?: string;
  objective?: string;
  steps: ToolProgramStep[];
}

export interface ToolProgramIdentity {
  displayName: string;
  objective: string;
}

export interface ToolProgramChildCall {
  operationId: string;
  tool: string;
  args: Record<string, unknown>;
}

export interface ToolProgramChildResult {
  operationId: string;
  success: boolean;
  value?: unknown;
  error?: string;
}

export interface ToolProgramHost {
  runId: string;
  /** Reaches the parent Run's cooperative pause/cancel boundary before dispatch. */
  beforeDispatch: () => Promise<'ready' | 'cancelled'>;
  /** Dispatches through the parent ToolExecutor; never execute tools directly here. */
  dispatch: (calls: readonly ToolProgramChildCall[]) => Promise<readonly ToolProgramChildResult[]>;
}

export interface ToolProgramAggregate {
  version: 1;
  stepCount: number;
  callCount: number;
  steps: Array<{ id: string; op: ToolProgramStep['op']; status: 'succeeded' }>;
  result: unknown;
}

export class ToolProgramBlockedError extends Error {
  constructor(readonly blocker: RunBlocker) {
    super(`Tool program blocked by ${blocker.kind}`);
    this.name = 'ToolProgramBlockedError';
  }
}

export class ToolProgramCancelledError extends Error {
  constructor() {
    super('Tool program cancelled');
    this.name = 'ToolProgramCancelledError';
  }
}

class ToolProgramValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ToolProgramValidationError';
  }
}

const STEP_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const TOOL_NAME = /^[A-Za-z][A-Za-z0-9]*(?:\.[A-Za-z][A-Za-z0-9]*)+$/;
const BLOCKED_PATH_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertKeys(value: Record<string, unknown>, allowed: readonly string[], label: string): void {
  const allowedSet = new Set(allowed);
  const unknown = Object.keys(value).find((key) => !allowedSet.has(key));
  if (unknown) throw new ToolProgramValidationError(`${label} contains unsupported field '${unknown}'`);
}

function assertInteger(value: unknown, min: number, max: number, label: string): number {
  if (!Number.isInteger(value) || (value as number) < min || (value as number) > max) {
    throw new ToolProgramValidationError(`${label} must be an integer from ${min} to ${max}`);
  }
  return value as number;
}

function optionalText(value: unknown, maxLength: number, label: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !value.trim() || value.trim().length > maxLength) {
    throw new ToolProgramValidationError(`${label} must contain 1 to ${maxLength} characters`);
  }
  return value.trim();
}

function assertJsonValue(value: unknown, label: string, seen = new Set<object>()): void {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value))
  ) {
    return;
  }
  if (typeof value !== 'object') {
    throw new ToolProgramValidationError(`${label} must contain JSON values only`);
  }
  if (seen.has(value)) throw new ToolProgramValidationError(`${label} must not be cyclic`);
  seen.add(value);
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertJsonValue(entry, `${label}[${index}]`, seen));
  } else {
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (BLOCKED_PATH_KEYS.has(key)) {
        throw new ToolProgramValidationError(`${label} contains unsafe key '${key}'`);
      }
      assertJsonValue(entry, `${label}.${key}`, seen);
    }
  }
  seen.delete(value);
}

function parsePath(value: unknown, label: string): ToolProgramPath | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > TOOL_PROGRAM_LIMITS.maxPathSegments) {
    throw new ToolProgramValidationError(
      `${label} must be an array of at most ${TOOL_PROGRAM_LIMITS.maxPathSegments} static segments`,
    );
  }
  return value.map((segment, index) => {
    if (typeof segment === 'number') {
      return assertInteger(segment, 0, Number.MAX_SAFE_INTEGER, `${label}[${index}]`);
    }
    if (
      typeof segment !== 'string' ||
      segment.length === 0 ||
      segment.length > 128 ||
      BLOCKED_PATH_KEYS.has(segment)
    ) {
      throw new ToolProgramValidationError(`${label}[${index}] must be a safe static path segment`);
    }
    return segment;
  });
}

function parseRef(
  value: unknown,
  label: string,
  priorSteps: ReadonlySet<string>,
  allowItem: boolean,
): ToolProgramValueRef {
  if (!isRecord(value) || typeof value.kind !== 'string') {
    throw new ToolProgramValidationError(`${label} must be a typed value reference`);
  }
  switch (value.kind) {
    case 'literal':
      assertKeys(value, ['kind', 'value'], label);
      assertJsonValue(value.value, `${label}.value`);
      return { kind: 'literal', value: value.value };
    case 'input':
      assertKeys(value, ['kind', 'path'], label);
      return { kind: 'input', ...(value.path === undefined ? {} : { path: parsePath(value.path, `${label}.path`) }) };
    case 'step': {
      assertKeys(value, ['kind', 'stepId', 'path'], label);
      if (typeof value.stepId !== 'string' || !priorSteps.has(value.stepId)) {
        throw new ToolProgramValidationError(`${label}.stepId must reference an earlier step`);
      }
      return {
        kind: 'step',
        stepId: value.stepId,
        ...(value.path === undefined ? {} : { path: parsePath(value.path, `${label}.path`) }),
      };
    }
    case 'item':
      assertKeys(value, ['kind', 'path'], label);
      if (!allowItem) throw new ToolProgramValidationError(`${label} cannot use item outside map`);
      return { kind: 'item', ...(value.path === undefined ? {} : { path: parsePath(value.path, `${label}.path`) }) };
    default:
      throw new ToolProgramValidationError(`${label}.kind is unsupported`);
  }
}

function parseArgs(
  value: unknown,
  label: string,
  priorSteps: ReadonlySet<string>,
  allowItem: boolean,
): Record<string, ToolProgramValueRef> {
  if (!isRecord(value)) throw new ToolProgramValidationError(`${label} must be an object`);
  const parsed: Record<string, ToolProgramValueRef> = Object.create(null) as Record<
    string,
    ToolProgramValueRef
  >;
  for (const [key, entry] of Object.entries(value)) {
    if (!key || BLOCKED_PATH_KEYS.has(key)) {
      throw new ToolProgramValidationError(`${label} contains an unsafe argument name`);
    }
    parsed[key] = parseRef(entry, `${label}.${key}`, priorSteps, allowItem);
  }
  return parsed;
}

function parseToolCall(
  value: unknown,
  label: string,
  priorSteps: ReadonlySet<string>,
  allowItem: boolean,
): ToolProgramCall {
  if (!isRecord(value)) throw new ToolProgramValidationError(`${label} must be an object`);
  assertKeys(value, ['tool', 'args'], label);
  if (typeof value.tool !== 'string' || !TOOL_NAME.test(value.tool)) {
    throw new ToolProgramValidationError(`${label}.tool must be a static canonical tool name`);
  }
  if (value.tool === 'tool.program') {
    throw new ToolProgramValidationError('Nested tool.program calls are not allowed');
  }
  return {
    tool: value.tool,
    args: parseArgs(value.args, `${label}.args`, priorSteps, allowItem),
  };
}

function parseStep(
  value: unknown,
  index: number,
  priorSteps: ReadonlySet<string>,
): ToolProgramStep {
  const label = `steps[${index}]`;
  if (!isRecord(value) || typeof value.op !== 'string') {
    throw new ToolProgramValidationError(`${label} must declare an operation`);
  }
  if (typeof value.id !== 'string' || !STEP_ID.test(value.id) || priorSteps.has(value.id)) {
    throw new ToolProgramValidationError(`${label}.id must be unique and use letters, numbers, _ or -`);
  }
  switch (value.op) {
    case 'call': {
      assertKeys(value, ['id', 'op', 'tool', 'args'], label);
      return { id: value.id, op: 'call', ...parseToolCall({ tool: value.tool, args: value.args }, label, priorSteps, false) };
    }
    case 'map': {
      assertKeys(value, ['id', 'op', 'source', 'maxItems', 'concurrency', 'tool', 'args'], label);
      return {
        id: value.id,
        op: 'map',
        source: parseRef(value.source, `${label}.source`, priorSteps, false),
        maxItems: assertInteger(value.maxItems, 1, TOOL_PROGRAM_LIMITS.maxMapItems, `${label}.maxItems`),
        concurrency: assertInteger(value.concurrency, 1, TOOL_PROGRAM_LIMITS.maxConcurrency, `${label}.concurrency`),
        ...parseToolCall({ tool: value.tool, args: value.args }, label, priorSteps, true),
      };
    }
    case 'validate': {
      assertKeys(value, ['id', 'op', 'value', 'expect'], label);
      if (!isRecord(value.expect)) throw new ToolProgramValidationError(`${label}.expect must be an object`);
      assertKeys(value.expect, ['type', 'required', 'minItems', 'maxItems'], `${label}.expect`);
      const allowedTypes = ['array', 'object', 'string', 'number', 'boolean', 'null'] as const;
      if (!allowedTypes.includes(value.expect.type as (typeof allowedTypes)[number])) {
        throw new ToolProgramValidationError(`${label}.expect.type is unsupported`);
      }
      let required: string[] | undefined;
      if (value.expect.required !== undefined) {
        if (
          !Array.isArray(value.expect.required) ||
          value.expect.required.some((key) => typeof key !== 'string' || !key || BLOCKED_PATH_KEYS.has(key))
        ) {
          throw new ToolProgramValidationError(`${label}.expect.required must contain safe property names`);
        }
        required = [...new Set(value.expect.required as string[])];
      }
      const minItems = value.expect.minItems === undefined
        ? undefined
        : assertInteger(value.expect.minItems, 0, TOOL_PROGRAM_LIMITS.maxMapItems, `${label}.expect.minItems`);
      const maxItems = value.expect.maxItems === undefined
        ? undefined
        : assertInteger(value.expect.maxItems, 0, TOOL_PROGRAM_LIMITS.maxMapItems, `${label}.expect.maxItems`);
      if (minItems !== undefined && maxItems !== undefined && minItems > maxItems) {
        throw new ToolProgramValidationError(`${label}.expect.minItems must not exceed maxItems`);
      }
      return {
        id: value.id,
        op: 'validate',
        value: parseRef(value.value, `${label}.value`, priorSteps, false),
        expect: {
          type: value.expect.type as (typeof allowedTypes)[number],
          ...(required ? { required } : {}),
          ...(minItems === undefined ? {} : { minItems }),
          ...(maxItems === undefined ? {} : { maxItems }),
        },
      };
    }
    case 'sort': {
      assertKeys(value, ['id', 'op', 'source', 'path', 'direction'], label);
      if (value.direction !== 'asc' && value.direction !== 'desc') {
        throw new ToolProgramValidationError(`${label}.direction must be asc or desc`);
      }
      return {
        id: value.id,
        op: 'sort',
        source: parseRef(value.source, `${label}.source`, priorSteps, false),
        ...(value.path === undefined ? {} : { path: parsePath(value.path, `${label}.path`) }),
        direction: value.direction,
      };
    }
    case 'take':
      assertKeys(value, ['id', 'op', 'source', 'count'], label);
      return {
        id: value.id,
        op: 'take',
        source: parseRef(value.source, `${label}.source`, priorSteps, false),
        count: assertInteger(value.count, 0, TOOL_PROGRAM_LIMITS.maxMapItems, `${label}.count`),
      };
    case 'batch': {
      assertKeys(value, ['id', 'op', 'calls', 'concurrency'], label);
      if (!Array.isArray(value.calls) || value.calls.length === 0 || value.calls.length > TOOL_PROGRAM_LIMITS.maxCalls) {
        throw new ToolProgramValidationError(`${label}.calls must contain 1 to ${TOOL_PROGRAM_LIMITS.maxCalls} calls`);
      }
      return {
        id: value.id,
        op: 'batch',
        calls: value.calls.map((call, callIndex) => parseToolCall(call, `${label}.calls[${callIndex}]`, priorSteps, false)),
        concurrency: assertInteger(value.concurrency, 1, TOOL_PROGRAM_LIMITS.maxConcurrency, `${label}.concurrency`),
      };
    }
    default:
      throw new ToolProgramValidationError(`${label}.op is unsupported`);
  }
}

export function parseToolProgram(value: unknown): ToolProgram {
  let serialized: string;
  try {
    serialized = JSON.stringify(value);
  } catch {
    throw new ToolProgramValidationError('Tool program must be serializable JSON');
  }
  if (new TextEncoder().encode(serialized).byteLength > TOOL_PROGRAM_LIMITS.maxBytes) {
    throw new ToolProgramValidationError(`Tool program exceeds ${TOOL_PROGRAM_LIMITS.maxBytes} UTF-8 bytes`);
  }
  if (!isRecord(value)) throw new ToolProgramValidationError('Tool program must be an object');
  assertKeys(value, ['version', 'displayName', 'objective', 'steps'], 'program');
  if (value.version !== 1) throw new ToolProgramValidationError('Tool program version must be 1');
  if (!Array.isArray(value.steps) || value.steps.length === 0 || value.steps.length > TOOL_PROGRAM_LIMITS.maxSteps) {
    throw new ToolProgramValidationError(`Tool program must contain 1 to ${TOOL_PROGRAM_LIMITS.maxSteps} steps`);
  }
  const priorSteps = new Set<string>();
  const steps = value.steps.map((step, index) => {
    const parsed = parseStep(step, index, priorSteps);
    priorSteps.add(parsed.id);
    return parsed;
  });
  const displayName = optionalText(value.displayName, 240, 'program.displayName');
  const objective = optionalText(value.objective, 4_000, 'program.objective');
  return {
    version: 1,
    ...(displayName ? { displayName } : {}),
    ...(objective ? { objective } : {}),
    steps,
  };
}

export function describeToolProgram(value: unknown): ToolProgramIdentity {
  try {
    const program = parseToolProgram(value);
    return {
      displayName: program.displayName ?? 'tool.program',
      objective: program.objective ?? 'Execute a bounded typed tool program.',
    };
  } catch {
    return {
      displayName: 'tool.program',
      objective: 'Execute a bounded typed tool program.',
    };
  }
}

function readPath(value: unknown, path: ToolProgramPath | undefined, label: string): unknown {
  let current = value;
  for (const segment of path ?? []) {
    if (Array.isArray(current) && typeof segment === 'number' && segment < current.length) {
      current = current[segment];
      continue;
    }
    if (isRecord(current) && typeof segment === 'string' && Object.hasOwn(current, segment)) {
      current = current[segment];
      continue;
    }
    throw new ToolProgramValidationError(`${label} could not resolve static path`);
  }
  return current;
}

function resolveRef(
  ref: ToolProgramValueRef,
  input: Record<string, unknown>,
  results: ReadonlyMap<string, unknown>,
  item?: unknown,
): unknown {
  switch (ref.kind) {
    case 'literal': return ref.value;
    case 'input': return readPath(input, ref.path, 'input reference');
    case 'step': return readPath(results.get(ref.stepId), ref.path, `step '${ref.stepId}' reference`);
    case 'item': return readPath(item, ref.path, 'item reference');
  }
}

function resolveArgs(
  args: Record<string, ToolProgramValueRef>,
  input: Record<string, unknown>,
  results: ReadonlyMap<string, unknown>,
  item?: unknown,
): Record<string, unknown> {
  const resolved: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const [key, ref] of Object.entries(args)) resolved[key] = resolveRef(ref, input, results, item);
  return resolved;
}

function valueType(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function validateValue(value: unknown, expect: Extract<ToolProgramStep, { op: 'validate' }>['expect']): void {
  if (valueType(value) !== expect.type) {
    throw new ToolProgramValidationError(`validate expected ${expect.type}, got ${valueType(value)}`);
  }
  if (expect.required) {
    if (!isRecord(value)) throw new ToolProgramValidationError('validate.required needs an object');
    const missing = expect.required.find((key) => !Object.hasOwn(value, key));
    if (missing) throw new ToolProgramValidationError(`validate missing required property '${missing}'`);
  }
  if (expect.minItems !== undefined || expect.maxItems !== undefined) {
    if (!Array.isArray(value)) throw new ToolProgramValidationError('validate item bounds need an array');
    if (expect.minItems !== undefined && value.length < expect.minItems) {
      throw new ToolProgramValidationError(`validate expected at least ${expect.minItems} items`);
    }
    if (expect.maxItems !== undefined && value.length > expect.maxItems) {
      throw new ToolProgramValidationError(`validate expected at most ${expect.maxItems} items`);
    }
  }
}

function compareValues(left: unknown, right: unknown): number {
  const scalar = (value: unknown): value is string | number | boolean | null =>
    value === null || ['string', 'number', 'boolean'].includes(typeof value);
  if (!scalar(left) || !scalar(right)) {
    throw new ToolProgramValidationError('sort keys must be string, number, boolean, or null');
  }
  if (left === right) return 0;
  if (left === null) return -1;
  if (right === null) return 1;
  if (typeof left !== typeof right) return typeof left < typeof right ? -1 : 1;
  return left < right ? -1 : 1;
}

function aggregateResult(value: unknown): unknown {
  const serialized = JSON.stringify(value);
  if (serialized.length <= 16 * 1024) return value;
  return Array.isArray(value)
    ? { truncated: true, type: 'array', itemCount: value.length }
    : { truncated: true, type: value === null ? 'null' : typeof value };
}

function failure(error: unknown, stepCount: number, callCount: number): ToolResult {
  const message = error instanceof Error ? error.message : String(error);
  const errorClass: ToolErrorClass = error instanceof ToolProgramValidationError ? 'validation' : 'fatal';
  return {
    success: false,
    error: `${message} (completed ${stepCount} steps and ${callCount} child calls)`,
    errorClass,
  };
}

export async function executeToolProgram(
  rawProgram: unknown,
  input: Record<string, unknown>,
  host: ToolProgramHost,
): Promise<ToolResult> {
  let program: ToolProgram;
  try {
    program = parseToolProgram(rawProgram);
    assertJsonValue(input, 'input');
  } catch (error) {
    return failure(error, 0, 0);
  }

  const results = new Map<string, unknown>();
  const completed: ToolProgramAggregate['steps'] = [];
  let callCount = 0;

  const dispatch = async (
    stepId: string,
    calls: Array<{ tool: string; args: Record<string, unknown>; index: number }>,
    concurrency: number,
  ): Promise<unknown[]> => {
    if (callCount + calls.length > TOOL_PROGRAM_LIMITS.maxCalls) {
      throw new ToolProgramValidationError(`Tool program exceeds ${TOOL_PROGRAM_LIMITS.maxCalls} child calls`);
    }
    const values: unknown[] = [];
    for (let offset = 0; offset < calls.length; offset += concurrency) {
      if ((await host.beforeDispatch()) === 'cancelled') throw new ToolProgramCancelledError();
      const chunk = calls.slice(offset, offset + concurrency).map((call) => ({
        operationId: `program:${host.runId}:${stepId}:${call.index}`,
        tool: call.tool,
        args: call.args,
      }));
      callCount += chunk.length;
      const childResults = await host.dispatch(chunk);
      if (childResults.length !== chunk.length) throw new Error('Tool program host returned an incomplete child result set');
      for (let index = 0; index < childResults.length; index++) {
        const child = childResults[index];
        if (child.operationId !== chunk[index].operationId) throw new Error('Tool program host reordered child results');
        if (!child.success) throw new Error(child.error ?? `Child tool '${chunk[index].tool}' failed`);
        values.push(child.value);
      }
    }
    return values;
  };

  try {
    for (const step of program.steps) {
      let value: unknown;
      switch (step.op) {
        case 'call':
          [value] = await dispatch(step.id, [{ tool: step.tool, args: resolveArgs(step.args, input, results), index: 0 }], 1);
          break;
        case 'map': {
          const source = resolveRef(step.source, input, results);
          if (!Array.isArray(source)) throw new ToolProgramValidationError(`map step '${step.id}' source must be an array`);
          if (source.length > step.maxItems) throw new ToolProgramValidationError(`map step '${step.id}' exceeds maxItems ${step.maxItems}`);
          value = await dispatch(
            step.id,
            source.map((item, index) => ({ tool: step.tool, args: resolveArgs(step.args, input, results, item), index })),
            step.concurrency,
          );
          break;
        }
        case 'validate':
          value = resolveRef(step.value, input, results);
          validateValue(value, step.expect);
          break;
        case 'sort': {
          const source = resolveRef(step.source, input, results);
          if (!Array.isArray(source)) throw new ToolProgramValidationError(`sort step '${step.id}' source must be an array`);
          value = source
            .map((entry, index) => ({ entry, index, key: readPath(entry, step.path, `sort step '${step.id}'`) }))
            .sort((left, right) => {
              const compared = compareValues(left.key, right.key) * (step.direction === 'desc' ? -1 : 1);
              return compared || left.index - right.index;
            })
            .map(({ entry }) => entry);
          break;
        }
        case 'take': {
          const source = resolveRef(step.source, input, results);
          if (!Array.isArray(source)) throw new ToolProgramValidationError(`take step '${step.id}' source must be an array`);
          value = source.slice(0, step.count);
          break;
        }
        case 'batch':
          value = await dispatch(
            step.id,
            step.calls.map((call, index) => ({ tool: call.tool, args: resolveArgs(call.args, input, results), index })),
            step.concurrency,
          );
          break;
      }
      results.set(step.id, value);
      completed.push({ id: step.id, op: step.op, status: 'succeeded' });
    }
  } catch (error) {
    if (error instanceof ToolProgramBlockedError || error instanceof ToolProgramCancelledError) throw error;
    return failure(error, completed.length, callCount);
  }

  const last = program.steps.at(-1)!;
  const aggregate: ToolProgramAggregate = {
    version: 1,
    stepCount: completed.length,
    callCount,
    steps: completed,
    result: aggregateResult(results.get(last.id)),
  };
  return { success: true, data: aggregate };
}

export function createToolProgramTool(): ToolDefinition {
  return {
    name: 'tool.program',
    process: 'meta',
    category: 'mutation',
    contextReplay: 'status_only',
    resource: NO_TOOL_RESOURCE,
    description: [
      'Run a bounded typed tool program through the same permission, TaskList, Canvas/CAS, and resource guards as normal calls.',
      'program is JSON AST {version:1,displayName?,objective?,steps:[...]}; name the work for the user when possible. Step op is call|map|validate|sort|take|batch.',
      'Every argument is a value ref: {kind:"literal",value}, {kind:"input",path?}, {kind:"step",stepId,path?}, or map-only {kind:"item",path?}.',
      'Tool names and paths are static. map requires maxItems<=64 and concurrency<=4; batch concurrency<=4.',
    ].join('\n'),
    tags: ['meta', 'batch'],
    tier: 1,
    maxResultChars: 20_000,
    outputSchema: toolResultSchema(
      objectSchema({
        version: { const: 1 },
        stepCount: numberSchema,
        callCount: numberSchema,
        steps: arraySchema(
          objectSchema({
            id: stringSchema,
            op: enumSchema(['call', 'map', 'validate', 'sort', 'take', 'batch']),
            status: { const: 'succeeded' },
          }),
        ),
        result: canonicalJsonSchema,
      }),
    ),
    inputSchema: {
      type: 'object',
      properties: {
        program: {
          type: 'object',
          description: 'Version 1 typed tool-program JSON AST (max 32 steps and 32 KiB UTF-8).',
          properties: {},
          additionalProperties: true,
        },
        input: {
          type: 'object',
          description: 'Optional JSON input addressed by input value refs.',
          properties: {},
          additionalProperties: true,
        },
      },
      required: ['program'],
    },
    projectPublicArguments: () => ({}),
    projectPublicResult(result) {
      const data = result.success && isRecord(result.data) ? result.data : {};
      return {
        summary: result.success ? 'Typed tool program completed.' : 'Typed tool program failed.',
        details: {
          success: result.success,
          stepCount: typeof data.stepCount === 'number' ? data.stepCount : 0,
          callCount: typeof data.callCount === 'number' ? data.callCount : 0,
        },
      };
    },
    async execute(args, context) {
      if (!context?.executeToolProgram) {
        return { success: false, error: 'Tool program runtime is unavailable', errorClass: 'fatal' };
      }
      const input = isRecord(args.input) ? args.input : {};
      return context.executeToolProgram(args.program, input);
    },
  };
}
