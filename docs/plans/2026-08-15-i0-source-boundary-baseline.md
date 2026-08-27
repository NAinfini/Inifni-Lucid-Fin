# I0 Source Boundary and Baseline Report

## Status and authority

This is the read-only implementation baseline for the ground-up Lucid Fin AI video production
Harness. It freezes the accepted target contracts and classifies the current implementation before
target contracts or product code are written.

This report does not authorize opening or writing the real user database, reading the real media
root, calling a Provider, deleting Legacy data or code, migrating a database, committing, packaging,
installing, or releasing. All fixtures are synthetic and disposable.

The target is not a compatibility layer around the current Canvas-first application. Existing symbols
below are migration evidence only. I1-I7 must create and prove the target architecture in dependency
order; I8 remains separately approval-gated.

## Frozen contract manifest

Hashes are SHA-256 over the exact UTF-8 file bytes after correcting the I0 contract count from six to
seven.

| Contract                                                        | SHA-256                                                            |
| --------------------------------------------------------------- | ------------------------------------------------------------------ |
| `docs/plans/2026-08-15-project-first-lucid-fin.md`              | `650C5708AFDFFAD797C9D941EED8F6107DC5FD19287C483B94CEDB689007162F` |
| `docs/design/project-shell-screen-contract.md`                  | `C6932D80483FEA8B9BB11759A1A4AA2275165BF7100F1C56EE95168CADD6CA7D` |
| `docs/design/project-workspaces-contract.md`                    | `EE64063C8A959DD351DC6D1E7F0A74A5A1213A6D79A9470733E318C9D1FADA62` |
| `docs/plans/2026-08-15-project-data-history-memory-cutover.md`  | `0EFAFF00BC3457960FC181862D869DB5DC04EA95B1C71EEBD52B1511D19C37B8` |
| `docs/plans/2026-08-15-commander-runtime-tool-surface.md`       | `059F199958113F378AA8BF55D42F6CEEFE19FEF57D42E6EF2F4BBA8129FE75C8` |
| `docs/plans/2026-08-15-film-tool-catalog-contract.md`           | `20D1CB99636CEC749FDD969D24219B11471CBE889238FDB9E6A93225711B801B` |
| `docs/plans/2026-08-15-project-first-implementation-program.md` | `61528887832ADC725824DA9F393EE77E6388A67E9589DEC2B6C8929E98AAA749` |

`scripts/i0-baseline.ts --check` is the machine owner of this manifest. Any contract edit must first be
reviewed as a contract change and then update the frozen hash deliberately; silent drift fails.

## Evidence boundary

The inventory was derived only from repository source, contracts, package scripts, and test names. It
did not open an application database, enumerate the user's asset directory, inspect credentials, or
call a Provider.

The current worktree already contains a large set of unrelated modified, deleted, and untracked files.
I0 preserves them and treats broad build/test results as an integration-worktree baseline, not as
evidence that I0 created those changes. I0-owned files are limited to this report, the frozen manifest,
the checker, and its tests.

### External Harness reference

I0 pinned DeepSeek Harness commit `47f943859bef60e4160492346772ded9b24f765a` and reviewed these
official subsystem contracts:

- [Core](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/docs/subsystems/core.md)
- [Session](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/docs/subsystems/session.md)
- [Tools](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/docs/subsystems/tools.md)
- [Compaction](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/docs/subsystems/compaction.md)
- [Subagents](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/docs/subsystems/subagent.md)

No local DeepSeek Harness clone, submodule, or repository remote was found in the inspected workspace
and common local checkout roots. The comparison is therefore against the pinned official source, not
a claim that a local fork or runtime was audited. Adopted invariants and explicit non-goals are frozen
in the implementation program.

## Current durable sources

