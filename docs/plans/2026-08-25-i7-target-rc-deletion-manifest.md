# I7 Target-only RC v3 Closure and Exhaustive Legacy Deletion Manifest

## Status and non-authority

I7 proof is implemented against disposable data and clean temporary build roots. This document does
not authorize access to real databases/media, a real migration, the official Electron switch,
packaging, installation, release, or physical deletion. Every Legacy item below remains retained until
the corresponding I8 gate is explicitly approved.

## Target-only RC boundary

The independent candidate has three source entrypoints:

1. `apps/desktop-main/src/target/electron-entry.ts`
2. `apps/desktop-main/src/target/preload.generated.cts`
3. `apps/desktop-renderer/src/target-entry.tsx`

Clean emit produces four runtime entrypoints: the main entry, CommonJS preload, renderer `index.html`,
and the renderer entry chunk. RC v3 records those separately from `emittedAuditRoots`, which contains
every emitted JavaScript, CommonJS, ESM, HTML, and CSS artifact. An otherwise unreachable emitted
runtime file therefore remains inside the audit rather than being hidden by entrypoint traversal.

The main entry accepts typed, injectable Target production adapters and routes them through the Target
Electron host. There is deliberately no default production-adapter composition. Direct RC startup
fails with `TargetRcProductionAdaptersUnavailableError` and stable code
`target_rc_production_adapters_unavailable`; it cannot fall back to the current Legacy application or
return a synthetic success. The renderer also fails closed when the Target preload bridge is absent.

The Electron host binds IPC to the exact trusted renderer WebContents/frame/URL, uses an isolated
session partition, denies permission requests, and owns the Target CSP. Media bytes cross that boundary
only through expiring opaque `lucid-target-media:` capabilities; the custom protocol verifies CAS
identity and implements GET, HEAD, and one byte range without exposing source paths or hashes. These
boundaries are code/test evidence only: I7 did not launch or install the native Electron shell.

The generated wire has exactly 45 invoke methods plus one push method and the model catalog remains
exactly 40 tools. Delivery operation state, cancellation, usage/errors/artifacts/receipts, and protected
confirmation are on that one wire. Confirmation events retain both the Run interaction ID and the
separate persisted confirmation ID; the renderer replies with the confirmation ID and immutable input
hash.

`apps/desktop-main/tsconfig.target-rc.json`,
`apps/desktop-main/tsconfig.target-rc-preload.json`,
`apps/desktop-renderer/tsconfig.target-rc.json`, and the Target Vite configuration are the isolated app
inputs. Package exports for `@lucid-fin/target-contracts`, `@lucid-fin/target-storage`, and
`@lucid-fin/target-runtime` are resolved from clean temporary emits, never from worktree `dist`.
Non-workspace runtime dependencies are derived from hashed Target package manifests. Exact package
exports are aliased longest-subpath first and deduped, while wildcard exports are rejected. The
renderer imports canonical serialization through the Zod-free
`@lucid-fin/target-contracts/canonical-json` subpath, preventing Zod's `Function` capability from
entering the emitted renderer closure.

## RC v3 proof

Run from the repository root after Target edits are settled:

```powershell
pnpm exec tsx scripts/check-target-only-rc.ts
pnpm exec tsx scripts/build-target-rc.ts
```

Both commands use the same source preflight. The source gate resolves static imports, export-from
edges, literal dynamic imports, literal `require` calls, triple-slash references, effective tsconfig
files/types/typeRoots/paths, workspace package exports, package manifests, the lockfile, and build-tool
versions. It also audits every parsed tsconfig root and the exact Vite config/plugin contract. A
non-literal `import()` or `require()`, Vite glob loader, or ordinary direct/property/simple-alias
dynamic-code capability is rejected in audited source. The one emitted helper exception is exact,
emitted-only, and limited to the known Vite/React Router helper; it cannot authorize a source loader.

The isolated operation then:

1. snapshots the complete Target source/input closure;
2. clean-emits Target contracts, storage, runtime, main, preload, and renderer into a newly created
   temporary root;
3. audits every emitted JavaScript, CommonJS, ESM, HTML, and CSS root plus the package-export closure;
4. traverses renderer HTML `script`, `modulepreload`, and stylesheet edges, CSS `@import`, and local
   `url(...)` assets;
5. rejects unresolved, absolute/out-of-root, symlink, junction, reparse, non-target workspace, and
   Legacy edges;
6. binds Rolldown's `cwd` to the isolated tree and rejects any JS/CSS/HTML that leaks its random path
   marker, keeping non-minified module labels deterministic;
