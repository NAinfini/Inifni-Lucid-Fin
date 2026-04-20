# Commander Study Harness

Coverage telescope for the Commander agent loop: drives it programmatically
with a real LLM provider but
**mocked generation** (`canvas.generate`, `*.generateRefImage`). Produces a
reproducible corpus of session traces for system-level debugging:

- Which process prompts / workflow guides never get invoked?
- Can a user produce a ref image without a `stylePlate` being locked?
  (Phase 3 style-plate regression test.)
- What's the tool-call distribution per persona archetype?
- Where do sessions abort vs. run to the 200-step ceiling?

## Run

```bash
# Full 50-user run using all providers in rotation (Codex Plus only today).
npx tsx evals/commander-study/harness/run-all.ts --count 50

# Smoke: 2 users, single persona index, useful for iterating on harness itself.
npx tsx evals/commander-study/harness/run-all.ts --count 2 --persona 0

# Reuse a previous run's temp DB (skip seeding) — per-user runs still fresh.
npx tsx evals/commander-study/harness/run-all.ts --count 50 --max-steps 100

# Include Codex Team (it's currently broken at the distributor — models claim
# gpt-5.4 is not available for that key even though /v1/models lists it).
npx tsx evals/commander-study/harness/run-all.ts --count 50 --team-if-working
```

Reports land in `evals/commander-study/reports/<timestamp>/`:
- `summary.md` — aggregate markdown report (the one you actually read).
- `summary.json` — same data, machine-readable.
- `per-user/<n>-<slug>.json` — per-session summary.
- `per-user/<n>-<slug>.ndjson` — full stream-event log (every LLM delta,
  tool call, result, process-prompt injection).
- `raw.ndjson` — append-only record of every completed session.

## Requirements

- The `Codex Plus` provider (and optionally `Codex Team`) must exist in the
  Lucid Fin app settings with a valid API key. The harness resolves provider
  ids + base URL + model straight from `%APPDATA%/Lucid Fin/settings.json` and
  reads keys from the OS keychain under service name `lucid-fin`.
- Node ≥ 20 (we use Node 24 locally).
- `better-sqlite3` must be compiled for the **Node** you're running tsx under,
  not for Electron. Swap with:

  ```bash
  npm rebuild better-sqlite3                    # before harness run
  npx electron-rebuild -w better-sqlite3        # after, so the app works again
  ```

  Yes this is annoying. Long-term fix: ship two copies of the native module
  under `node_modules/.node-*/` and resolve by `process.versions.electron`.

## Design notes

- **No Electron runtime required.** The harness runs in plain Node and uses an
  ESM loader hook (`electron-shim.js` → `electron-shim-loader.mjs` →
  `electron-stub.mjs`) to stub out `import { app, ipcMain, BrowserWindow } from
  'electron'` inside the `apps/desktop-main/src/*` modules. Lets us re-use the
  real `registerAllTools` + `buildContext` wiring so the harness behaves 1:1
  with the production handler — no drift between studied-code and
  studied-via-harness.
- Uses its own temp SQLite DB under `os.tmpdir()` so production data is never
  touched. The directory path prints on startup; delete it to clean up.
- Mocked tools return canned `success: true` results immediately — the
  orchestrator still burns tokens and runs the full agent loop around them.
- Each persona is a (archetype, opener, follow-ups) triple. The "follow-up"
  array is consumed LIFO-per-session whenever Commander calls
  `commander.askUser`; if the list empties the harness replies "You choose."
  so the session keeps moving.
- Hard caps per session: `--max-steps` (default 200) and `--max-prompt-tokens`
  (default 400_000). Either cap trips → session marked `budget-exceeded`.

## What this is NOT

- Not a usability test. A real user would push back on bad UX; codex-class
  models are over-cooperative.
- Not a correctness test. Tool implementations still run against a real DB
  but no generated assets exist, so rendered outputs are never validated.
- Not a benchmark. LLM latency dominates; numbers vary per provider load.

It's a **coverage telescope** for the prompt/guide/process-prompt graph, and
a **regression net** for behaviors that depend on cross-tool sequencing.

## File map

```
harness/
  run-all.ts              entry point; CLI args; spawns sessions.
  run-single.ts           one user session — full agent loop.
  test-env.ts             per-user temp sqlite + stores + real JobQueue/WorkflowEngine.
  mock-generation.ts      overrides canvas.generate + ref-image tools post-registerAllTools.
  personas.ts             50 hand-crafted personas across 6 archetypes.
  llm-factory.ts          builds a ready-to-use LLMAdapter from Codex spec + keychain.
  provider-config.ts      resolves Codex Team/Plus ids + base URL + model from settings.json.
  guide-loader.ts         loads all 35 built-in prompt guides off disk (mirrors renderer seeds).
  report.ts               turns SessionResults into summary.md.
  probe-keychain.ts       diagnostic: "are my API keys reachable?"
  probe-llm.ts            diagnostic: "does Codex Plus / Team actually respond?"
  list-keychain.ts        diagnostic: enumerate all lucid-fin creds.
  electron-shim.js        self-register loader hook for 'electron' module.
  electron-shim-loader.mjs  the hook.
  electron-stub.mjs       the stubbed `electron` module (no-op app/ipcMain/etc.).
reports/<iso>/            per-run outputs.
```