| Source                    | Current owner/evidence                                            | Target disposition                                                                                                   |
| ------------------------- | ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `APP_DIR/lucid-fin.db`    | `packages/storage/src/schema-sql.ts`, repositories, `SqliteIndex` | One-way transform into the canonical target Project store in I2/I7; never updated in place during rehearsal          |
| `APP_DIR/prompts.db`      | `PromptStore`, `ProcessPromptStore`                               | Export user-authored values once; reviewed expertise may become immutable Skills; no target runtime store            |
| `APP_DIR/assets`          | `CAS`, `asset_contents`, hash references                          | Verify and preserve immutable bytes as `MediaBlob`; rebuild catalog and Project relationships separately             |
| OS keychain / OAuth state | `Keychain`, Provider OAuth manager                                | Preserve only through user-managed Provider Settings; never expose to model, export, or fixtures                     |
| renderer localStorage     | Commander mirrors, settings, skills and UI preferences            | Migrate only authoritative user preferences/evidence described below; delete obsolete mirrors after verified cutover |
| logs, backups and exports | storage/data handlers                                             | Never become Project truth; retain/export according to user action and release recovery policy                       |

### Declared SQL and virtual-table dispositions

Every column inherits its table disposition unless an explicit split follows this table. The checker
enumerates all actual columns and applies exactly one final disposition.

| Current table               | Target owner/disposition                                                                                                 |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `task_lists`                | immutable `ImportedTaskListHistory`; never a live Run-owned target `TaskList`                                             |
| `tasks`                     | immutable `ImportedTaskItemHistory`; no target workflow or fixed production phase semantics                              |
| `task_dependencies`         | typed `ImportedHistoryRecord` dependency evidence only                                                                   |
| `task_artifacts`            | typed `ImportedHistoryRecord`; independently verified media may also become canonical media owners                       |
| `plan_documents`            | typed imported plan evidence; never a target Production revision without a proven owner                                  |
| `plan_approvals`            | typed imported approval evidence; never a `UserChoice` without exact before/after authority                              |
| `task_events`               | append-only imported task evidence; never a target `RunEvent`                                                            |
| `task_decisions`            | imported interaction evidence; no fabricated target question or `UserChoice`                                             |
| `task_attempts`             | imported attempt evidence with provider-unknown state preserved; never a live target operation                           |
| `task_evaluations`          | imported evaluation evidence; never an automatic subjective selector                                                     |
| `prompt_assemblies`         | imported prompt provenance; never a target attempt/result unless all required target owners already exist               |
| `asset_contents`            | `MediaBlob` technical metadata keyed by verified content hash                                                            |
| `asset_entries`             | `GlobalMediaAsset`; folder membership is a `GlobalMediaFolder` link and proven Project use is separate `ProjectMediaRef` |
| `characters`                | Project-scoped `ProductionObject(character)`                                                                             |
| `equipment`                 | Project-scoped `ProductionObject(equipment)`                                                                             |
| `locations`                 | Project-scoped `ProductionObject(location)`                                                                              |
| `character_folders`         | Production collection metadata when ownership is deterministic                                                           |
| `equipment_folders`         | Production collection metadata when ownership is deterministic                                                           |
| `location_folders`          | Production collection metadata when ownership is deterministic                                                           |
| `asset_folders`             | `GlobalMediaFolder` hierarchy metadata                                                                                   |
| `scripts`                   | Project-scoped Production story/script objects                                                                           |
| `dependencies`              | typed Production relationships; ambiguous generic relations block migration                                              |
| `color_styles`              | bound Production Direction/result provenance; unbound values go to offline Legacy export                                 |
| `project_settings`          | explicit key registry splitting global and Project settings; unknown keys block                                          |
| `canvases`                  | split into Project, Canvas document, Production Direction, Project settings, and Delivery intent                         |
| `delivery_asset_refs`       | Project-scoped Delivery/Media relationships                                                                              |
| `canvas_nodes`              | spatial placement plus typed references; mixed `data_json` is transformed by node kind or blocks                         |
| `canvas_edges`              | Canvas spatial edge unless a valid typed Production relation proves another owner                                        |
| `custom_shot_templates`     | one-time `Skill` catalog registration; unreviewed content is quarantined and never auto-enabled                          |
| `preset_overrides`          | built-in/custom/override `Skill` catalog versions; dynamic content is quarantined and never auto-enabled                 |
| `commander_sessions`        | `Chat` identity and public `Message` evidence; derived context is not imported                                           |
| `snapshots`                 | offline backup only; no target runtime restore authority                                                                 |
| `commander_events`          | append-only `ImportedRunEventHistory`; private bytes remain in restricted offline evidence                               |
| `commander_runs`            | non-schedulable `ImportedRunHistory` with original parent/retry lineage and terminal evidence                            |
| `commander_run_canvases`    | imported Run scope evidence; never a target `ContextManifest`                                                            |
| `commander_run_attachments` | imported attachment evidence linked to independently verified target media identities                                   |
| `process_prompts`           | canonical built-in `Skill` identity plus quarantined override version when customized; Legacy table deleted              |
| `t_prompt_overrides`        | canonical prompt-template `Skill` identity plus quarantined override version; Legacy table deleted                       |
| `asset_entries_fts`         | derived search index; never migrated as authority, rebuilt from target media catalog                                     |

