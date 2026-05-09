# IPC Type Migration Status

> Audit date: 2026-05-09
> Auditor: claude-agent (automated grep-based analysis)

## Executive Summary

The codebase has **197 typed channel definitions** in `@lucid-fin/contracts-parse` (167 invoke + 30 push), but only **5 invoke handlers** at the main-process handler layer actually use the new `registerInvoke()` registrar. The remaining **~145 invoke handlers** still use raw `ipcMain.handle()` with string channel names and manual TypeScript annotations.

The channel *schemas* (zod definitions) are fully defined for all channels. The gap is at the **handler registration layer**: handlers have not been migrated from `ipcMain.handle('channel', fn)` to `registerInvoke(deps, channelDef, fn)`.

**Grand total: ~172 raw handlers + 5 migrated = ~177 invoke handlers.**

---

## Current State Summary

| Metric | Count |
|--------|-------|
| Typed channel defs in contracts-parse (invoke) | 167 |
| Typed channel defs in contracts-parse (push) | 30 |
| Handlers using `registerInvoke()` | 5 |
| Handlers using `registerReply()` | 0 (prod) |
| Handlers using `registerPush()` | 0 (prod) |
| Handlers using push-gateway `gateway.emit()` | ~12 call sites |
| Handlers using raw `ipcMain.handle()` | ~168 |
| Handlers using `safeHandle()` wrapper | 4 |
| Migration progress (invoke handler layer) | **~3%** |

---

## Handlers Already Using `registerInvoke`

These 5 handlers are fully migrated and use zod-validated request/response parsing:

| # | Channel | File | Channel Def Source |
|---|---------|------|--------------------|
| 1 | `ipc:ping` | `electron.ts:98` | `pingChannel` (batch-10) |
| 2 | `health:ping` | `electron.ts:101` | `healthPingChannel` (health) |
| 3 | `app:restart` | `electron.ts:107` | `appRestartChannel` (batch-10) |
| 4 | `provider:health` | `provider-health.handlers.ts:21` | `providerHealthChannel` (batch-13) |
| 5 | `provider:health:get` | `provider-health.handlers.ts:25` | `providerHealthGetChannel` (batch-13) |

---

## Handlers Still Using Raw `ipcMain.handle`

### electron.ts (9 handlers)

| # | Channel | Line |
|---|---------|------|
| 1 | `logger:getRecent` | 79 |
| 2 | `updater:check` | 82 |
| 3 | `updater:download` | 83 |
| 4 | `updater:install` | 84 |
| 5 | `updater:status` | 85 |
| 6 | `app:version` | 86 |
| 7 | `clipboard:setEnabled` | 242 |
| 8 | `shell:openExternal` | 413 |
| 9 | `settings:set-analytics-enabled` | 426 |

### settings.handlers.ts (2 handlers)

| # | Channel | Line |
|---|---------|------|
| 1 | `settings:load` | 23 |
| 2 | `settings:save` | 36 |

### script.handlers.ts (4 handlers)

| # | Channel | Line |
|---|---------|------|
| 1 | `script:parse` | 11 |
| 2 | `script:save` | 20 |
| 3 | `script:load` | 45 |
| 4 | `script:import` | 49 |

### character.handlers.ts (8 handlers)

| # | Channel | Line |
|---|---------|------|
| 1 | `character:list` | 38 |
| 2 | `character:get` | 42 |
| 3 | `character:save` | 49 |
| 4 | `character:delete` | 138 |
| 5 | `character:setRefImage` | 143 |
| 6 | `character:removeRefImage` | 179 |
| 7 | `character:saveLoadout` | 199 |
| 8 | `character:deleteLoadout` | 232 |

### equipment.handlers.ts (6 handlers)

| # | Channel | Line |
|---|---------|------|
| 1 | `equipment:list` | 19 |
| 2 | `equipment:get` | 25 |
| 3 | `equipment:save` | 32 |
| 4 | `equipment:delete` | 94 |
| 5 | `equipment:setRefImage` | 99 |
| 6 | `equipment:removeRefImage` | 133 |

### style.handlers.ts (2 handlers)

| # | Channel | Line |
|---|---------|------|
| 1 | `style:save` | 36 |
| 2 | `style:load` | 41 |

