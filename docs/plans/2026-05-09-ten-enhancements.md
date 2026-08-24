# Ten Enhancements Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Improve Lucid Fin across 10 dimensions: async I/O, file decomposition, test coverage, E2E tests, utility consolidation, bundle tracking, component splitting, IPC type migration, Redux organization, and DB migration docs.

**Architecture:** Each enhancement is a self-contained task that can be committed independently. Tasks are ordered by dependency: foundational changes (async I/O, utils) first, then structural refactors, then tooling/docs.

**Tech Stack:** Electron 41 + React 19 + Vite 8 + TypeScript 6 + Redux Toolkit + Vitest 4 + Playwright

---

## Task 2: Async File I/O — electron.ts

**Files:**

- Modify: `apps/desktop-main/src/electron.ts:86-95,260-325`

**Step 1: Cache version in IPC handler**

Replace lines 86-95 (`app:version` handler) with:

```typescript
ipcMain.handle('app:version', async () => {
  try {
    const pkgPath = path.join(__dirname, '..', 'package.json');
    const raw = await fsp.readFile(pkgPath, 'utf-8');
    return (JSON.parse(raw) as { version?: string }).version ?? app.getVersion();
  } catch {
    return app.getVersion();
  }
});
```

Add `fsp` import — change line 4 from:

```typescript
import fs from 'node:fs';
```

to:

```typescript
import fs from 'node:fs';
import fsp from 'node:fs/promises';
```

**Step 2: Convert lucid-asset protocol handler to async fs**

Replace the sync calls inside `protocol.handle('lucid-asset', ...)` (lines 261-325).

Replace lines 270-278 (meta.json read) with:

```typescript
try {
  const metaPath = cas.getAssetPath(hash, assetType, 'meta.json');
  const raw = await fsp.readFile(metaPath, 'utf-8');
  const meta = JSON.parse(raw) as { format?: string };
  if (meta.format) ext = meta.format;
} catch {
  /* meta.json not found — use requested ext */
}
```

Replace all `fs.existsSync(path)` checks with an async helper. Add this helper before the protocol handler:

```typescript
async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fsp.access(filePath);
    return true;
  } catch {
    return false;
  }
}
```

Then replace every `fs.existsSync(X)` inside the protocol handler with `await fileExists(X)`.

**Step 3: Type check**

Run: `npx tsc --noEmit -p apps/desktop-main/tsconfig.json`
Expected: No errors

**Step 4: Commit**

```bash
git add apps/desktop-main/src/electron.ts
git commit -m "perf: convert electron.ts asset protocol to async fs"
```

---

## Task 3: Async File I/O — asset.handlers.ts

**Files:**

- Modify: `apps/desktop-main/src/ipc/handlers/asset.handlers.ts:1-59`

**Step 1: Convert `findAssetFile` to async**

Note: `fsp` is already imported on line 4.

Change `findAssetFile` signature (line 22) and body to async:

```typescript
async function findAssetFile(
  cas: CAS,
  hash: string,
  type: AssetType,
  requestedFormat?: string,
): Promise<string | null> {
  let ext = requestedFormat || (type === 'video' ? 'mp4' : type === 'audio' ? 'mp3' : 'png');
  try {
    const metaPath = cas.getAssetPath(hash, type, 'meta.json');
    const raw = await fsp.readFile(metaPath, 'utf-8');
    const meta = JSON.parse(raw) as { format?: string };
    if (meta.format) ext = meta.format;
  } catch {
    /* meta.json not found */
  }

  const exactPath = cas.getAssetPath(hash, type, ext);
  try {
    await fsp.access(exactPath);
    return exactPath;
  } catch {
    /* not found */
  }

  for (const tryExt of FALLBACK_EXTS[type] ?? []) {
    if (tryExt === ext) continue;
    const tryPath = cas.getAssetPath(hash, type, tryExt);
    try {
      await fsp.access(tryPath);
      return tryPath;
    } catch {
      /* not found */
    }
  }

  for (const tryType of ['image', 'video', 'audio'] as const) {
    if (tryType === type) continue;
    for (const tryExt of FALLBACK_EXTS[tryType] ?? []) {
      const tryPath = cas.getAssetPath(hash, tryType, tryExt);
      try {
        await fsp.access(tryPath);
        return tryPath;
      } catch {
        /* not found */
      }
    }
  }

  return null;
}
```

