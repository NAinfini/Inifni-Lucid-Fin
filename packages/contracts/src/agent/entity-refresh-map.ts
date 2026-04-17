/**
 * Pure-data renderer-facing lookup: which tool names trigger an
 * `entity.refresh` uiEffect, and which entity bucket they target.
 *
 * This is a narrow, frozen copy of the subset of `ToolCatalog` that the
 * renderer needs — the full catalog lives in `@lucid-fin/application`, which
 * the renderer can't import (zod + main-only deps). Consumers:
 *
 *   - `apps/desktop-renderer/src/hooks/useCommander.ts` — folds entity-create
 *     tool completions into session analytics (`recordEntityCreate`).
 *
 * **Invariant (enforced by a cross-check test):** every entry here MUST match
 * the catalog's `uiEffectsByKey[name]` entry of kind `'entity.refresh'`.
 */

export const ENTITY_REFRESH_TOOL_ENTITY: Readonly<Record<string, string>> = Object.freeze({
  'character.create': 'character',
  'character.update': 'character',
  'character.delete': 'character',
  'character.generateRefImage': 'character',
  'character.setRefImage': 'character',
  'character.deleteRefImage': 'character',
  'character.setRefImageFromNode': 'character',
  'location.create': 'location',
  'location.update': 'location',
  'location.delete': 'location',
  'location.generateRefImage': 'location',
  'location.setRefImage': 'location',
  'location.deleteRefImage': 'location',
  'location.setRefImageFromNode': 'location',
  'equipment.create': 'equipment',
  'equipment.update': 'equipment',
  'equipment.delete': 'equipment',
  'equipment.generateRefImage': 'equipment',
  'equipment.setRefImage': 'equipment',
  'equipment.deleteRefImage': 'equipment',
  'equipment.setRefImageFromNode': 'equipment',
});
