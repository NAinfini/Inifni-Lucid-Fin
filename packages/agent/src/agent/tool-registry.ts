import type {
  LLMToolDefinition,
  LLMToolInputSchema,
  LLMToolParameter,
  PublicContextFact,
  PublicToolArtifact,
  PublicToolDetails,
  UiEffect,
} from '@lucid-fin/contracts';
import { PublicContextFactSchema } from '@lucid-fin/contracts-parse';
import type { ResourceMeasurement, ResourceQuote } from './run-resource-budget.js';
import type { SubagentToolHost } from './subagent-tools.js';

export type ToolErrorClass = 'transient' | 'not_found' | 'validation' | 'permission' | 'fatal';
export type ToolCategory = 'query' | 'mutation' | 'meta';
export type ContextReplayMode = 'status_only' | 'authority_reread' | 'public_facts';

export interface ToolResourceContext {
  /** Stable position of the call in the model-selected batch. */
  ordinal: number;
  /** Current orchestrator step, used to make resource operation IDs replay-safe. */
  step: number;
  /** Provider-issued tool-call identifier. */
  toolCallId: string;
}

export type ToolResourceDeclaration =
  | { kind: 'none' }
  | {
      kind: 'metered';
      quote: (
        args: Record<string, unknown>,
        context: ToolResourceContext,
      ) => ResourceQuote | Promise<ResourceQuote>;
      measure?: (
        result: ToolResult,
        args: Record<string, unknown>,
        context: ToolResourceContext,
      ) => ResourceMeasurement | Promise<ResourceMeasurement>;
    };

/** Local SQLite/CAS/UI work has no provider-side resource charge. */
export const NO_TOOL_RESOURCE: ToolResourceDeclaration = { kind: 'none' };

/**
 * Conservative declaration for operations that can reach a provider but do
 * not expose a verifiable token or cost upper bound at the tool boundary.
 */
export const UNBOUNDED_METERED_TOOL_RESOURCE: ToolResourceDeclaration = {
  kind: 'metered',
  quote: () => ({
    tokens: { knowledge: 'unknown' },
    toolCalls: 0,
    costUsd: { knowledge: 'unknown' },
  }),
};

/**
 * Mark a composite tool as metered while keeping its provably local actions
 * available under a provider budget cap.
 */
export function meteredToolResource(
  callsProvider: (args: Record<string, unknown>) => boolean,
): ToolResourceDeclaration {
  return {
    kind: 'metered',
    quote: (args) =>
      callsProvider(args)
        ? {
            tokens: { knowledge: 'unknown' },
            toolCalls: 0,
            costUsd: { knowledge: 'unknown' },
          }
        : {
            tokens: { knowledge: 'known', value: 0, upperBound: true },
            toolCalls: 0,
            costUsd: { knowledge: 'known', value: 0, upperBound: true },
          },
  };
}

export type ToolResult =
  | {
      success: true;
      data?: unknown;
    }
  | {
      success: false;
      error: string;
  /**
   * Typed error class. When a tool knows why it failed (e.g. a `requireString`
   * helper hit a missing arg → validation; a CAS lookup missed → not_found),
   * set this so the executor doesn't have to keyword-sniff `error`. The
   * executor's fallback handles legacy tools that only set `error`.
   */
      errorClass?: ToolErrorClass;
    };

/**
 * Runtime-only JSON value schema. Use it only on an explicitly named dynamic
 * field (for example `metadata`); a tool's complete success payload must still
 * declare its domain shape.
 */
export interface CanonicalJsonSchema {
  type: 'canonical-json';
  description?: string;
  nullable?: boolean;
}

interface ToolRuntimeSchemaBase {
  description?: string;
  nullable?: boolean;
}

/** Recursive runtime schema; unlike provider input schemas it may contain canonical JSON leaves. */
export type ToolRuntimeSchema =
  | (ToolRuntimeSchemaBase & { type: 'string'; enum?: string[] })
  | (ToolRuntimeSchemaBase & { type: 'number'; enum?: number[] })
  | (ToolRuntimeSchemaBase & { type: 'boolean'; enum?: boolean[] })
  | (ToolRuntimeSchemaBase & {
      type: 'object';
      properties: Record<string, ToolRuntimeSchema>;
      required?: string[];
      additionalProperties?: boolean | ToolRuntimeSchema;
    })
  | (ToolRuntimeSchemaBase & { type: 'array'; items: ToolRuntimeSchema })
  | (ToolRuntimeSchemaBase & { const: string | number | boolean | null })
  | (ToolRuntimeSchemaBase & { anyOf: ToolRuntimeSchema[] })
  | CanonicalJsonSchema;