Remove `import fs from 'node:fs';` (line 3) — only `fsp` is now needed. But first check that `fs` is not used elsewhere in the file. If it is (e.g., `fs.createReadStream`), keep it.

**Step 2: Update all callers**

Every call to `findAssetFile(...)` in this file must now be `await findAssetFile(...)`. Since the callers are already async IPC handlers, just add `await`.

**Step 3: Run tests**

Run: `npx vitest run apps/desktop-main/src/ipc/handlers/asset`
Expected: PASS

**Step 4: Type check**

Run: `npx tsc --noEmit -p apps/desktop-main/tsconfig.json`
Expected: No errors

**Step 5: Commit**

```bash
git add apps/desktop-main/src/ipc/handlers/asset.handlers.ts
git commit -m "perf: convert findAssetFile to async fs/promises"
```

---

## Task 4: Test Coverage Enforcement

**Files:**

- Modify: `vitest.config.ts:45-70`

**Step 1: Add global coverage floor**

Add a global threshold inside the `thresholds` block, before the per-file entries:

```typescript
thresholds: {
  statements: 40,
  branches: 30,
  functions: 30,
  lines: 40,
  // Per-file overrides (higher bars for critical modules)
  'apps/desktop-main/src/logger.ts': { ... },
  ...
},
```

These are intentionally conservative starting values. The team can ratchet them up over time.

**Step 2: Run coverage to verify the floor is achievable**

Run: `npx vitest run --coverage`
Expected: Coverage report prints. If global floor fails, lower the threshold to match current baseline minus 5%.

**Step 3: Commit**

```bash
git add vitest.config.ts
git commit -m "test: add global coverage floor (40% statements/lines, 30% branches/functions)"
```

---

## Task 5: E2E Test Expansion

**Files:**

- Create: `tests/e2e/canvas-create.spec.ts`
- Modify: `tests/e2e/fixtures.ts` (if new helpers needed)

**Step 1: Write canvas creation E2E test**

```typescript
import { test, expect } from './fixtures.js';

test('can create a new canvas from the UI', async ({ mainWindow }) => {
  // Wait for app to be ready
  await mainWindow.waitForSelector('[data-testid="app-ready"]', { timeout: 30_000 });

  // Click the new canvas button
  const newBtn = mainWindow.getByRole('button', { name: /new canvas/i });
  if (await newBtn.isVisible()) {
    await newBtn.click();
    // Verify canvas workspace is visible
    await expect(mainWindow.locator('[data-testid="canvas-workspace"]')).toBeVisible({
      timeout: 10_000,
    });
  }
});

test('canvas loads with toolbar visible', async ({ mainWindow }) => {
  await mainWindow.waitForSelector('[data-testid="app-ready"]', { timeout: 30_000 });
  // Verify toolbar is present
  const toolbar = mainWindow.locator('[data-testid="canvas-toolbar"]');
  // This test documents current behavior; adjust selectors to match actual UI
  await expect(toolbar).toBeVisible({ timeout: 10_000 });
});
```

**Step 2: Run E2E to verify**

Run: `npm run test:e2e`
Expected: New tests either pass or fail with helpful selector errors (fix selectors to match actual UI data-testid attributes)

**Step 3: Commit**

```bash
git add tests/e2e/canvas-create.spec.ts
git commit -m "test: add E2E canvas creation smoke tests"
```

---

## Task 6: Utility Consolidation

**Files:**

- Modify: `apps/desktop-renderer/src/components/canvas/asset-browser/utils.ts`
- Modify: `packages/shared-utils/src/index.ts` (if adding shared helpers)

**Step 1: Remove duplicated error helpers from asset-browser**

In `apps/desktop-renderer/src/components/canvas/asset-browser/utils.ts`, check if `getErrorMessage` and `getErrorDetail` are used outside this directory. If they're only used locally, extract them to a shared location or inline at call sites.

