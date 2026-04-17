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
