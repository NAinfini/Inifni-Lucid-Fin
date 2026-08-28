# Production cutover validation

## Status: complete

The canonical development cutover passed its broad validation window on 2026-08-28 from 20:55 UTC
through 21:48 UTC at implementation commit `e44b279a44356c2b8a60d8360eb826bb8ea2acc4`. A focused
Electron startup repair then passed at current tested product commit
`0f92e267fd376aba674a351f52a78f5d168569f6` at 23:06 UTC. The commit containing this completed
ledger is a documentation-only successor and does not change the tested product source.

All validation used Node 26.5.1 and pnpm 11.21.0. No command read or changed real AppData, an older
database or media root, browser storage, an installed application, a Keychain credential, or a paid
provider account. Tests used fresh temporary roots, in-memory recovery adapters, and fake local
provider fetches. Electron smoke profiles matched `%TEMP%\lucid-fin-e2e-*`. Passing fixtures removed
their own profiles; four failed-run profiles from this validation window were individually verified
and removed during final cleanup. Pre-existing profiles dated 2026-08-14 were left untouched.

## Result ledger

| Area                              | Command and observed result                                                                                                                                                                                                                                                                                                                                                       | Evidence                                                                                                                                                                                                                                                                     |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Fresh profile and built-in Skills | `node_modules\.bin\vitest.cmd run scripts\production-cutover.contract.test.ts packages\storage\src\kernel\artifacts.test.ts --reporter=dot --silent` — exit 0; 2 files and 7 tests passed.                                                                                                                                                                                        | Fresh `<userData>/lucid-fin-v1` ownership; exactly 287 trusted direct Skills: 216 preset, 19 shot-template, 26 renderer-skill, 21 process-prompt, and 5 prompt-template. Canonical pack SHA-256: `73819345c5448277c8eee8dc7f92da2dcaca4c4eaac85cfdc9968d15cff77b88`.         |
| User Skill lifecycle              | `node_modules\.bin\vitest.cmd run packages\runtime\src\index.test.ts packages\storage\src\host\index.test.ts -t "turns an explicit user request to add a Skill\|settles earlier tool work before a later Skill proposal\|approves one exact pending proposal\|keeps an approved Project Skill available" --reporter=dot --silent` — exit 0; 4 selected tests passed, 153 skipped. | `skill.propose` requires the exact durable confirmation, registration is atomic, and the next root Run and a cold reopen see the approved Skill.                                                                                                                             |
| Production closure                | `pnpm run check:production-closure -- --require-package` — exit 0; `production closure: OK`.                                                                                                                                                                                                                                                                                      | Formal source, emitted runtime, workspace manifests, and packaged output have one main/preload/renderer/contracts/storage/runtime graph with no retired or migration/import route.                                                                                           |
| Static deletion guard             | The two PowerShell guards below — exit 0; `CONTENT_GUARD_OK` and `PATH_GUARD_OK`.                                                                                                                                                                                                                                                                                                 | No prohibited identifier or path exists in live product source/config. Tests and enforcement files are excluded only because they assert rejection of those terms.                                                                                                           |
| Storage and runtime               | `pnpm test -- --reporter=dot --silent` — exit 0; 106 files and 852 tests passed in 1540.20 seconds.                                                                                                                                                                                                                                                                               | Fresh create/reopen, canonical schema rejection, root Runs, recovery, confirmations, exact provider-profile routing, media CAS, IPC, and renderer behavior passed.                                                                                                           |
| Electron and renderer             | `node_modules\.bin\vitest.cmd run apps\desktop-main\src\electron.test.ts --reporter=dot --silent` — exit 0; 7 tests passed. `pnpm run test:e2e` — exit 0; 2 Playwright tests passed.                                                                                                                                                                                              | Main/preload/renderer startup, packaged renderer resolution, hardened bridge, visible renderer state, and disposable native-shell smoke passed.                                                                                                                              |
| Static quality                    | `pnpm run lint`; `pnpm run test:types`; `pnpm run format:check` — each exited 0.                                                                                                                                                                                                                                                                                                  | ESLint, generated-contract drift check, TypeScript, and Prettier passed on the final tree.                                                                                                                                                                                   |
| Canonical build                   | `pnpm run build` — exit 0; all 6 workspace projects built.                                                                                                                                                                                                                                                                                                                        | Renderer output included `index.js` (132.13 kB) and `vendor.js` (239.67 kB).                                                                                                                                                                                                 |
| License audit                     | `pnpm run license:audit` — exit 0; 71 dependencies checked and 0 flagged.                                                                                                                                                                                                                                                                                                         | Tracked report: [`../../license-audit-report.json`](../../license-audit-report.json).                                                                                                                                                                                        |
| Package                           | `pnpm --filter @lucid-fin/desktop-main run pack -- --dir` — exit 0. The closure command above then inspected the package.                                                                                                                                                                                                                                                         | Local ignored artifacts: `apps/desktop-main/release/win-unpacked/Lucid Fin.exe` (225,613,824 bytes), `resources/app.asar` (34,125,394 bytes), and `resources/renderer/index.html` (836 bytes). The package was not installed or launched against a real profile or Keychain. |
| Final source diff                 | `git diff --check` and, after staging, `git diff --cached --check` — exit 0.                                                                                                                                                                                                                                                                                                      | Implementation commit contains 1,656 changed files, 16,588 insertions, and 357,310 deletions. The large deletion is the authorized removal of retired implementations and generated history.                                                                                 |