export interface ToolSchemaValidationError {
  field: string;
  expected: string;
  actual: string;
}

export class InvalidToolOutputError extends Error {
  readonly code = 'INVALID_TOOL_OUTPUT' as const;

  constructor(
    readonly toolName: string,
    readonly validationErrors: readonly ToolSchemaValidationError[],
  ) {
    super(
      `Tool '${toolName}' returned an invalid canonical result: ${validationErrors
        .map((error) => `${error.field} expected ${error.expected}, got ${error.actual}`)
        .join('; ')}`,
    );
    this.name = 'InvalidToolOutputError';
  }
}

const TOOL_ERROR_CLASSES: ToolErrorClass[] = [
  'transient',
  'not_found',
  'validation',
  'permission',
  'fatal',
];

/** Complete canonical ToolResult discriminated union for a tool's success data. */
export function toolResultSchema(
  successDataSchema?: ToolRuntimeSchema,
  options?: { dataOptional?: boolean },
): ToolRuntimeSchema {
  const successProperties: Record<string, ToolRuntimeSchema> = {
    success: { const: true },
  };
  if (successDataSchema) successProperties.data = successDataSchema;
  return {
    anyOf: [
      {
        type: 'object',
        properties: successProperties,
        required: [
          'success',
          ...(successDataSchema && !options?.dataOptional ? ['data'] : []),
        ],
      },
      {
        type: 'object',
        properties: {
          success: { const: false },
          error: { type: 'string' },
          errorClass: { type: 'string', enum: TOOL_ERROR_CLASSES },
        },
        required: ['success', 'error'],
      },
    ],
  };
}

export interface ToolExecutionContext {
  /** Stable host identity: step + ordinal + provider call id. */
  operationId?: string;
  executeToolProgram?: (
    program: unknown,
    input: Record<string, unknown>,
  ) => Promise<ToolResult>;
  subagents?: SubagentToolHost;
}

export type PublicContextProjection =
  | { completeness: 'complete'; facts: PublicContextFact[] }
  | { completeness: 'unavailable'; facts: [] };

export interface PublicToolProjection {
  summary?: string;
  details?: PublicToolDetails;
  artifacts?: PublicToolArtifact[];
  context?: PublicContextProjection;
}

export interface ToolDefinition {
  name: string;
  description: string;
  tags?: string[];
  /** If set, tool is only available when Commander is on one of these pages */
  contexts?: string[];
  /** Domain process prompt associated with this tool (`meta` for infrastructure tools). */
  process: string;
  category: ToolCategory;
  /** Canonical cross-run replay policy for this tool's public result. */
  contextReplay: ContextReplayMode;
  /** Required resource declaration; absent metadata must fail closed at registration. */
  resource: ToolResourceDeclaration;
  permission?: {
    require: 'confirm' | 'auto';
    prompt?: (args: Record<string, unknown>) => string;
  };
  uiEffects?: readonly UiEffect[];
  /** Explicit result-to-public projection. Raw tool results fail closed when absent. */
  projectPublicResult?: (
    result: ToolResult,
    mergedArgs: Record<string, unknown>,
  ) => PublicToolProjection;
  /** Explicit public event arguments. Defaults to the merged execution arguments. */
  projectPublicArguments?: (
    mergedArgs: Record<string, unknown>,
  ) => Record<string, unknown>;
  /**
   * Permission tier — required. Drives the needsConfirmation matrix in
   * ToolExecutor (see tool-executor.ts). Every tool MUST declare a tier
   * so a forgotten annotation cannot silently fall into tier-1 (the
   * most permissive bucket), which was the old default.
   *
   * - 1: safe/read (list/get/inspect)
   * - 2: single-entity mutation (rename, reposition)
   * - 3: batch/destructive mutation (delete, generate)
   * - 4: expensive/irreversible project-scope action (render, canvas delete)
   */
  tier: 1 | 2 | 3 | 4;
  /** Max characters for this tool's result before truncation. Overrides RESULT_HARD_LIMIT. */
  maxResultChars?: number;
  /** Canonical strict runtime input schema and sole provider schema source. */
  inputSchema: LLMToolInputSchema;
  /** Canonical strict runtime schema for the complete ToolResult union. */
  outputSchema: ToolRuntimeSchema;
  execute: (
    args: Record<string, unknown>,
    context?: ToolExecutionContext,
  ) => Promise<ToolResult>;
  subagents?: SubagentToolHost;
}