Derived indexes, FTS shadow tables, and triggers are rebuilt from canonical target DDL and never treated
as migration authorities.

Imported Run and Task records are a read-only evidence ledger. They are excluded from the Run
Coordinator, Dispatcher, recovery, model context, search, Memory, and the 40-tool catalog. A separate
target-native synthetic Run proves inbox, activation, catalog, compaction, and replay behavior; the
migration must not claim that Legacy records possessed those target-only invariants.

The Skill cutover is catalog migration, not automatic activation. The exact 287 built-in records are
registered from the immutable generated pack. Legacy database and renderer customizations become
`unreviewed` Skill versions, receive Host quarantine records, and remain ineligible for Project
enablement until reviewed. The target never restores the old preset/template/prompt managers or
silently injects these Skills into a Run.

### Required column splits

- `canvases.id/name/archived_at/created_at/updated_at` become Project identity/lifecycle.
- `canvases.viewport/notes` become Canvas document state and typed spatial annotations.
- `canvases.style_plate/negative_prompt/visual_style_policy_json` become Production Direction or
  result provenance only when causation is proven.
- `canvases.default_*/publish_*/resolution_policy_json/aspect_ratio` split between Project generation
  defaults and Delivery intent by key meaning.
- `canvases.*_provider_id` become Project Provider defaults, never credentials.
- `canvases.delivery_sequence_*` becomes Delivery revision state.
- `canvas_nodes.id/canvas_id/type/position_*/width/height/z_index/created_at/updated_at` become Canvas
  placement identity; `data_json` must be parsed by strict node kind into Production, Media, Result,
  Attempt, annotation, or blocking evidence.
- `commander_sessions.id/title/created_at/updated_at/default_canvas_id` become Chat identity and Project
  resolution evidence; `messages` becomes ordered public Messages; `context_graph_json` is discarded
  and Project Memory is rebuilt from cited evidence.
- `asset_contents.hash/type/format/file_size/width/height/duration/has_audio/created_at` become MediaBlob
  technical facts. Prompt/Provider/generation metadata move only with an exact GeneratedResult/Attempt
  binding.
- `asset_folders.id/parent_id/name/sort_order/created_at/updated_at` become the GlobalMediaFolder
  hierarchy; invalid, orphan, self-referential, or cyclic folders block migration.
- `asset_entries.asset_hash` references the MediaBlob; entry identity/catalog metadata remains Global
  Media; `folder_id` is a GlobalMediaFolder link, and Project usage is a separate relationship that
  cannot be inferred from the entry alone.

## Renderer localStorage dispositions

| Key                                  | Target disposition                                                                                                                       |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `lucid-commander-sessions-v1`        | Chat migration evidence only; compare by stable IDs against SQLite/public events, and block on an irreconcilable user-visible divergence |
| `lucid-commander-provider-v1`        | user Provider preference in target Settings                                                                                              |
| `lucid-commander-settings-v1`        | explicit allowlisted Commander preference migration; obsolete tuning keys deleted                                                        |
| `lucid-skills-v2`                    | one-time Skill catalog registration plus raw offline export; custom/override content is quarantined and never auto-enabled or injected   |
| `lucid-fin:locale`                   | target locale preference                                                                                                                 |
| `lucid-fin:theme`                    | target appearance preference                                                                                                             |
| `lucid-fin:onboarding-complete`      | delete; target first-run state is derived from Project availability                                                                      |
| `lucid-fin:left-canvas-panel-width`  | delete with legacy shell                                                                                                                 |
| `lucid-fin:right-canvas-panel-width` | delete with legacy shell                                                                                                                 |
| `lucid-commander-first-session-seen` | delete with legacy hint UI                                                                                                               |