### color-style.handlers.ts (4 handlers via `safeHandle`)

| # | Channel | Line |
|---|---------|------|
| 1 | `colorStyle:list` | 80 |
| 2 | `colorStyle:save` | 84 |
| 3 | `colorStyle:delete` | 99 |
| 4 | `colorStyle:extract` | 104 |

### asset.handlers.ts (8 handlers)

| # | Channel | Line |
|---|---------|------|
| 1 | `asset:import` | 82 |
| 2 | `asset:importBuffer` | 107 |
| 3 | `asset:pickFile` | 141 |
| 4 | `asset:query` | 176 |
| 5 | `asset:getPath` | 193 |
| 6 | `asset:delete` | 205 |
| 7 | `asset:export` | 225 |
| 8 | `asset:exportBatch` | 274 |

### embedding.handlers.ts (3 handlers)

| # | Channel | Line |
|---|---------|------|
| 1 | `asset:generateEmbedding` | 73 |
| 2 | `asset:searchSemantic` | 81 |
| 3 | `asset:reindexEmbeddings` | 100 |

### entity.handlers.ts (1 handler)

| # | Channel | Line |
|---|---------|------|
| 1 | `entity:generateReferenceImage` | 24 |

### job.handlers.ts (5 handlers)

| # | Channel | Line |
|---|---------|------|
| 1 | `job:submit` | 33 |
| 2 | `job:list` | 45 |
| 3 | `job:cancel` | 49 |
| 4 | `job:pause` | 57 |
| 5 | `job:resume` | 65 |

### workflow.handlers.ts (11 handlers)

| # | Channel | Line |
|---|---------|------|
| 1 | `workflow:list` | 6 |
| 2 | `workflow:get` | 10 |
| 3 | `workflow:getStages` | 22 |
| 4 | `workflow:getTasks` | 26 |
| 5 | `workflow:start` | 30 |
| 6 | `workflow:pause` | 60 |
| 7 | `workflow:resume` | 68 |
| 8 | `workflow:cancel` | 76 |
| 9 | `workflow:retryTask` | 84 |
| 10 | `workflow:retryStage` | 88 |
| 11 | `workflow:retryWorkflow` | 92 |

### canvas.handlers.ts (7 handlers)

| # | Channel | Line |
|---|---------|------|
| 1 | `canvas:list` | 112 |
| 2 | `canvas:load` | 116 |
| 3 | `canvas:save` | 136 |
| 4 | `canvas:create` | 143 |
| 5 | `canvas:delete` | 164 |
| 6 | `canvas:rename` | 170 |
| 7 | `canvas:patch` | 182 |

### canvas-generation.handlers.ts (3 handlers)

| # | Channel | Line |
|---|---------|------|
| 1 | `canvas:generate` | 70 |
| 2 | `canvas:cancelGeneration` | 74 |
| 3 | `canvas:estimateCost` | 78 |

### commander.handlers.ts (2 handlers)

| # | Channel | Line |
|---|---------|------|
| 1 | `commander:chat` | 684 |
| 2 | `commander:events:hydrate` | 1002 |

### commander-meta.handlers.ts (8 handlers)

| # | Channel | Line |
|---|---------|------|
| 1 | `commander:cancel` | 8 |
| 2 | `commander:cancel-step` | 26 |
| 3 | `commander:inject-message` | 51 |
| 4 | `commander:tool:decision` | 73 |
| 5 | `commander:tool:answer` | 98 |
| 6 | `commander:compact` | 124 |
| 7 | `commander:tool-list` | 141 |
| 8 | `commander:tool-search` | 155 |

Note: `commander:chat` uses streaming via push-gateway, not `registerInvoke` events.

### keychain.handlers.ts (5 handlers)

| # | Channel | Line |
|---|---------|------|
| 1 | `keychain:isConfigured` | 28 |
| 2 | `keychain:get` | 32 |
| 3 | `keychain:set` | 36 |
| 4 | `keychain:delete` | 48 |
| 5 | `keychain:test` | 60 |

### preset.handlers.ts (6 handlers)

| # | Channel | Line |
|---|---------|------|
| 1 | `preset:list` | 312 |
| 2 | `preset:save` | 323 |
| 3 | `preset:delete` | 331 |
| 4 | `preset:reset` | 351 |
| 5 | `preset:import` | 359 |
| 6 | `preset:export` | 370 |

