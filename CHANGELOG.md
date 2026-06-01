# Changelog

## 0.0.8 — 2026-05-06

### Highlights

Production-quality release with E2E smoke testing, async I/O migration, component splits, Redux store reorganization, and comprehensive bundle-size tracking.

### Added

- **E2E smoke workflow:** GitHub Actions `e2e.yml` launches the packaged Electron app and verifies startup health.
- **Analytics schema and telemetry:** `analytics-schema.ts` + `analytics.ts` for structured usage tracking.
- **Backup scheduler:** `backup-scheduler.ts` for automated SQLite backup rotation.
- **CONTRIBUTING.md:** comprehensive contributor guide with prerequisites, project structure, dependency graph, workflow, and troubleshooting.

### Changed

- **Async I/O migration:** file and DB operations moved off the main thread where they were blocking IPC.
- **Component splits:** large renderer components decomposed into focused sub-components.
- **Redux store reorganization:** slice barrel exports cleaned up; settings split into sub-modules (`persistence.ts`, `provider-defaults.ts`, `provider-reducers.ts`, `telemetry-reducers.ts`).
- **Test infrastructure:** `vitest.config.ts` hardened; test setup standardized across workspaces.
- **Bundle tracking:** asset size limits added to CI to catch bundle regressions.

### Fixed

- **E2E smoke launch** stability — window-ready detection and graceful shutdown on CI runners.

---

## 0.0.7 — 2026-04-28

### Highlights

Security audit and production hardening across the entire stack. 8 critical security fixes, deep code scan removing ~5,600 lines of dead code, performance improvements, and IPC contract alignment.

### Added

- **Entity detail system:** `entity detail columns`, `asset generation_metadata`, DB migration v3.
- **Todo subsystem:** orchestrator interception, tool registration, and renderer snapshot.
- **Health ping handler** and **render abort signal** for graceful pipeline cancellation.
- **Lipsync adapter rewrite** — cloud and local paths unified.
- **Canvas polish:** commander todo snapshot, entity detail panels.
- **i18n:** localized tool names in process-prompt settings.

### Changed (Security — Critical)

- Fix command injection in local-lipsync (python executable allowlist).
- Fix SSRF in cloud-lipsync (HTTPS + private IP validation).
- Fix FFmpeg CLI injection (output options allowlist).
- Fix ESM `__dirname` bug in api-server.
- Fix SQL injection in `repair()` and `discoverColumns()` (identifier quoting).
- Move Gemini/Imagen API keys from URL query to `x-goog-api-key` header.
- Wire `validateProviderUrl` into all 32+ adapter `configure()` methods.
- Fix job queue infinite retry (`markFailedOrDead` attempt increment).

### Changed (Security — High)

- Symlink resolution in `assertSafePath` (`realpathSync`).
- Path containment checks in video-clone, render, export handlers.
- Sanitize `item.name` in batch export (strip path separators).
- Prototype pollution guard in `canvas.handlers` (`Object.assign`).
- Strip `requestBody` from LLM error details (replace with summary).
- Redact SSE parser console warnings.
- Validate TTS adapter `savePath` within `tmpdir`.
- Body size limit on api-server (10 MB).

### Changed (Stability)

- Fix redo stack corruption on reducer throw (undo middleware).
- Fix `cloneDeep` to handle Immer drafts (structuredClone with fallback).
- Sanitize transient fields in canvas restore reducer.
- Fix bootstrap session load silent error swallowing.
- Fix `useCanvasGeneration` subscription cleanup.
- Pump iteration limit in workflow engine (1,000 max).
- Pause/cancel guard in workflow pump loop.
- Fix `cancel()` race with `autoPump` in workflow engine.
- Fix `stop()` to abort all running job controllers.
- Standardize job push payload field names (`id` → `jobId`).

### Removed

- **~5,600 lines of dead code** across scan2 batches A–D: unused IPC handlers, dead exports, orphaned adapters, unreachable branches.

### Fixed

- 16 failing tests across 6 files (mock contract alignment).
- Export path validation and navigation guards.

---

## 0.0.6 — 2026-04-26

### Highlights

Commander AI workspace polish — advanced UX, AI intelligence layer, and core infrastructure hardening. Process prompts, context-aware tools, prompt cache, and changeset-group UI.

### Added

- **Process prompts:** per-workflow agent instructions injected into the system prompt at runtime.
- **Context-aware tools:** tool availability adapts to the current canvas state and active workflow.
- **Prompt cache:** LLM system-prompt segments cached to reduce redundant compilation.
- **Changeset groups:** batch-apply UI for reviewing multi-tool changesets before committing.
- **Entity strip:** inline entity references (characters, locations, equipment) in Commander chat.
- **Composer chips:** tag-style input for structured Commander arguments.
- **Canvas tools:** new canvas-manipulation tools registered in the Commander registry.
- **Skills system + definitions registry:** `skillDefinitions` slice and runtime skill routing.
- **Eval harness polish:** commander-study improvements, archetype expansion.