## Runtime and repository boundary map

| Current seam                                              | Target disposition                                                                                                  |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `AgentOrchestrator`                                       | replace with target Agent Loop under Run Coordinator; transplant only tested provider-stream/cancellation mechanics |
| `ToolRegistry` and 50-tool registration                   | replace with the exact content-addressed 40-tool catalog                                                            |
| `ToolExecutor`                                            | converge into the single Dispatcher; remove TaskList/phase/special bypass logic                                     |
| `registerAgentTools` plus desktop `registerAllTools`      | one target catalog builder; delete both old registration paths after cutover                                        |
| `ToolRegistrationDeps`                                    | split into target domain command ports; delete the cross-domain dependency bag                                      |
| `ContextManager` and `commander-context.service`          | replace with immutable Context Manifest plus event-derived model view                                               |
| `TaskExecutionEngine` and four fixed TaskList definitions | preserve evidence/attempt mechanics; delete fixed production workflow and continuation topology                     |
| `task-list-tool-policy`                                   | delete as authorization owner; target TaskList is optional progress only                                            |
| `commander.handlers` / runtime maps / wiring shims        | replace with target Run Coordinator and target-only composition root                                                |
| current recovery/event projection                         | transplant only after target contracts prove append-only public events, encrypted private recovery and exact replay |
| media/audio task services                                 | unify behind typed domain attempts and `OperationRef`; preserve prepared/submitted/unknown/idempotency facts        |
| in-memory Review Cut jobs                                 | reimplement as durable owner-backed operations; no restart-unsafe status map                                        |
| `PromptStore` / `ProcessPromptStore`                      | export reviewed user content, then delete both product authorities                                                  |
| `guide.get` and auto-injected renderer skills             | replace with immutable on-demand `skill.load`; no hidden injection                                                  |

## Tool surface disposition

The current model-visible registry is tested as 50 tools and also maintains a 16-ID exclusion list.
Neither set is the target contract. All current IDs are deleted or replaced after the target catalog is
live; capability hiding is not preserved as an autonomy mechanism.

| Current family                                                          | Target family                                                                                |
| ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `canvas.*`, entity, character, equipment, location, script, color style | `project.*`, `production.*`, `canvas.*`, `media.*`, `generation.*`, `result.*`, `decision.*` |
| asset tools                                                             | `media.query/inspect/derive/attach/link` with opaque accepted IDs, never paths               |
| prompt, preset, shot-template, guide and process tools                  | no target manager; reviewed expertise becomes Skills                                         |
| Provider/account mutation                                               | not model-callable; only `provider.capabilities` plus typed generation configuration         |
| fixed `task.*`, `runChecklist`, phase tools                             | optional `task.manage`; no production state machine                                          |
| `tool.get`                                                              | retained as target discovery over the frozen catalog                                         |
| `guide.get`                                                             | replaced by `skill.load`                                                                     |
| `tool.compact`                                                          | deleted; compaction is a host-derived model view                                             |
| subagent tools                                                          | reimplemented as `agent.spawn/send/wait/result/cancel` through Run Coordinator               |
| `tool.program`                                                          | transplant bounded AST only; every child call uses Dispatcher                                |
| logger, snapshot, raw import/export and file/path tools                 | no model capability; user UI or offline migration only                                       |

The normative target is exactly the 40 IDs in
`docs/plans/2026-08-15-film-tool-catalog-contract.md`. I1 must fail if definitions, registration, catalog
hashes, or the count differ.

## IPC, preload and visible surface disposition