function valueKind(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'number' && !Number.isFinite(value)) return 'non-finite number';
  return typeof value;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype === Object.prototype || prototype === null) return true;
  const constructor = Object.getOwnPropertyDescriptor(prototype, 'constructor')?.value;
  return (
    Object.getPrototypeOf(prototype) === null &&
    typeof constructor === 'function' &&
    Function.prototype.toString.call(constructor) === Function.prototype.toString.call(Object)
  );
}

function schemaExpectation(schema: ToolRuntimeSchema): string {
  if ('anyOf' in schema) return `one of ${schema.anyOf.length} schemas`;
  if ('const' in schema) return `constant ${JSON.stringify(schema.const)}`;
  if (schema.type === 'canonical-json') return 'canonical JSON value';
  if ('enum' in schema && schema.enum) return `one of [${schema.enum.join(', ')}]`;
  return schema.nullable ? `${schema.type} or null` : schema.type;
}

/** Strict recursive validation shared by input and output trust boundaries. */
export function validateToolSchema(
  schema: ToolRuntimeSchema,
  value: unknown,
  field = '$',
): ToolSchemaValidationError[] {
  return validateToolSchemaInternal(schema, value, field, new WeakSet<object>());
}

function validateToolSchemaInternal(
  schema: ToolRuntimeSchema,
  value: unknown,
  field: string,
  ancestors: WeakSet<object>,
): ToolSchemaValidationError[] {
  if (value === null && schema.nullable) return [];
  if ('type' in schema && schema.type === 'canonical-json') {
    return validateCanonicalJson(value, field, ancestors);
  }
  if ('anyOf' in schema) {
    const branchErrors = schema.anyOf.map((candidate) =>
      validateToolSchemaInternal(candidate, value, field, ancestors),
    );
    if (branchErrors.some((errors) => errors.length === 0)) return [];
    const cycle = branchErrors.flat().find((error) => error.actual === 'cyclic reference');
    if (cycle) {
      return [cycle];
    }
    return [{ field, expected: schemaExpectation(schema), actual: valueKind(value) }];
  }
  if ('const' in schema) {
    return Object.is(value, schema.const)
      ? []
      : [{ field, expected: schemaExpectation(schema), actual: valueKind(value) }];
  }

  if (schema.type === 'string') {
    if (typeof value !== 'string') {
      return [{ field, expected: schemaExpectation(schema), actual: valueKind(value) }];
    }
    if (schema.enum && !schema.enum.includes(value)) {
      return [{ field, expected: schemaExpectation(schema), actual: 'string' }];
    }
    return [];
  }
  if (schema.type === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return [{ field, expected: schemaExpectation(schema), actual: valueKind(value) }];
    }
    if (schema.enum && !schema.enum.includes(value)) {
      return [{ field, expected: schemaExpectation(schema), actual: 'number' }];
    }
    return [];
  }
  if (schema.type === 'boolean') {
    if (typeof value !== 'boolean') {
      return [{ field, expected: schemaExpectation(schema), actual: valueKind(value) }];
    }
    if (schema.enum && !schema.enum.includes(value)) {
      return [{ field, expected: schemaExpectation(schema), actual: 'boolean' }];
    }
    return [];
  }
  if (schema.type === 'array') {
    if (!Array.isArray(value)) {
      return [{ field, expected: schemaExpectation(schema), actual: valueKind(value) }];
    }
    if (ancestors.has(value)) {
      return [{ field, expected: 'acyclic array', actual: 'cyclic reference' }];
    }
    ancestors.add(value);
    const errors = value.flatMap((candidate, index) =>
      validateToolSchemaInternal(schema.items, candidate, `${field}[${index}]`, ancestors),
    );
    ancestors.delete(value);
    return errors;
  }
  if (!isPlainObject(value)) {
    return [{ field, expected: schemaExpectation(schema), actual: valueKind(value) }];
  }
  if (ancestors.has(value)) {
    return [{ field, expected: 'acyclic object', actual: 'cyclic reference' }];
  }
  ancestors.add(value);

  const errors: ToolSchemaValidationError[] = [];
  for (const required of schema.required ?? []) {
    if (!(required in value) || value[required] === undefined) {
      errors.push({ field: `${field}.${required}`, expected: 'required', actual: 'missing' });
    }
  }
  for (const [key, candidate] of Object.entries(value)) {
    const propertySchema = schema.properties[key];
    if (propertySchema) {
      errors.push(
        ...validateToolSchemaInternal(propertySchema, candidate, `${field}.${key}`, ancestors),
      );
      continue;
    }
    if (schema.additionalProperties === true) {
      errors.push(...validateCanonicalJson(candidate, `${field}.${key}`, ancestors));
      continue;
    }
    if (typeof schema.additionalProperties === 'object') {
      errors.push(
        ...validateToolSchemaInternal(
          schema.additionalProperties,
          candidate,
          `${field}.${key}`,
          ancestors,
        ),
      );
      continue;
    }
    errors.push({ field: `${field}.${key}`, expected: 'no additional property', actual: valueKind(candidate) });
  }
  ancestors.delete(value);
  return errors;
}