Approach: Since these are simple 2-line functions (`unknown → string`), keep them in the asset-browser utils but mark them clearly. The real duplication risk is low since `adapters-ai/error-utils.ts` serves a different domain (adapter error classification).

**Step 2: Audit format helpers**

Check if `formatSize`, `formatDuration`, `formatDurationShort` are duplicated anywhere else:

- Grep for `formatSize`, `formatDuration` across the codebase
- If only used in asset-browser, leave them in place (domain-scoped)

**Step 3: Document findings**

If no actual duplication is found, this task is a no-op (the exploration already confirmed most utils are properly domain-scoped). Skip to commit.

**Step 4: Commit (only if changes were made)**

```bash
git add -A
git commit -m "refactor: consolidate duplicated utility functions"
```

---

## Task 7: Bundle Size Tracking

**Files:**

- Modify: `apps/desktop-renderer/package.json` (add devDependency)
- Modify: `apps/desktop-renderer/vite.config.ts` (add plugin)
- Modify: `.github/workflows/bundle-size.yml` (add size check step)

**Step 1: Install rollup-plugin-visualizer**

Run: `npm install --save-dev rollup-plugin-visualizer --workspace=apps/desktop-renderer`

**Step 2: Add to Vite config**

In `apps/desktop-renderer/vite.config.ts`, add import:

```typescript
import { visualizer } from 'rollup-plugin-visualizer';
```

In the `plugins` array, add conditionally:

```typescript
plugins: [
  react(),
  tailwindcss(),
  mode === 'production' &&
    visualizer({
      filename: 'dist/bundle-stats.html',
      gzipSize: true,
      template: 'treemap',
    }),
].filter(Boolean),
```

**Step 3: Add CI size check**

In `.github/workflows/bundle-size.yml`, add a step after the zod-free check:

```yaml
- name: Check total renderer bundle size
  run: |
    TOTAL=$(du -sb apps/desktop-renderer/dist/assets/ | cut -f1)
    MAX_BYTES=8388608  # 8MB budget
    echo "Total renderer bundle: $TOTAL bytes (budget: $MAX_BYTES)"
    if [ "$TOTAL" -gt "$MAX_BYTES" ]; then
      echo "::error::Renderer bundle exceeds 8MB budget ($TOTAL bytes)"
      exit 1
    fi
    echo "✓ Bundle size within budget."
```

**Step 4: Verify build works**

Run: `npm run build --workspace=apps/desktop-renderer`
Expected: Builds successfully, `dist/bundle-stats.html` is generated

**Step 5: Commit**

```bash
git add apps/desktop-renderer/package.json apps/desktop-renderer/vite.config.ts .github/workflows/bundle-size.yml
git commit -m "ci: add bundle size tracking with visualizer and 8MB budget"
```

---

## Task 8: Split CommanderPanel.tsx

**Files:**

- Create: `apps/desktop-renderer/src/components/canvas/commander/useAutoScroll.ts`
- Create: `apps/desktop-renderer/src/components/canvas/commander/CommanderHints.tsx`
- Modify: `apps/desktop-renderer/src/components/canvas/CommanderPanel.tsx`

**Step 1: Extract useAutoScroll hook**

Read CommanderPanel.tsx lines 270-291 to identify the auto-scroll logic. Extract into a new file:

```typescript
// apps/desktop-renderer/src/components/canvas/commander/useAutoScroll.ts
import { useRef, useCallback, useEffect } from 'react';

export function useAutoScroll(deps: { messageCount: number; isStreaming: boolean }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const userScrolledUpRef = useRef(false);
  // ... extract the scroll logic from CommanderPanel
  return { containerRef, userScrolledUpRef, scrollToBottom };
}
```

The exact implementation depends on the actual code in those lines — read them during implementation and extract verbatim.

**Step 2: Extract CommanderHints**

Move `FirstSessionHint` and `ComposerChips` components (lines 1218-1267) into a new file:

```typescript
// apps/desktop-renderer/src/components/canvas/commander/CommanderHints.tsx
import React from 'react';
// ... extract FirstSessionHint and ComposerChips from CommanderPanel
export const FirstSessionHint = React.memo(function FirstSessionHint(...) { ... });
export const ComposerChips = React.memo(function ComposerChips(...) { ... });
```