- The current contracts-parse channel registry and generated preload are migration inventory. I1
  defines one target IPC contract; I5 generates preload and renderer types from it.
- Handwritten `ipcMain.handle`, direct `webContents.send`, the handwritten preload bridge, and the
  generated bridge may not coexist in the target path. Target use cases use the typed registrar and one
  typed push gateway.
- Existing channel families map to target Project, Chat, Canvas, Media, Production, Delivery, Run,
  Operation, Tool/Skill and Settings owners. `processPrompt:*`, preset/template managers, snapshot
  runtime restore, fixed TaskList mutation, raw storage path, and legacy Canvas-as-Project channels are
  deleted from the target bridge.
- Credential, OAuth, backup/restore, file picker and destructive storage actions remain user-only
  Settings capabilities and are never model tools.
- Current renderer routes are `/` (`CanvasPage`) and `/settings`. The target replaces `/` with Projects
  Home and Project-scoped Overview/Canvas/Media/Production/Delivery plus Chats and Commander Dock;
  exact target route IDs are frozen in I1 before I6 wiring.
- Current floating `CommanderPanel`, History panel, Canvas navigator, manager panels, preset/template
  panels, process-prompt Settings, and guide-injection Settings are not retained as target shell
  surfaces. Their authoritative data is migrated first; I6 then replaces the UI atomically.

## Media-byte and identity accounting strategy

No real byte count is performed in I0. Each disposable/copy migration report must provide:

1. SQL count and `SUM(file_size)` for `asset_contents`, with null/zero size listed separately.
2. CAS recursive regular-file count and byte total under the exact copied asset root.
3. SHA-256 of every file, matched to `asset_contents.hash`; duplicate bytes retain one MediaBlob and
   multiple catalog/Project references.
4. Counts of references from `asset_entries`, `delivery_asset_refs`, `task_artifacts`,
   `commander_run_attachments`, node payloads, entities, attempts, results and snapshots.
5. Orphan rows, orphan files, missing bytes, mismatched hashes and ambiguous path/URL references as
   blockers, never guessed repairs.
6. Derived media always receives a new immutable hash and provenance edge; local paths are never
   model-visible or persisted as target media identity.

## Provider-attempt boundary

- `task_attempts` and bound prompt/result/evaluation records are the current durable attempt evidence.
- Media, audio, Delivery package and Review Cut implementations currently mix durable rows with
  process-local polling maps. I2/I4 replace them with owner-backed `OperationRef` state.
- `prepared`, submitted receipt/job ID, idempotency key, request hash, quote/reservation, cost state and
  terminal result are preserved when present.
- `submitting` without a receipt, contradictory job IDs, or an unbound result is `unknown` and blocks
  automatic retry or cutover. No fixture performs network activity.

## Synthetic fixture matrix

| Fixture                              | Required evidence                                                                                  | Required gate                                              |
| ------------------------------------ | -------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Empty install                        | zero Projects/Chats/media, valid defaults, no credentials                                          | fresh target DDL/startup and first Project path            |
| Representative Legacy Canvas/Project | Canvas identity, mixed nodes, Production entities, Chat/messages, TaskList history, valid CAS refs | every record and column has one deterministic disposition  |
| Missing media                        | valid media reference with absent synthetic Blob                                                   | migration blocks while preserving source fixture           |
| Provider unknown                     | prepared/submitting attempt without authoritative receipt                                          | no resubmit; typed blocker and recovery evidence           |
| Protected choice                     | user-authored selected/protected result with revision and causation                                | exact confirmation is required before conflicting mutation |
| Corrupt/unsupported drift            | extra column or invalid FK/hash/sequence                                                           | fail before writes and leave fixture bytes unchanged       |

The fixture builder writes canonical JSON only to a caller-provided temporary directory. Fixture IDs,
times and hashes are fixed; it contains no absolute user path, credential, URL, Provider configuration,
or callable network endpoint.

## I1-I8 verification map