function validateCanonicalJson(
  value: unknown,
  field: string,
  ancestors: WeakSet<object>,
): ToolSchemaValidationError[] {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value))
  ) {
    return [];
  }
  if (typeof value !== 'object') {
    return [{ field, expected: 'canonical JSON value', actual: valueKind(value) }];
  }
  if (ancestors.has(value)) {
    return [{ field, expected: 'acyclic JSON value', actual: 'cyclic reference' }];
  }
  if (!Array.isArray(value) && !isPlainObject(value)) {
    return [{ field, expected: 'canonical JSON value', actual: valueKind(value) }];
  }
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.some((key) => typeof key === 'symbol')) {
    return [{ field, expected: 'string-keyed canonical JSON value', actual: 'symbol key' }];
  }
  if (Array.isArray(value)) {
    const enumerableKeys = Object.keys(value);
    if (
      ownKeys.filter((key) => key !== 'length').length !== value.length ||
      enumerableKeys.length !== value.length ||
      enumerableKeys.some((key, index) => {
        if (key !== String(index)) return true;
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        return !descriptor?.enumerable || !('value' in descriptor);
      })
    ) {
      return [{ field, expected: 'dense canonical JSON array', actual: 'sparse or extended array' }];
    }
  } else if (
    ownKeys.some((key) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return !descriptor?.enumerable || !('value' in descriptor);
    })
  ) {
    return [{ field, expected: 'plain canonical JSON properties', actual: 'accessor or hidden property' }];
  }
  ancestors.add(value);
  const errors = Array.isArray(value)
    ? value.flatMap((candidate, index) =>
        validateCanonicalJson(candidate, `${field}[${index}]`, ancestors),
      )
    : Object.entries(value).flatMap(([key, candidate]) =>
        validateCanonicalJson(candidate, `${field}.${key}`, ancestors),
      );
  ancestors.delete(value);
  return errors;
}

function validateSchemaDefinition(
  schema: ToolRuntimeSchema,
  field: string,
  ancestors = new Set<object>(),
  validated = new WeakSet<object>(),
): string[] {
  if (ancestors.has(schema)) return [`${field} must not contain a schema cycle`];
  if (validated.has(schema)) return [];
  const nextAncestors = new Set(ancestors).add(schema);
  let errors: string[];
  if ('type' in schema && schema.type === 'canonical-json') {
    errors = [];
  } else if ('anyOf' in schema) {
    errors = schema.anyOf.length === 0
      ? [`${field}.anyOf must not be empty`]
      : schema.anyOf.flatMap((candidate, index) =>
          validateSchemaDefinition(candidate, `${field}.anyOf[${index}]`, nextAncestors, validated),
        );
  } else if ('const' in schema) {
    errors = typeof schema.const === 'number' && !Number.isFinite(schema.const)
      ? [`${field}.const must be finite`]
      : [];
  } else if (schema.type === 'array') {
    errors = validateSchemaDefinition(schema.items, `${field}.items`, nextAncestors, validated);
  } else if (schema.type !== 'object') {
    errors = [];
  } else {
    errors = [];
    const propertyNames = new Set(Object.keys(schema.properties));
    for (const required of schema.required ?? []) {
      if (!propertyNames.has(required)) errors.push(`${field}.required references unknown '${required}'`);
    }
    for (const [key, property] of Object.entries(schema.properties)) {
      errors.push(
        ...validateSchemaDefinition(
          property,
          `${field}.properties.${key}`,
          nextAncestors,
          validated,
        ),
      );
    }
    if (typeof schema.additionalProperties === 'object') {
      errors.push(
        ...validateSchemaDefinition(
          schema.additionalProperties,
          `${field}.additionalProperties`,
          nextAncestors,
          validated,
        ),
      );
    }
  }
  validated.add(schema);
  return errors;
}

