/**
 * Pure type shape for a tool catalog (Phase C-1).
 *
 * A `ToolCatalog<T>` is the aggregator view over a tuple of tool definitions.
 * It derives four lookup projections at the type level so renderer code can
 * narrow a tool by name and flow the exact `params`/`result` types through
 * without hand-written unions.
 *
 * Zero runtime — the matching factory lives in
 * `@lucid-fin/contracts-parse/src/agent/catalog.ts`.
 */

import type { ToolDefinitionType, UiEffect } from '../types/tool-types.js';

/** Element type of a readonly tuple of tools. */
type ElementOf<T extends readonly unknown[]> = T[number];

/** Pick members of a union whose `process` matches `P`. */
type ToolsWithProcess<U, P> = U extends { readonly process: infer TP }
  ? TP extends P
    ? U
    : never
  : never;

/** Pick members of a union whose `category` matches `C`. */
type ToolsWithCategory<U, C> = U extends { readonly category: infer TC }
  ? TC extends C
    ? U
    : never
  : never;

/** Extract the `name` of members of a union whose `category` matches `C`. */
type NamesWithCategory<U, C> = ToolsWithCategory<U, C> extends {
  readonly name: infer N;
}
  ? N
  : never;

/**
 * Typed catalog over a readonly tuple of `ToolDefinitionType` members.
 *
 * Four derived views:
 * - `byKey`     — name → exact tool def (narrowing preserves params/result).
 * - `byProcess` — process → readonly tuple of tools in that process.
 * - `mutatingKeys` — readonly list of names whose `category === 'mutation'`.
 * - `metaKeys`     — readonly list of names whose `category === 'meta'`.
 * - `uiEffectsByKey` — name → readonly `UiEffect[]` (empty when undeclared).
 */
export interface ToolCatalog<Tools extends readonly ToolDefinitionType[]> {
  readonly byKey: {
    readonly [K in ElementOf<Tools>['name']]: Extract<
      ElementOf<Tools>,
      { readonly name: K }
    >;
  };
  readonly byProcess: {
    readonly [P in ElementOf<Tools>['process']]: readonly ToolsWithProcess<
      ElementOf<Tools>,
      P
    >[];
  };
  readonly mutatingKeys: readonly NamesWithCategory<
    ElementOf<Tools>,
    'mutation'
  >[];
  readonly metaKeys: readonly NamesWithCategory<ElementOf<Tools>, 'meta'>[];
  readonly uiEffectsByKey: {
    readonly [K in ElementOf<Tools>['name']]: readonly UiEffect[];
  };
}

/** The set of tool names (keys) of a given catalog. */
export type ToolKey<T extends ToolCatalog<readonly ToolDefinitionType[]>> =
  keyof T['byKey'];

/** The set of process categories of a given catalog. */
export type ProcessCategory<
  T extends ToolCatalog<readonly ToolDefinitionType[]>,
> = keyof T['byProcess'];