### snapshot.handlers.ts (8 handlers)

| # | Channel | Line |
|---|---------|------|
| 1 | `session:upsert` | 15 |
| 2 | `session:list` | 40 |
| 3 | `session:get` | 46 |
| 4 | `session:delete` | 53 |
| 5 | `snapshot:capture` | 63 |
| 6 | `snapshot:restore` | 90 |
| 7 | `snapshot:list` | 97 |
| 8 | `snapshot:delete` | 103 |

### process-prompt.handlers.ts (4 handlers)

| # | Channel | Line |
|---|---------|------|
| 1 | `processPrompt:list` | 8 |
| 2 | `processPrompt:get` | 10 |
| 3 | `processPrompt:setCustom` | 18 |
| 4 | `processPrompt:reset` | 25 |

### storage.handlers.ts (11 handlers)

| # | Channel | Line |
|---|---------|------|
| 1 | `storage:getOverview` | 72 |
| 2 | `storage:openFolder` | 115 |
| 3 | `storage:showInFolder` | 127 |
| 4 | `storage:clearLogs` | 139 |
| 5 | `storage:clearEmbeddings` | 169 |
| 6 | `storage:vacuumDatabase` | 180 |
| 7 | `storage:backupDatabase` | 191 |
| 8 | `storage:restoreDatabase` | 215 |
| 9 | `storage:pickFolder` | 248 |
| 10 | `storage:pickSaveFile` | 253 |
| 11 | `storage:pickOpenFile` | 261 |

### backup.handlers.ts (3 handlers)

| # | Channel | Line |
|---|---------|------|
| 1 | `db:createBackup` | 22 |
| 2 | `db:listBackups` | 50 |
| 3 | `db:restoreBackup` | 63 |

### data.handlers.ts (3 handlers)

| # | Channel | Line |
|---|---------|------|
| 1 | `data:estimateExportSize` | 71 |
| 2 | `data:export` | 86 |
| 3 | `data:wipe` | 116 |

### export.handlers.ts (7 handlers)

| # | Channel | Line |
|---|---------|------|
| 1 | `export:nle` | 49 |
| 2 | `export:assetBundle` | 113 |
| 3 | `export:subtitles` | 190 |
| 4 | `export:storyboard` | 247 |
| 5 | `export:metadata` | 434 |
| 6 | `import:srt` | 551 |
| 7 | `export:capcut` | 647 |

### render.handlers.ts (3 handlers)

| # | Channel | Line |
|---|---------|------|
| 1 | `render:start` | 49 |
| 2 | `render:status` | 110 |
| 3 | `render:cancel` | 122 |

### ffmpeg.handlers.ts (3 handlers)

| # | Channel | Line |
|---|---------|------|
| 1 | `ffmpeg:probe` | 21 |
| 2 | `ffmpeg:thumbnail` | 63 |
| 3 | `ffmpeg:transcode` | 78 |

### video-clone.handlers.ts (2 handlers)

| # | Channel | Line |
|---|---------|------|
| 1 | `video:clone` | 43 |
| 2 | `video:pickFile` | 203 |

### video-chain.ts (1 handler)

| # | Channel | Line |
|---|---------|------|
| 1 | `video:extractLastFrame` | 110 |

### vision.handlers.ts (1 handler)

| # | Channel | Line |
|---|---------|------|
| 1 | `vision:describeImage` | 138 |

### lipsync.handlers.ts (2 handlers)

| # | Channel | Line |
|---|---------|------|
| 1 | `lipsync:process` | 175 |
| 2 | `lipsync:checkAvailability` | 188 |

### folder.handlers.ts (24 handlers — dynamic)

4 kinds x 5 CRUD ops + 4 setFolder channels:

| # | Channel Pattern | Line |
|---|-----------------|------|
| 1-4 | `folder.{character,equipment,location,asset}:list` | 27 (loop) |
| 5-8 | `folder.{character,equipment,location,asset}:create` | 31 (loop) |
| 9-12 | `folder.{character,equipment,location,asset}:rename` | 41 (loop) |
| 13-16 | `folder.{character,equipment,location,asset}:move` | 47 (loop) |
| 17-20 | `folder.{character,equipment,location,asset}:delete` | 59 (loop) |
| 21 | `character:setFolder` | 67 |
| 22 | `equipment:setFolder` | 77 |
| 23 | `location:setFolder` | 87 |
| 24 | `asset:setFolder` | 97 |