function isToolResultBranch(schema: ToolRuntimeSchema, success: boolean): boolean {
  if (!('type' in schema) || schema.type !== 'object') return false;
  const required = schema.required ?? [];
  const discriminator = schema.properties.success;
  if (
    !required.includes('success') ||
    !discriminator ||
    !('const' in discriminator) ||
    discriminator.const !== success
  ) {
    return false;
  }
  if (success) return true;
  const error = schema.properties.error;
  return Boolean(
    required.includes('error') && error && 'type' in error && error.type === 'string',
  );
}

function hasCompleteToolResultRoot(schema: ToolRuntimeSchema): boolean {
  return (
    'anyOf' in schema &&
    schema.anyOf.some((branch) => isToolResultBranch(branch, true)) &&
    schema.anyOf.some((branch) => isToolResultBranch(branch, false))
  );
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function providerInputSchema(schema: LLMToolInputSchema): LLMToolInputSchema {
  const clone = structuredClone(schema);
  const visit = (candidate: LLMToolParameter): void => {
    if ('anyOf' in candidate) {
      candidate.anyOf.forEach(visit);
      return;
    }
    if ('const' in candidate) return;
    if (candidate.type === 'array') {
      visit(candidate.items);
      return;
    }
    if (candidate.type === 'object') {
      candidate.additionalProperties ??= false;
      Object.values(candidate.properties).forEach(visit);
      if (typeof candidate.additionalProperties === 'object') {
        visit(candidate.additionalProperties);
      }
    }
  };
  visit(clone);
  return clone;
}

export class ToolRegistry {
  private tools = new Map<string, ToolDefinition>();

  /** Validate canonical runtime metadata even when callers bypass TypeScript. */
  register(tool: ToolDefinition): void {
    if (!tool.name.trim() || !tool.description.trim() || !tool.process.trim()) {
      throw new Error('Tool definitions require non-empty name, description, and process metadata.');
    }
    if (tool.category !== 'query' && tool.category !== 'mutation' && tool.category !== 'meta') {
      throw new Error(`Tool '${tool.name}' is missing a valid category.`);
    }
    if (!tool.inputSchema || tool.inputSchema.type !== 'object') {
      throw new Error(`Tool '${tool.name}' requires a canonical input schema object.`);
    }
    if (tool.inputSchema.additionalProperties === true) {
      throw new Error(`Tool '${tool.name}' cannot use canonical JSON for its complete input contract.`);
    }
    if (!tool.outputSchema) {
      throw new Error(`Tool '${tool.name}' requires a canonical output schema.`);
    }
    if (!hasCompleteToolResultRoot(tool.outputSchema)) {
      throw new Error(
        `Tool '${tool.name}' requires a complete output contract with ToolResult success/failure branches.`,
      );
    }
    const rootOutputSchemas = 'anyOf' in tool.outputSchema
      ? tool.outputSchema.anyOf
      : [tool.outputSchema];
    if (
      rootOutputSchemas.some((schema) =>
        ('type' in schema && schema.type === 'canonical-json') ||
        ('type' in schema && schema.type === 'object' && schema.additionalProperties === true),
      )
    ) {
      throw new Error(`Tool '${tool.name}' cannot use canonical JSON for its complete output contract.`);
    }
    const schemaErrors = [
      ...validateSchemaDefinition(tool.inputSchema, 'inputSchema'),
      ...validateSchemaDefinition(tool.outputSchema, 'outputSchema'),
    ];
    if (schemaErrors.length > 0) {
      throw new Error(`Tool '${tool.name}' has an invalid runtime schema: ${schemaErrors.join('; ')}`);
    }
    if (
      tool.contextReplay !== 'status_only' &&
      tool.contextReplay !== 'authority_reread' &&
      tool.contextReplay !== 'public_facts'
    ) {
      throw new Error(
        `Tool '${tool.name}' is missing a valid context replay mode ` +
          '(must be status_only|authority_reread|public_facts).',
      );
    }
    if (!tool.resource || (tool.resource.kind !== 'none' && tool.resource.kind !== 'metered')) {
      throw new Error(
        `Tool '${tool.name}' requires a resource declaration (kind: none|metered).`,
      );
    }
    if (tool.resource.kind === 'metered' && typeof tool.resource.quote !== 'function') {
      throw new Error(`Tool '${tool.name}' requires a metered resource quote function.`);
    }
    if (tool.resource.kind === 'metered' && tool.resource.measure !== undefined && typeof tool.resource.measure !== 'function') {
      throw new Error(`Tool '${tool.name}' has an invalid metered resource measurement function.`);
    }
    if (tool.contextReplay !== 'status_only' && !tool.projectPublicResult) {
      throw new Error(
        `Tool '${tool.name}' requires an explicit public result projector for ` +
          `${tool.contextReplay} context replay.`,
      );
    }
    if (tool.tier !== 1 && tool.tier !== 2 && tool.tier !== 3 && tool.tier !== 4) {
      throw new Error(
        `Tool '${tool.name}' is missing a valid tier (must be 1|2|3|4). ` +
          'Every tool must declare its permission tier so the confirmation ' +
          'gate never silently falls back to the most permissive bucket.',
      );
    }
    this.tools.set(tool.name, tool);
  }

  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  list(): ToolDefinition[] {
    return Array.from(this.tools.values());
  }

  /** Return tools available for a given context page */
  forContext(context: string): ToolDefinition[] {
    return this.list().filter((tool) => !tool.contexts || tool.contexts.includes(context));
  }

  forProcess(process: string): ToolDefinition[] {
    return this.list().filter((tool) => tool.process === process);
  }

  hasProcess(process: string): boolean {
    return this.list().some((tool) => tool.process === process);
  }

  forCategory(category: ToolCategory): ToolDefinition[] {
    return this.list().filter((tool) => tool.category === category);
  }

  uiEffectsFor(name: string): readonly UiEffect[] {
    return this.tools.get(name)?.uiEffects ?? [];
  }

  projectPublicCall(name: string, args: Record<string, unknown>): PublicToolProjection {
    const tool = this.tools.get(name);
    if (!tool) return {};

    const summary = tool.description.split(/\r?\n/, 1)[0]?.trim().slice(0, 240);
    const details: PublicToolDetails = {};
    const canvasId = args.canvasId;
    if (
      tool.inputSchema.properties.canvasId &&
      typeof canvasId === 'string' &&
      canvasId.trim().length > 0
    ) {
      details.canvasId = canvasId.trim().slice(0, 160);
    }
    for (const [key, property] of Object.entries(tool.inputSchema.properties)) {
      if (!('enum' in property) || !property.enum || !property.enum.length) continue;
      const value = args[key];
      if (typeof value === 'string' && (property.enum as readonly unknown[]).includes(value)) {
        details[key] = value;
      }
    }

    return {
      ...(summary ? { summary } : {}),
      ...(Object.keys(details).length > 0 ? { details } : {}),
    };
  }

  projectPublicResult(
    name: string,
    mergedArgs: Record<string, unknown>,
    result: ToolResult,
  ): PublicToolProjection {
    const tool = this.tools.get(name);
    const call = this.projectPublicCall(name, mergedArgs);
    if (!tool) return call;
    const projector = tool.projectPublicResult;
    if (!projector) {
      return tool.contextReplay === 'status_only'
        ? call
        : { ...call, context: { completeness: 'unavailable', facts: [] } };
    }
    try {
      const projected = projector(result, mergedArgs);
      if (tool.contextReplay === 'status_only') {
        if (projected.context !== undefined) return call;
        return {
          ...call,
          ...(projected.summary ? { summary: projected.summary } : {}),
          ...(projected.details ? { details: projected.details } : {}),
          ...(projected.artifacts ? { artifacts: projected.artifacts } : {}),
        };
      }
      const context = normalizeReplayContext(projected.context, tool.contextReplay);
      if (!context) {
        return { ...call, context: { completeness: 'unavailable', facts: [] } };
      }
      return {
        ...call,
        ...(projected.summary ? { summary: projected.summary } : {}),
        ...(projected.details ? { details: projected.details } : {}),
        ...(projected.artifacts ? { artifacts: projected.artifacts } : {}),
        context,
      };
    } catch {
      return tool.contextReplay === 'status_only'
        ? call
        : { ...call, context: { completeness: 'unavailable', facts: [] } };
    }
  }

  projectPublicArguments(
    name: string,
    mergedArgs: Record<string, unknown>,
  ): Record<string, unknown> {
    const projector = this.tools.get(name)?.projectPublicArguments;
    if (!projector) return mergedArgs;
    try {
      return projector(mergedArgs);
    } catch {
      return {};
    }
  }

  search(filters?: { context?: string; tags?: string[]; query?: string }): ToolDefinition[] {
    const tools = filters?.context ? this.forContext(filters.context) : this.list();
    const requestedTags = (filters?.tags ?? [])
      .map((tag) => tag.trim().toLowerCase())
      .filter((tag) => tag.length > 0);
    const query = filters?.query?.trim().toLowerCase() ?? '';

    return tools.filter((tool) => {
      if (
        requestedTags.length > 0 &&
        !requestedTags.every((tag) => tool.tags?.some((toolTag) => toolTag.toLowerCase() === tag))
      ) {
        return false;
      }

      if (!query) {
        return true;
      }

      const text = `${tool.name}\n${tool.description}`.toLowerCase();
      const words = query.split(/\s+/).filter(Boolean);
      return words.every((word) => text.includes(word));
    });
  }

  async execute(
    name: string,
    args: Record<string, unknown>,
    context?: ToolExecutionContext,
  ): Promise<ToolResult> {
    const tool = this.tools.get(name);
    if (!tool) throw new Error(`Unknown tool: ${name}`);
    const inputErrors = validateToolSchema(tool.inputSchema, args);
    if (inputErrors.length > 0) {
      throw new Error(
        `Tool '${name}' received invalid canonical arguments: ${inputErrors
          .map((error) => `${error.field} expected ${error.expected}, got ${error.actual}`)
          .join('; ')}`,
      );
    }
    const result = context ? await tool.execute(args, context) : await tool.execute(args);
    return this.canonicalizeResult(name, result);
  }

  canonicalizeResult(name: string, result: unknown): ToolResult {
    const tool = this.tools.get(name);
    if (!tool) throw new Error(`Unknown tool: ${name}`);
    const errors = validateToolSchema(tool.outputSchema, result);
    if (errors.length > 0) throw new InvalidToolOutputError(name, errors);
    return deepFreeze(structuredClone(result)) as ToolResult;
  }

  /** Convert registered tools to LLM-compatible tool definitions */
  toLLMTools(context?: string): LLMToolDefinition[] {
    const tools = context ? this.forContext(context) : this.list();
    return tools.map((t) => ({
      name: t.name,
      description: t.description,
      parameters: providerInputSchema(t.inputSchema),
    }));
  }
}

function normalizeReplayContext(
  context: PublicContextProjection | undefined,
  mode: Exclude<ContextReplayMode, 'status_only'>,
): PublicContextProjection | undefined {
  if (!context) return undefined;
  if (context.completeness === 'unavailable') {
    return context.facts.length === 0 ? { completeness: 'unavailable', facts: [] } : undefined;
  }
  if (context.facts.length === 0 || context.facts.length > 32) return undefined;
  const facts: PublicContextFact[] = [];
  for (const fact of context.facts) {
    if (mode === 'authority_reread' ? fact.kind !== 'authority_ref' : fact.kind !== 'value') {
      return undefined;
    }
    const parsed = PublicContextFactSchema.safeParse(fact);
    if (!parsed.success) return undefined;
    facts.push(parsed.data);
  }
  return { completeness: 'complete', facts };
}

export function deriveEntityMutatingToolNames(registry: ToolRegistry): ReadonlySet<string> {
  return new Set(
    registry
      .forCategory('mutation')
      .filter((tool) =>
        tool.uiEffects?.some((effect) => effect.kind === 'entity.refresh'),
      )
      .map((tool) => tool.name),
  );
}

export function deriveCanvasSyncMutatingToolNames(registry: ToolRegistry): ReadonlySet<string> {
  return new Set(
    registry
      .forCategory('mutation')
      .filter((tool) =>
        tool.uiEffects?.some((effect) => effect.kind === 'canvas.refresh'),
      )
      .map((tool) => tool.name),
  );
}