7. reruns source preflight and compares the entire input snapshot after emit and again before an audit
   or metadata result is returned;
8. removes the temporary root and rejects cleanup failure.

This closes the type-only-import gap: a Legacy import added during emit is rejected even if TypeScript
would erase it. Any ordinary Target source drift during the operation also invalidates the candidate.
`check-target-only-rc.ts` reports `lucid-fin.target-rc-closure/v3`; `build-target-rc.ts` reports
`lucid-fin.target-rc-build/v3`. The build metadata binds the distinct runtime-entrypoint and
emitted-audit-root sets. The build writes no worktree `dist`, package, installer, or release and
does not launch Electron.

Three consecutive serial builds after every fixture worker stopped produced the same frozen evidence:

- closure SHA-256: `a22bac8ae94d2328cb6eb274b1a535e55f569d9a3405f50316dbe3170f15bce9`;
- input SHA-256: `9bda767fcf35a51c7db7536aa16fdbbed8645f1269c8a819d1de33a398a461c9`;
- metadata SHA-256: `f672fe3e398b1c05f67704bb5eedad7f6802ece7f58d495d5ad8b5b043c3c22b`;
- four runtime entrypoints, 187 emitted audit roots/closure files, 217 bound inputs, nine
  configurations, and 718 emitted artifacts.

The complete validation ledger and disposable migration evidence are in
[`2026-08-25-i7-completion-evidence.md`](./2026-08-25-i7-completion-evidence.md).

## Machine-readable exhaustive manifest

The checked-in `scripts/i0-baseline.manifest.json` is incorporated into this deletion manifest in
full. It individually names every frozen Legacy schema object, tool, model tool, IPC channel, route,
and localStorage key and assigns one disposition to each item. It is not a six-row category summary.
`scripts/i0-baseline.ts --inventory` independently discovers each name and its source path, while
`--check` verifies exact membership, per-section SHA-256, column coverage, contract hashes, and that
every discovered item matches exactly one disposition.

The frozen inventory contains:

| Section                                              | Individually named items | Machine disposition authority                      |
| ---------------------------------------------------- | -----------------------: | -------------------------------------------------- |
| SQLite tables, virtual tables, indexes, and triggers |                      106 | `schemaObjects` plus exhaustive `columns` policies |
| Legacy callable tools                                |                       82 | `tools`                                            |
| Legacy model-visible tools                           |                       50 | `modelTools`                                       |
| Legacy invoke/push/reply IPC channels                |                      165 | `channels`                                         |
| Legacy renderer routes                               |                        2 | `routes`                                           |
| Legacy localStorage keys                             |                       10 | `localStorage`                                     |

The manifest section hashes are:

- schema: `e7019fdadaa70aab9d2acb93591c0a6a7b01d65d8e61284b17e91e5a64cef53d`
- tools: `63dc4ee13ba1d08644adf20a7de810cb7d64044a30c7db0f6581b2aa0f168bfd`
- model tools: `9335285e1adacca861be1c211e5798908019a3cc0ad304c65db6aed6a1c44b10`
- IPC channels: `596199b7fdf5881d53fb2e4925dc4637f6cceffb6516862bc012aa235a31ebb9`
- routes: `f905b6ec88f63018777bd54039b62b29686b72d72b43aa122693ae7785ebda46`
- localStorage: `6bffe5018d14f23b76919beb3905d95d493009f3b18092ccb4ed55a5a868c30e`

## Complete Legacy source-path deletion units

These are manifest units, not shell globs authorized for deletion. Gate C must expand them to exact
canonical files, identities, sizes, and hashes before asking for destructive approval.

### Schema and persistence

- `packages/storage/src/schema-sql.ts`
- `packages/storage/src/fts-batch.ts`
- `packages/storage/src/process-prompt-store.ts`
- `packages/storage/src/prompt-store.ts`
- `packages/storage/src/repositories/**`
- `packages/contracts-parse/src/storage/**`
- `packages/contracts-parse/src/schemas/**`
- `packages/contracts-parse/src/dto/**`
- `packages/contracts-parse/src/brands/**`

This unit covers all 39 supported source tables, their 67 derived indexes/triggers/FTS objects, every
column policy, Legacy backup/repository access, and the old Canvas-as-Project ownership model. The
exact object names and dispositions are the 106 `schemaObjects` entries in the machine manifest.

### API, IPC, preload, and official Legacy entrypoints

