/**
 * Pure type shape for a tool definition (Phase C registry entry).
 *
 * This type lives in contracts (zero runtime) so both renderer (for type
 * checking `ToolCatalog` imports) and main (for `defineTool` / `createCatalog`)
 * can reference it without pulling zod.
 *
 * The runtime `defineTool` factory in `@lucid-fin/contracts-parse` produces
 * values conforming to this shape.
 */

/** UI effects a tool can declare — renderer dispatches these on tool completion. */
export type UiEffect =
  | { kind: 'entity.refresh'; entity: string }
  | { kind: 'canvas.dispatch'; action: unknown }
  | { kind: 'toast'; message: string }
  | { kind: 'focus-node'; nodeId: string };

export interface ToolDefinitionType<
  Name extends string = string,
  Params = unknown,
  Result = unknown,
> {
  readonly name: Name;
  readonly version: number;
  readonly process: string;
  readonly category: 'query' | 'mutation' | 'meta';
  readonly permission?: {
    readonly require: 'confirm' | 'auto';
    readonly prompt?: (params: Params) => string;
  };
  readonly uiEffects?: readonly UiEffect[];
  readonly _types: {
    readonly params: Params;
    readonly result: Result;
  };
}