### Changed

- **Commander core infrastructure:** legacy code cleanup, cancel UX improvements, agent loop hardening with better error boundaries.
- **i18n:** expanded English and Chinese localization coverage for Commander UI and tool names.
- **Store slices:** new slices and slice reorganization for commander state.

### Fixed

- 5 test files deleted (testing unimplemented features).
- 9 IPC handler tests updated to match actual error shapes.
- 4 renderer tests corrected (mocks, missing store slices, duplicate keys).
- `no-regex-spaces` lint errors in `check-preload-drift.ts`.
- Excluded `preload.cts` from `no-restricted-imports` rule (legacy bridge).

---

## 0.0.5 — 2026-04-20

### Highlights

Declarative exit-contract architecture ships end-to-end. The agent loop no longer terminates on "LLM stopped" — it terminates on a typed `ExitDecision` derived from an append-only evidence ledger and a registered `CompletionContract`. Third-party workflows can register contracts at runtime without orchestrator changes.

### Added

- **Exit-contract architecture (Phases A–F):** `EvidenceLedger`, `ExitDecisionEngine`, `contractRegistry`, and `ProcessPromptSpec`. 8 built-in workflow contracts (`story-to-video`, `style-plate`, `shot-list`, `continuity-check`, `image-analyze`, `audio-production`, `style-transfer`, `info-answer`).
- **Public extensibility surface:** `contractRegistry.register()` / `unregister()` — idempotent on identity, hard-error on conflicting id. Plus `decide`, `classifyIntent`, `evaluateProcessPromptSpecs`, `createStylePlateLockSpec`, and the narrow type set plugins need.
- **Orchestrator factory:** `createAgentOrchestratorForRun()` is the single supported construction path across `commander.handlers`, `electron.ts`, and the study harness.
- **Stream events:** `evidence_appended`, `exit_decision`, `preflight_decision` for observability; `done` gains optional `exitDecision` / `exitIntent` so the renderer can display terminal-state banners.
- **Renderer:** `ExitDecisionBanner` surfaces `unsatisfied` / `blocked_waiting_user` / `refused` / `budget_exhausted` / `error` outcomes on completed runs.
- **Commander-study harness:** fake-user study loop (`evals/commander-study`) with the Hi code provider, plus report generation with `product satisfied %` headline and blocker histograms per archetype.
- **CI:** `npm run lint:contracts` cross-checks each workflow guide's "Terminal commitment" prose against its contract's `requiredCommits` / `acceptableSubstitutes`.
- **Docs:** `docs/ai-skills/commander-extensibility.md` — public API reference for contract + spec authors.
- **Live-progress runtime:** phased UI updates (phases 1–5) + intent narration during Commander runs.
- **Canvas-scoped settings + ref-image prompts:** `canvas.setSettings`, style-plate lock, per-canvas ref-image composition.
- **Prompt infrastructure:** MASTER INDEX + `skillDefinitions` registry; `guide.get` loads workflow guides on demand.

### Changed

- **Hard enforcement (Phase F):** `execute()` returns `exitDecision` + `exitIntent` on every terminal branch. The step-limit path injects a `budget_exhausted` evidence so the decision engine surfaces the correct outcome with full precedence.
- **`commander.askUser` description** trimmed — the continuation semantic is now load-bearing in the engine, not prose.
- **Public barrel** narrowed; internal exit-contract symbols (`EvidenceLedger`, specific contract objects, predicate helpers) are no longer re-exported. `public-surface.test.ts` enforces this.
- **Contract registry** is idempotent on contract identity (safe under HMR / double-imports); conflicting ids still throw.
- **Unicode sweep:** replaced bare `\uXXXX` escape literals with real characters throughout the codebase (arrows, sort indicators, CJK provider names). Regex character classes + NUL separators keep escape form intentionally.

### Removed

- **Playwright E2E suite:** `e2e/`, `playwright.config.ts`, `@playwright/test`, and the `test:e2e` script. Replaced by the commander-study harness for end-to-end agent coverage.
- **04-19 `askUserReminderInjected` one-shot system prompt:** the `ask_user_loop` blocker + Phase F hard enforcement carry that semantic.

### Fixed

- **GitHub publish provider** for `electron-updater` so releases are discoverable from the running app (#52).

### Migration notes

- External consumers of `@lucid-fin/application` that imported `EvidenceLedger`, `stylePlateLockPredicate`, `isGenerationTool`, or individual built-in contract objects (`storyToVideoContract`, etc.) must migrate to `contractRegistry.get(id)` or the public factories. These symbols are now `@internal`.
- `execute()` return type gains optional `exitDecision` / `exitIntent`; existing destructuring on `{ content, toolCalls, finishReason }` is unaffected.

---

## 0.0.4 and earlier

See `git log` for prior history.
