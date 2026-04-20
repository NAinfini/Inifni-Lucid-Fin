# Changelog

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