- `apps/desktop-main/src/electron.ts`
- `apps/desktop-main/src/preload.cts`
- `apps/desktop-main/src/ipc/**`
- `apps/desktop-main/src/services/**`
- `packages/contracts-parse/src/ipc/channels/batch-01.ts`
- `packages/contracts-parse/src/ipc/channels/batch-02.ts`
- `packages/contracts-parse/src/ipc/channels/batch-03.ts`
- `packages/contracts-parse/src/ipc/channels/batch-04.ts`
- `packages/contracts-parse/src/ipc/channels/batch-06.ts`
- `packages/contracts-parse/src/ipc/channels/batch-07.ts`
- `packages/contracts-parse/src/ipc/channels/batch-08.ts`
- `packages/contracts-parse/src/ipc/channels/batch-09.ts`
- `packages/contracts-parse/src/ipc/channels/batch-10.ts`
- `packages/contracts-parse/src/ipc/channels/batch-12.ts`
- `packages/contracts-parse/src/ipc/channels/batch-13.ts`
- `packages/contracts-parse/src/ipc/channels/batch-14.ts`
- `packages/contracts-parse/src/ipc/channels/health.ts`
- `packages/contracts/src/**`

The exact 165 channel names and invoke/push/reply kinds are individually recorded under `channels`.
The current official entrypoints are retained before Gate B; no I7 proof changed package `main` or the
installed application.

### Legacy tools, Commander runtime, and workflow/phase machinery

- `packages/agent/src/agent/subagent-tools.ts`
- `packages/agent/src/agent/tool-program.ts`
- `packages/agent/src/agent/tools/**`
- `packages/agent/src/agent/task-list-tool-policy.ts`
- `packages/agent/src/agent/exit-contract/**`
- `packages/task-execution/src/task-list-registry.ts`
- `packages/task-execution/src/task-list-planner.ts`
- `packages/task-execution/src/register-default-task-lists.ts`
- `packages/task-execution/src/task-lists/**`
- `apps/desktop-main/src/ipc/handlers/commander-*.ts`
- `apps/desktop-main/src/ipc/handlers/task-list.handlers.ts`
- `apps/desktop-main/src/ipc/handlers/persistent-task-list-guard.ts`
- `apps/desktop-renderer/src/commander/**`
- `apps/desktop-renderer/src/store/slices/commander.ts`
- `apps/desktop-renderer/src/store/slices/task-lists.ts`
- `apps/desktop-renderer/src/store/middleware/commander-session-persistence.ts`

The 82 callable and 50 model-visible tool IDs are individually named in `tools` and `modelTools`.
This includes old fixed film phase/task-list planning. Target TaskList remains optional Commander
progress and imported Legacy workflow records remain non-schedulable history.

### Legacy renderer UI and routes

- `apps/desktop-renderer/src/main.tsx`
- `apps/desktop-renderer/src/App.tsx`
- `apps/desktop-renderer/src/pages/CanvasPage.tsx`
- `apps/desktop-renderer/src/pages/SettingsCommanderSection.tsx`
- `apps/desktop-renderer/src/components/canvas/**`
- `apps/desktop-renderer/src/components/settings/**`
- `apps/desktop-renderer/src/hooks/useCommander.ts`
- `apps/desktop-renderer/src/hooks/useCanvasKeyboard.ts`
- `apps/desktop-renderer/src/hooks/useCanvasDragDrop.ts`
- `apps/desktop-renderer/src/store/slices/canvas/**`
- `apps/desktop-renderer/src/store/slices/canvas.*.ts`

The two individually inventoried routes are `/` and `/settings`. The Target renderer entry and
`apps/desktop-renderer/src/target/**` are replacements and are excluded from this deletion unit.

### Prompts, presets, templates, guides, and user-created Skills

- `packages/application/src/prompt-compiler.ts`
- `packages/application/src/prompt-compiler-types.ts`
- `packages/application/src/template-manager.ts`
- `packages/application/src/preset-export.ts`
- `packages/contracts/src/dto/presets/**`
- `packages/storage/src/prompt-store.ts`
- `packages/storage/src/process-prompt-store.ts`
- `packages/storage/src/repositories/preset-repository.ts`
- `packages/storage/src/repositories/process-prompt-repository.ts`
- `packages/storage/src/repositories/shot-template-repository.ts`
- `packages/agent/src/agent/tools/prompt-tools.ts`
- `packages/agent/src/agent/tools/preset-tools.ts`
- `packages/agent/src/agent/tools/canvas-preset-tools.ts`
- `packages/agent/src/agent/tools/task-list-guides.ts`
- `apps/desktop-main/src/ipc/handlers/generation-prompt-compiler.ts`
- `apps/desktop-main/src/ipc/handlers/preset.handlers.ts`
- `apps/desktop-main/src/ipc/handlers/preset.service.ts`
- `apps/desktop-main/src/ipc/handlers/process-prompt.handlers.ts`
- `apps/desktop-renderer/src/store/slices/skillDefinitions.ts`
- `apps/desktop-renderer/src/store/slices/presets.ts`
- `apps/desktop-renderer/src/store/slices/shotTemplates.ts`
- `apps/desktop-renderer/src/components/canvas/PresetManagerPanel.tsx`
- `apps/desktop-renderer/src/components/canvas/ShotTemplateManagerPanel.tsx`
- `apps/desktop-renderer/src/components/settings/SettingsGuidesSection.tsx`
- `apps/desktop-renderer/src/components/settings/SettingsProcessPromptsSection.tsx`

