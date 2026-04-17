import type { ZodType } from 'zod';
import type { ToolDefinitionType, UiEffect } from '@lucid-fin/contracts';

/**
 * Runtime tool definition with attached zod schemas for params/result.
 * Phase C's `createCatalog` collects these into a flat lookup table.
 */
export interface ToolDef<
  Name extends string = string,
  Params = unknown,
  Result = unknown,
> extends ToolDefinitionType<Name, Params, Result> {
  readonly schemas: {
    readonly params: ZodType<Params>;
    readonly result: ZodType<Result>;
  };
  readonly run: (
    ctx: ToolRunContext,
    params: Params,
  ) => AsyncIterable<ToolEvent<Result>>;
}

export interface ToolRunContext {
  signal: AbortSignal;
  sessionId?: string;
}

export type ToolEvent<Result = unknown> =
  | { kind: 'progress'; message: string }
  | { kind: 'partial'; data: unknown }
  | { kind: 'final'; result: Result };

export function defineTool<Name extends string, Params, Result>(config: {
  name: Name;
  version: number;
  process: string;
  category: 'query' | 'mutation' | 'meta';
  permission?: {
    require: 'confirm' | 'auto';
    prompt?: (params: Params) => string;
  };
  uiEffects?: readonly UiEffect[];
  params: ZodType<Params>;
  result: ZodType<Result>;
  run: (
    ctx: ToolRunContext,
    params: Params,
  ) => AsyncIterable<ToolEvent<Result>>;
}): ToolDef<Name, Params, Result> {
  return {
    name: config.name,
    version: config.version,
    process: config.process,
    category: config.category,
    permission: config.permission,
    uiEffects: config.uiEffects,
    schemas: { params: config.params, result: config.result },
    run: config.run,
    _types: undefined as never,
  };
}

/**
 * Metadata-only tool declaration — used during Phase C migration while the
 * legacy `AgentTool` (JSON-Schema + `execute()`) pattern remains the source
 * of truth for runtime execution. The catalog only reads metadata fields
 * (`name`, `process`, `category`, `permission`, `uiEffects`) for its derived
 * views; `schemas` and `run` are not populated.
 *
 * Structurally equivalent to `ToolDef<Name, never, never>` — `createCatalog`
 * accepts both `defineTool()` and `defineToolMeta()` outputs.
 */
export function defineToolMeta<Name extends string>(config: {
  name: Name;
  version?: number;
  process: string;
  category: 'query' | 'mutation' | 'meta';
  permission?: {
    require: 'confirm' | 'auto';
    prompt?: (params: never) => string;
  };
  uiEffects?: readonly UiEffect[];
}): ToolDef<Name, never, never> {
  return {
    name: config.name,
    version: config.version ?? 1,
    process: config.process,
    category: config.category,
    permission: config.permission,
    uiEffects: config.uiEffects,
    schemas: undefined as never,
    run: undefined as never,
    _types: undefined as never,
  };
}