**Step 3: Update CommanderPanel imports**

Replace the inline definitions with imports from the new files.

**Step 4: Run tests**

Run: `npx vitest run apps/desktop-renderer/src/components/canvas/commander`
Expected: PASS

**Step 5: Type check**

Run: `npx tsc --noEmit -p apps/desktop-renderer/tsconfig.json`
Expected: No errors

**Step 6: Commit**

```bash
git add apps/desktop-renderer/src/components/canvas/commander/useAutoScroll.ts apps/desktop-renderer/src/components/canvas/commander/CommanderHints.tsx apps/desktop-renderer/src/components/canvas/CommanderPanel.tsx
git commit -m "refactor: extract useAutoScroll hook and hints from CommanderPanel"
```

---

## Task 9: Split Entity Manager Panels

**Files:**

- Create: `apps/desktop-renderer/src/components/canvas/entity-shared/SingleReferenceImage.tsx`
- Create: `apps/desktop-renderer/src/components/canvas/entity-shared/AssetPickerDialog.tsx`
- Modify: `apps/desktop-renderer/src/components/canvas/LocationManagerPanel.tsx`
- Modify: `apps/desktop-renderer/src/components/canvas/EquipmentManagerPanel.tsx`

**Step 1: Identify shared sub-components**

Both panels define nearly identical sub-components:

- `SingleReferenceImage` (~220 lines each)
- `VariantThumb` (~40 lines each)
- `ListThumb` (~5 lines each)
- `AssetPickerDialog` (~40 lines each)
- `AssetThumb` (~20 lines each)

**Step 2: Create shared SingleReferenceImage**

Read both panels' `SingleReferenceImage` implementations. Unify into a single generic component:

```typescript
// apps/desktop-renderer/src/components/canvas/entity-shared/SingleReferenceImage.tsx
import React from 'react';
// ... unified implementation accepting entity-agnostic props
export interface SingleReferenceImageProps {
  entityId: string;
  referenceImages: Record<string, { hash: string; variants?: string[] }>;
  onSetImage: (slot: string, hash: string) => void;
  onRemoveImage: (slot: string) => void;
  // ... other shared props
}
export const SingleReferenceImage = React.memo(function SingleReferenceImage(
  props: SingleReferenceImageProps,
) {
  // ... merged implementation
});
```

**Step 3: Create shared AssetPickerDialog**

```typescript
// apps/desktop-renderer/src/components/canvas/entity-shared/AssetPickerDialog.tsx
// ... same approach
```

**Step 4: Update both panels to use shared components**

Replace inline definitions in LocationManagerPanel and EquipmentManagerPanel with imports.

**Step 5: Run tests**

Run: `npx vitest run apps/desktop-renderer`
Expected: PASS

**Step 6: Type check**

Run: `npx tsc --noEmit -p apps/desktop-renderer/tsconfig.json`
Expected: No errors

**Step 7: Commit**

```bash
git add apps/desktop-renderer/src/components/canvas/entity-shared/ apps/desktop-renderer/src/components/canvas/LocationManagerPanel.tsx apps/desktop-renderer/src/components/canvas/EquipmentManagerPanel.tsx
git commit -m "refactor: extract shared entity panel sub-components"
```

---

## Task 10: Redux Slice Re-organization

**Files:**

- Create: `apps/desktop-renderer/src/store/slices/canvas/index.ts`
- Move: `apps/desktop-renderer/src/store/slices/canvas*.ts` → `apps/desktop-renderer/src/store/slices/canvas/`
- Modify: `apps/desktop-renderer/src/store/index.ts`

**Step 1: Group canvas slices into subdirectory**

The canvas domain already has 8 related files:

- `canvas.ts`, `canvas-edge-reducers.ts`, `canvas-generation-reducers.ts`
- `canvas-node-reducers.ts`, `canvas-preset-reducers.ts`, `canvas-ref-reducers.ts`
- `canvas-helpers.ts`, `canvas-selectors.ts`

Create `apps/desktop-renderer/src/store/slices/canvas/` and move all 8 files into it.

Create a barrel export:

```typescript
// apps/desktop-renderer/src/store/slices/canvas/index.ts
export { canvasReducer } from './canvas.js';
export { canvasSlice } from './canvas.js';
```

**Step 2: Update store/index.ts import**

Change:

```typescript
import { canvasReducer } from './slices/canvas.js';
```

to:

```typescript
import { canvasReducer } from './slices/canvas/index.js';
```

**Step 3: Update all internal imports within the moved files**

The moved files reference each other (e.g., `canvas.ts` imports from `./canvas-helpers.js`). Since they're all in the same directory, relative imports remain unchanged.

**Step 4: Find and update all external imports**

Grep for `from.*slices/canvas` across the renderer and update paths:

- `from '../store/slices/canvas.js'` → `from '../store/slices/canvas/canvas.js'` (or use barrel)
- `from '../store/slices/canvas-selectors.js'` → `from '../store/slices/canvas/canvas-selectors.js'`

**Step 5: Type check**

Run: `npx tsc --noEmit -p apps/desktop-renderer/tsconfig.json`
Expected: No errors

**Step 6: Run tests**

Run: `npx vitest run apps/desktop-renderer`
Expected: PASS

**Step 7: Commit**

```bash
git add apps/desktop-renderer/src/store/
git commit -m "refactor: group canvas Redux slices into subdirectory"
```

---

## Task 11: IPC Type Migration Audit

**Files:**

- Create: `docs/plans/ipc-migration-status.md` (audit document)

**Step 1: Audit current state**

This is a research task. The IPC migration (legacy `IpcChannelMap` → typed channels via `contracts-parse`) is an ongoing multi-phase effort. Rather than attempting the full migration in this PR, document the current state.

Grep for:

- All `ipcMain.handle(` calls → count how many use legacy strings vs. registrar
- All channel references in `preload.cts` → which are typed
- The old `IpcChannelMap` in `contracts/src/ipc.ts` → which channels remain

**Step 2: Create migration status document**

```markdown
# IPC Type Migration Status

## Current State

- Legacy `IpcChannelMap`: ~60 channels (frozen, deprecated)
- New typed channels (`contracts/src/ipc/channels/`): ~169 entries via batches 01-10
- Registrar (`features/ipc/registrar.ts`): Supports validation, abort, invocation IDs

## What's Migrated

- [list of handlers using registerInvoke]

## What's Pending

- [list of handlers still using raw ipcMain.handle]

## Migration Steps Per Channel

1. Define request/response types in `contracts/src/ipc/channels/batch-XX.ts`
2. Add Zod schema in `contracts-parse`
3. Switch handler from `ipcMain.handle` to `registerInvoke`
4. Update preload channel list (auto-generated via `scripts/gen-preload.ts`)
5. Update renderer call site to use typed API
```

**Step 3: Commit**

```bash
git add docs/plans/ipc-migration-status.md
git commit -m "docs: add IPC type migration status audit"
```

---

## Task 12: Database Migration Documentation

**Files:**

- Create: `docs/plans/db-migration-guide.md`

**Step 1: Write the developer guide**

````markdown
# SQLite Schema Migration Guide

## Current Architecture

Lucid Fin uses an **inline idempotent schema** approach:

- Single source: `packages/storage/src/schema-sql.ts`
- All `CREATE TABLE IF NOT EXISTS` — safe to re-run
- Used for both normal boot and repair/recovery
- No versioned migration files (the `migrations/` directory is empty)

## Adding a New Table

1. Add `CREATE TABLE IF NOT EXISTS ...` to `schema-sql.ts`
2. Add `CREATE INDEX IF NOT EXISTS ...` for any query patterns
3. Create/update the repository in `packages/storage/src/repositories/`
4. Export from `packages/storage/src/index.ts`
5. Add the repo to `SqliteIndex.repos` bundle

## Adding a Column to an Existing Table

SQLite doesn't support `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`.
Use this pattern:

```sql
-- In schema-sql.ts, add after the CREATE TABLE:
-- Idempotent column addition (SQLite ignores if column exists)
```
````

In practice, wrap with a runtime check:

```typescript
const cols = db.pragma('table_info(my_table)') as { name: string }[];
if (!cols.some((c) => c.name === 'new_column')) {
  db.exec('ALTER TABLE my_table ADD COLUMN new_column TEXT DEFAULT ""');
}
```

## Testing Schema Changes

1. Unit test the repository with an in-memory DB
2. Verify idempotency: run schema SQL twice — no errors
3. Test with existing data: ensure no data loss on upgrade

## Recovery & Repair

`SqliteIndex` has built-in repair logic (`sqlite-index.ts:180-240`).
Schema SQL must remain idempotent for this to work correctly.

````

**Step 2: Commit**

```bash
git add docs/plans/db-migration-guide.md
git commit -m "docs: add SQLite schema migration developer guide"
````

---

## Task 13: Split agent-orchestrator.ts (Quick Wins Only)

**Files:**

- Create: `packages/application/src/agent/orchestrator-process-prompts.ts`
- Create: `packages/application/src/agent/orchestrator-utils.ts`
- Modify: `packages/application/src/agent/agent-orchestrator.ts`

**Step 1: Extract standalone helper functions**

Move lines 156-250 (standalone functions not in the class) to `orchestrator-utils.ts`:

- `stripInjectedParamsFromTool()`
- `destructResponse()`
- `isProcessCategory()`
- `isProcessPromptKey()`
- `getStandaloneDisplayName()`

```typescript
// packages/application/src/agent/orchestrator-utils.ts
// ... move these functions here with their imports
```

Update `agent-orchestrator.ts` to import from the new file.

**Step 2: Extract process prompt methods**

Move the process prompt management methods (lines 1662-1984) into `orchestrator-process-prompts.ts`. These are class methods, so create standalone functions that accept the orchestrator's state as parameters, then call them from thin wrapper methods on the class.

This is a larger refactor — if time-constrained, defer to a follow-up PR and just extract the utils.

**Step 3: Run tests**

Run: `npx vitest run packages/application/src/agent/agent-orchestrator`
Expected: PASS

**Step 4: Type check**

Run: `npx tsc --noEmit -p packages/application/tsconfig.json`
Expected: No errors

**Step 5: Commit**

```bash
git add packages/application/src/agent/
git commit -m "refactor: extract orchestrator utils and process prompt helpers"
```

---

## Task 14: Split prompt-compiler.ts (Types Only)

**Files:**

- Create: `packages/application/src/prompt-compiler-types.ts`
- Modify: `packages/application/src/prompt-compiler.ts`

**Step 1: Extract types and interfaces**

Move lines 1-130 (all type/interface definitions) to `prompt-compiler-types.ts`:

- `PromptMode`
- `StyleGuideDefaults`
- `ResolvedCharacter`
- `PromptCompilerInput`
- `PromptDiagnostic`
- `PromptSegment`
- `CompiledPrompt`

**Step 2: Re-export from prompt-compiler.ts**

Add to the top of `prompt-compiler.ts`:

```typescript
export type {
  PromptMode,
  StyleGuideDefaults,
  ResolvedCharacter,
  PromptCompilerInput,
  PromptDiagnostic,
  PromptSegment,
  CompiledPrompt,
} from './prompt-compiler-types.js';
```

**Step 3: Update any direct type imports across the codebase**

Grep for `from.*prompt-compiler` to find all import sites. They should continue to work via the re-export.

**Step 4: Run tests**

Run: `npx vitest run packages/application/src/prompt-compiler`
Expected: PASS

**Step 5: Type check**

Run: `npx tsc --noEmit -p packages/application/tsconfig.json`
Expected: No errors

**Step 6: Commit**

```bash
git add packages/application/src/prompt-compiler-types.ts packages/application/src/prompt-compiler.ts
git commit -m "refactor: extract prompt-compiler types into dedicated file"
```

---

## Verification Checklist

After all tasks, run the full validation suite:

```bash
npx tsc --noEmit -p packages/contracts/tsconfig.json
npx tsc --noEmit -p packages/application/tsconfig.json
npx tsc --noEmit -p packages/adapters-ai/tsconfig.json
npx vitest run --reporter=verbose
npx eslint . --max-warnings=0
```

All must pass before final push.