| Stage | Fixture/gate                                                                                                                                                      |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| I1    | all fixture records round-trip strict target parsers; exact 40-tool/wire catalogs, Run inbox, activation, causation and compaction contracts hash                 |
| I2    | empty + representative + missing media + protected choice + corrupt drift transactions; deterministic replay of inbox/activation/compaction prefixes              |
| I3    | representative Run/Chat, provider unknown, protection/CAS, immutable event-derived model view, request-hook, catalog stability, replay/privacy and resource tests |
| I4    | fake/local media inspection/derive/generation/evaluation/choice/Delivery, bounded versioned Tool Program, child inbox/cancel/cold-resume tests                    |
| I5    | empty and migrated disposable startup, cursor reconnect, Run inbox/control, handler/preload drift, recovery barrier and sentinel tests                            |
| I6    | five-workspace/Commander Dock interactions, shared selection, inline activation/child work, result review, i18n/a11y/smoke                                        |
| I7    | repeated copy migration, Run lineage/inbox/activation/compaction/catalog fixtures, hash/count reconciliation, offline export and zero Legacy references           |
| I8    | separately approved real read-only preflight, final copy, atomic switch, user-manageability and release verification                                              |

## Commands and attribution

Canonical current commands discovered from package manifests:

```powershell
pnpm run build
pnpm test
pnpm run test:types
pnpm run lint
pnpm run dev
pnpm run test:e2e
pnpm exec tsx scripts/gen-preload.ts --check
pnpm exec tsx scripts/i0-baseline.ts --check
pnpm test -- scripts/i0-baseline.test.ts
```

I0's required executable validation is the final two commands plus `git diff --check`. Broad build,
type, lint, test, preload and startup baselines are recorded with their exact command, exit code and
first owned diagnostic before I1 edits begin. Because the current worktree is already a shared dirty
integration state, a broad failure is not repaired inside I0 unless it belongs to the checker itself.

### Recorded integration-worktree baseline

| Command                                                                                                                                      | Exit | Evidence / attribution                                                                                                                                                                                                 |
| -------------------------------------------------------------------------------------------------------------------------------------------- | ---: | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm run test:types`                                                                                                                        |    0 | workspace type baseline passed                                                                                                                                                                                         |
| `pnpm run lint:contracts`                                                                                                                    |    0 | contract/guide drift check passed                                                                                                                                                                                      |
| `pnpm run lint`                                                                                                                              |    1 | 11 errors and 13 warnings in pre-existing/concurrent Commander, Delivery, renderer and task-tool edits; not caused or repaired by I0                                                                                   |
| `pnpm run build`                                                                                                                             |    0 | all workspace builds passed after rerunning outside the restricted sandbox; the first sandbox attempt failed with environmental `spawn EPERM`                                                                          |
| `pnpm test`                                                                                                                                  |    1 | 383 files passed, 7 failed; 3370 tests passed, 22 failed. Failures are legacy test fixtures/API expectations in Commander study, router/run-control stubs, renderer Commander/a11y, asset tools and multi-domain tools |
| `pnpm test -- apps/desktop-main/src/electron.startup.test.ts apps/desktop-main/src/ipc/router.test.ts apps/desktop-main/src/preload.test.ts` |    1 | 10 tests passed, 1 failed because the router test stub lacks `taskExecutionEngine.list`; startup and preload suites passed                                                                                             |
| `pnpm exec tsx scripts/gen-preload.ts --check`                                                                                               |    0 | generated preload/API exactly match all 184 IPC channels; restricted sandbox attempts hit environmental command/esbuild spawn failures before the approved out-of-sandbox check passed                                 |

These broad failures are frozen as the pre-I1 integration baseline. They do not waive any later stage
gate: a stage must distinguish its own regression and leave every affected package/test boundary green.

## I0 exit gate

I0 passes only when the checker verifies the contract hashes; declared tables/columns, model-callable
tools, IPC channels, routes and localStorage sources each have one disposition; all six fixtures are
deterministic and isolated; and the validation report contains no unknown owner.

The following immediately stop the program for a new decision: a real-data read requirement, an
unclassifiable row or media identity, an ambiguous Provider submission that would need guessing, an
unreviewed target contract change, or any request to delete/migrate/release without its separately
defined approval.
