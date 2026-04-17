/**
 * Runtime tool catalog aggregator — Phase C-1.
 *
 * Consumes a readonly tuple of `ToolDef` and produces the four derived
 * lookup projections that make up a `ToolCatalog<T>`:
 *
 *   - `byKey`          — name → tool definition
 *   - `byProcess`      — process → tools in that process
 *   - `mutatingKeys`   — names with category === 'mutation'
 *   - `metaKeys`       — names with category === 'meta'
 *   - `uiEffectsByKey` — name → declared uiEffects (or [])
 *
 * All nested objects are frozen to prevent downstream mutation.
 * Duplicate tool names throw — deterministic, loud failure at catalog
 * construction time (see `catalog.test.ts`).
 */

import type { ToolCatalog, UiEffect } from '@lucid-fin/contracts';

import type { ToolDef } from '../tools.js';

export function createCatalog<const T extends readonly ToolDef[]>(
  tools: T,
): ToolCatalog<T> {
  const byKey: Record<string, ToolDef> = {};
  const byProcess: Record<string, ToolDef[]> = {};
  const mutatingKeys: string[] = [];
  const metaKeys: string[] = [];
  const uiEffectsByKey: Record<string, readonly UiEffect[]> = {};

  for (const tool of tools) {
    if (Object.prototype.hasOwnProperty.call(byKey, tool.name)) {
      throw new Error(
        `createCatalog: duplicate tool name "${tool.name}" — tool names must be unique within a catalog.`,
      );
    }
    byKey[tool.name] = tool;

    (byProcess[tool.process] ??= []).push(tool);

    if (tool.category === 'mutation') mutatingKeys.push(tool.name);
    else if (tool.category === 'meta') metaKeys.push(tool.name);

    uiEffectsByKey[tool.name] = tool.uiEffects ?? [];
  }

  // Freeze nested arrays so downstream consumers can't mutate them.
  for (const key of Object.keys(byProcess)) {
    byProcess[key] = Object.freeze(byProcess[key]!) as ToolDef[];
  }
  for (const key of Object.keys(uiEffectsByKey)) {
    uiEffectsByKey[key] = Object.freeze(
      // `uiEffects` on a ToolDef is already readonly — freeze our own copy
      // regardless so equality is stable and mutation is rejected.
      [...uiEffectsByKey[key]!],
    );
  }

  const catalog = {
    byKey: Object.freeze(byKey),
    byProcess: Object.freeze(byProcess),
    mutatingKeys: Object.freeze(mutatingKeys),
    metaKeys: Object.freeze(metaKeys),
    uiEffectsByKey: Object.freeze(uiEffectsByKey),
  };

  return Object.freeze(catalog) as unknown as ToolCatalog<T>;
}