### ai.handlers.ts (5 handlers)

| # | Channel | Line |
|---|---------|------|
| 1 | `ai:chat` | 25 |
| 2 | `ai:prompt:list` | 69 |
| 3 | `ai:prompt:get` | 78 |
| 4 | `ai:prompt:setCustom` | 84 |
| 5 | `ai:prompt:clearCustom` | 88 |

---

## Push Channel Status

Push channels use `createRendererPushGateway` + `gateway.emit(channelDef, payload)` which already consumes the typed `PushChannelDef` from contracts-parse. This means push channels are **already type-validated at the emit site**, even though they don't use `registerPush()` from the registrar.

Active push-gateway usage (already typed):
- `canvasGenerationProgressChannel`, `canvasGenerationCompleteChannel`, `canvasGenerationFailedChannel` (canvas-generation.handlers.ts)
- `aiStreamChannel`, `aiEventChannel` (ai.handlers.ts)
- `clipboardAiDetectedChannel` (clipboard-watcher.ts)
- `loggerEntryChannel` (electron.ts)
- `appReadyChannel` (electron.ts)
- `updater*` channels (auto-updater.ts)

The push-gateway internally calls `parseStrict()` on payloads before `webContents.send()`, providing the same validation as `registerPush()` would. The difference is that `registerPush()` from the registrar is not used in production code (only in tests).

---

## Migration Steps Per Channel (5-Step Process)

For each raw `ipcMain.handle('channel:name', fn)` handler:

### Step 1: Locate the channel definition

Find the matching `defineInvokeChannel` in `packages/contracts-parse/src/ipc/channels/batch-NN.ts`. All 167 invoke channels already have zod schemas defined.

### Step 2: Import the channel def and registrar

```ts
import { registerInvoke, type RegistrarDeps } from '../../features/ipc/registrar.js';
import { myChannel } from '@lucid-fin/contracts-parse';
```

### Step 3: Update function signature

Change handler function to accept `RegistrarDeps` instead of bare `IpcMain`:

```ts
// Before
export function registerFooHandlers(ipcMain: IpcMain, db: SqliteIndex): void {

// After
export function registerFooHandlers(deps: RegistrarDeps, db: SqliteIndex): void {
```

### Step 4: Replace `ipcMain.handle` with `registerInvoke`

```ts
// Before
ipcMain.handle('foo:bar', async (_e, args: { id: string }) => {
  return db.repos.foo.get(args.id);
});

// After
registerInvoke(deps, fooBarChannel, async (_ctx, req) => {
  return db.repos.foo.get(req.id);
});
```

Key differences:
- First argument is `InvokeContext` (not IpcMainInvokeEvent)
- Second argument is already parsed and validated by zod
- Return value is validated against response schema
- Errors are wrapped in `LucidError` automatically
- Manual input validation (`if (!args || typeof args.id !== 'string')`) can be removed

### Step 5: Update call sites

Update the registration call in `electron.ts` to pass `RegistrarDeps` instead of `ipcMain`:

```ts
// Before
registerFooHandlers(ipcMain, db);

// After
registerFooHandlers(registrarDeps, db);
```

---

## Priority Recommendations

### Priority 1 — Quick wins (simple CRUD, no streaming)

These handlers are trivial to migrate — they have simple request/response shapes with no streaming or side effects:

1. **settings.handlers.ts** (2 channels) — Already has batch-01 schemas
2. **script.handlers.ts** (4 channels) — Already has batch-01 schemas
3. **style.handlers.ts** (2 channels) — Already has batch-03 schemas
4. **process-prompt.handlers.ts** (4 channels) — Already has batch-12 schemas
5. **workflow.handlers.ts** (11 channels) — Already has batch-06 schemas
6. **job.handlers.ts** (5 channels) — Already has batch-05 schemas

**Estimated effort**: ~28 handlers, low risk, ~1-2 hours

### Priority 2 — Entity CRUD (medium complexity)

These have more fields and reference-image sub-operations:

1. **character.handlers.ts** (8 channels) — batch-02 schemas
2. **equipment.handlers.ts** (6 channels) — batch-02 schemas
3. **canvas.handlers.ts** (7 channels) — batch-07 schemas
4. **preset.handlers.ts** (6 channels) — batch-08 schemas
5. **snapshot.handlers.ts** (8 channels) — batch-10 schemas
6. **keychain.handlers.ts** (5 channels) — batch-10 schemas
7. **color-style.handlers.ts** (4 channels) — batch-03 schemas (uses `safeHandle` wrapper, needs removal)

**Estimated effort**: ~44 handlers, medium risk, ~3-4 hours

### Priority 3 — Asset and storage (filesystem interactions)

These touch the filesystem and have more complex validation:

1. **asset.handlers.ts** (8 channels) — batch-04/batch-10 schemas
2. **embedding.handlers.ts** (3 channels) — batch-10 schemas
3. **storage.handlers.ts** (11 channels) — batch-04 schemas
4. **folder.handlers.ts** (24 channels) — batch-12 schemas (dynamic loop needs refactoring)
5. **backup.handlers.ts** (3 channels) — batch-10 schemas
6. **data.handlers.ts** (3 channels) — batch-10 schemas

**Estimated effort**: ~52 handlers, medium-high risk, ~4-5 hours

### Priority 4 — Complex/streaming handlers

These use push-gateway for streaming, have complex state management, or have large handler bodies:

1. **commander.handlers.ts** (2 channels) — batch-09 schemas, streaming via push-gateway
2. **commander-meta.handlers.ts** (8 channels) — batch-09 schemas
3. **ai.handlers.ts** (5 channels) — batch-10 schemas, streaming
4. **canvas-generation.handlers.ts** (3 channels) — batch-08 schemas, push-gateway for progress
5. **export.handlers.ts** (7 channels) — batch-10 schemas, filesystem-heavy
6. **render.handlers.ts** (3 channels) — batch-10 schemas
7. **ffmpeg.handlers.ts** (3 channels) — batch-10 schemas
8. **video-clone.handlers.ts** (2 channels) — batch-10 schemas
9. **video-chain.ts** (1 channel) — batch-10 schemas
10. **vision.handlers.ts** (1 channel) — batch-10 schemas
11. **lipsync.handlers.ts** (2 channels) — batch-10 schemas
12. **entity.handlers.ts** (1 channel) — batch-03 schemas

**Estimated effort**: ~39 handlers, higher risk, ~5-6 hours

### Priority 5 — electron.ts miscellaneous (9 channels)

These are one-off handlers in electron.ts (updater, logger, app, clipboard, shell, analytics). Low business value to migrate but keeps the codebase consistent.

**Estimated effort**: ~9 handlers, low risk, ~1 hour

---

## Blocking Issues

### Preload cutover dependency

As noted in the `IpcChannelMap` deprecation comment (ipc.ts lines 56-77):

> Deletion [of IpcChannelMap] is gated on the preload runtime cutover: renderer must first migrate from the hand-written `apps/desktop-main/src/preload.cts` to `preload.generated.cts` (positional-arg to single-object-arg form) and from the hand-written `apps/desktop-renderer/src/types/global.d.ts` shape to `LucidAPI` from `lucid-api.generated.ts`.

This means even after all handlers are migrated to `registerInvoke`, the legacy `IpcChannelMap` type cannot be removed until the renderer-side preload is also migrated. The handler migration and the preload cutover can proceed in parallel but both must complete before the legacy types are deleted.

### safeHandle wrapper

`color-style.handlers.ts` uses `safeHandle()` from `ipc-error-handler.ts` instead of raw `ipcMain.handle()`. This is a thin error-wrapping layer. When migrating to `registerInvoke`, `safeHandle` is no longer needed because the registrar already wraps errors in `LucidError`.

---

## Total Count Summary

| Category | Handlers |
|----------|----------|
| Already migrated (`registerInvoke`) | 5 |
| Raw `ipcMain.handle` (needs migration) | ~168 |
| `safeHandle` wrapper (needs migration) | 4 |
| Push channels (push-gateway, already type-validated) | ~12 emit sites |
| **Total invoke handlers** | **~177** |