## Static deletion guard

The content exclusions below are narrow and intentional: test and enforcement sources contain the
forbidden words because they prove that production closure rejects those concepts.

```powershell
$contentHits = rg -n -i --glob '!**/*.test.*' --glob '!scripts/check-production-closure.ts' --glob '!scripts/generate-contracts.ts' --glob '!packages/storage/src/kernel/artifacts.ts' '(legacy|target[-_]?rc|imported[-_]?history|migration)' apps packages scripts package.json pnpm-workspace.yaml
if ($LASTEXITCODE -eq 0) { $contentHits; throw 'CONTENT_GUARD_FAILED' }
if ($LASTEXITCODE -ne 1) { throw "CONTENT_GUARD_RG_ERROR_$LASTEXITCODE" }
'CONTENT_GUARD_OK'

$pathHits = rg --files apps packages scripts | rg -i '(^|[\\/])(target|legacy|migration)([\\/]|$)|imported[-_]?history|i[078]-'
if ($LASTEXITCODE -eq 0) { $pathHits; throw 'PATH_GUARD_FAILED' }
if ($LASTEXITCODE -ne 1) { throw "PATH_GUARD_RG_ERROR_$LASTEXITCODE" }
'PATH_GUARD_OK'
```

## Evidence-backed repairs

The final Electron smoke exposed and resolved three independent harness defects:

1. `tests/e2e/electron-main.mjs` used top-level `await app.whenReady()`, which deadlocked Electron's
   launch module. Startup now enters through an invoked asynchronous `start()` function.
2. `apps/desktop-main/src/electron.ts` resolved the development renderer from the wrong parent
   directory. It now distinguishes the development workspace path from
   `process.resourcesPath/renderer/index.html` in a package, with unit coverage for both.
3. The Playwright Electron/profile fixture was worker-scoped, allowing one test's SQLite state into
   another. It is test-scoped so every smoke starts from a new disposable profile.

The first full-suite attempt also showed that a five-second test timeout was below the observed
Windows SQLite workload. The timeout was set to 30 seconds. A concurrent-suite experiment increased
SQLite contention and was reverted; the final 852-test result uses the serial runtime policy.

## Post-closure Electron startup repair

The real development launch built successfully and then exited with
`[desktop] keytar.setPassword is not a function`. `keytar@7.9.0` is CommonJS, so Node's dynamic ESM
import exposes its API under the module namespace's `default` export. The recovery store had cast the
namespace itself to `RecoveryKeyStore`; it now destructures that default export once at the shared
system-store boundary. No fallback or second Keychain implementation was added.

The Windows Chromium `WSALookupServiceBegin failed with: 10108` line preceded the exception, but the
process and pnpm failure followed the uncaught `keytar.setPassword` TypeError. No network workaround
was added.

Validation at `0f92e267fd376aba674a351f52a78f5d168569f6`:

- The new CommonJS-shape regression test first failed against the old implementation with
  `No "getPassword" export is defined on the "keytar" mock`.
- `node_modules\.bin\vitest.cmd run apps\desktop-main\src\production-adapters.test.ts --reporter=dot --silent`
  then exited 0 with 4/4 tests passing.
- `pnpm --filter @lucid-fin/desktop-main run build`, `pnpm run lint`, and
  `pnpm run format:check` each exited 0.
- `pnpm run test:e2e` exited 0 with 2/2 Electron tests passing and no new relevant child process.
  It used the disposable profile and fake recovery-key store, so no real Keychain entry was read or
  created.

## Git, branches, and release boundary

The implementation was committed directly to `main`. Before the final documentation push, local and
remote branch inspection showed only `main`; prior Codex branch work is reachable from `main` history
and there is no second live branch to merge. The GitHub Releases list was reduced to the sole
`v0.1.0` release. Historical `v0.0.x` Git tags remain as immutable repository history rather than
parallel releases.

The existing annotated `v0.1.0` tag and release point to
`d0f3b91e3dd436e2081428546a2a0329b06b0be8`; they predate this cutover and were not rewritten. This
development cutover was deliberately not tagged or released. Publishing it requires a separately
chosen version and explicit release action.
