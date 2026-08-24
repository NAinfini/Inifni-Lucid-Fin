/**
 * Pure-data renderer-facing lookup: which tool names trigger an
 * `entity.refresh` uiEffect, and which entity bucket they target.
 *
 * This is a narrow, frozen renderer projection of entity refresh behavior.
 * The executable definitions live in `@lucid-fin/agent`, which
 * the renderer can't import (zod + main-only deps). Consumers:
 *
 *   - `apps/desktop-renderer/src/hooks/useCommander.ts` — folds entity-create
 *     tool completions into session analytics (`recordEntityCreate`).
 *
 * **Invariant (enforced by a cross-check test):** every entry here MUST match
 * the catalog's `uiEffectsByKey[name]` entry of kind `'entity.refresh'`.
 */

export const ENTITY_REFRESH_TOOL_ENTITY: Readonly<Record<string, string>> = Object.freeze({
  'entity.create': 'all',
  'entity.update': 'all',
  'entity.delete': 'all',
  'entity.setRefImage': 'all',
  'entity.deleteRefImage': 'all',
  'entity.setRefImageFromNode': 'all',
});