The canonical replacement is the generated Target built-in Skill pack plus trusted package authority.
Legacy database overrides/custom templates and renderer Skill customizations are migrated as
`unreviewed`, quarantined, and disabled; known global settings are preserved once in the private
offline export; unknown setting keys block migration. The Target migration/evidence modules that parse
Legacy records are retained until Gate C evidence retention is separately decided and are not callable
Target runtime resources.

### Browser-local state

The exact ten keys are individually named in `localStorage`. Their source paths are:

- `apps/desktop-renderer/src/commander/state/constants.ts`
- `apps/desktop-renderer/src/components/canvas/commander/CommanderHints.tsx`
- `apps/desktop-renderer/src/i18n.runtime.ts`
- `apps/desktop-renderer/src/store/slices/skillDefinitions.ts`
- `apps/desktop-renderer/src/store/slices/ui.ts`

Their dispositions distinguish preferences sealed for later Target settings review, session/Skill
evidence, and obsolete panel/onboarding/first-session state eligible for deletion only after cutover
approval. I7 records and validates these values but does not apply preferences to a real Target user
profile; that is Gate B work.

Snapshot v2 requires one branded trusted-reader result for every key, with an explicit `present`,
`absent`, or `capture_error` state. `capture_error` blocks sealing and cannot be reclassified as absent.
The private canonical snapshot binds capture run/session IDs, normalized Chromium profile path,
canonical origin (`opaque:file` for file storage), fresh challenge, timestamp, raw values, per-value
hashes, and a snapshot fingerprint.
Only irreversible run/session/profile/challenge fingerprints, canonical origin (`opaque:file` for file
storage), timestamp, per-value raw hashes, and public fingerprints may leave that private boundary.
An absent Skills key maps to the canonical empty renderer export. Session evidence is reduced to
stable Chat/Message IDs and must exactly match the canonical SQLite mirror; divergence is blocking and
has no merge path. Publication uses an exclusive temporary file and atomic hard-link/no-replace; there
is no rename fallback. The collector that proves the exact real Chromium
WebContents/profile/session/origin is intentionally absent and requires Gate A authorization and
review before any real capture.

### Real user objects

Legacy SQLite databases, prompt databases, media roots, offline exports, backups, credentials, and
installed application files are deliberately absent from the checked-in path list. They cannot be
named until Gate A authorizes read-only discovery. They may appear in a Gate C deletion request only
with exact path/identity/size/hash evidence and a separate physical-disposal approval.

## Zero-reference and schema audit

The I7 claim is narrowly defined and reproducible:

- RC v3 source preflight proves no Target production entry imports a non-target app source,
  non-target `@lucid-fin/*` package, unresolved source, compatibility alias, or out-of-root path.
- Clean package/app emits plus JS/HTML/CSS/local-asset traversal prove the emitted candidate has the
  same property and does not depend on stale worktree `dist`.
- Pre/post source snapshots prevent an edit from racing the proof.
- Target contract, DDL, tool catalog, preload, runtime, main, renderer, migration, and target-native
  replay tests independently validate the canonical authorities, 45 invoke/one push wire methods, and
  exact 40 model tools.
- `scripts/i0-baseline.ts --check` proves the Legacy side of the future deletion set has not drifted
  outside its one-to-one manifest.

This is zero callable/discoverable Legacy closure for the Target RC, not repository-wide deletion.
Repository-wide zero Legacy can be claimed only after Gate B switches the official entries and Gate C
physically removes the exact approved objects.

## Deletion status and remaining gates

All manifest units are `retained / not authorized / not performed`. The official Electron main,
preload, renderer entry, package/release configuration, Legacy code, and user data remain unchanged.
Gate A may authorize a real final copy; Gate B may authorize the official atomic switch; Gate C may
later authorize exact physical disposal. Passing RC v3, a disposable migration, or this manifest does
not imply any of those approvals.
