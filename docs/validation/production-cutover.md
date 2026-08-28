# Production cutover validation

## Status: main-agent result ledger required

This file is the live validation authority for the 2026-08-28 development reset. The documentation
work did not run product validation and must not be read as a pass result. Every row below is
**PENDING — main agent must fill** with UTC time, exact command, exit code, report/artifact location,
and commit SHA after the canonical source change is settled.

No command in this file may read real AppData, prior databases, media, browser state, Keychain entries,
installed applications, or paid provider APIs. Use fresh disposable roots and fake adapters only.

## Preconditions and read-only state checks

Run these first from the repository root on the continuation machine:

```powershell
git status --short
git diff --name-status
git diff --check
git branch --show-current
git log --oneline --decorate -5
git rev-parse HEAD
git rev-parse origin/main
git rev-list --left-right --count HEAD...origin/main
node --version
pnpm --version
```

Expected toolchain policy from the current workspace manifest is Node 26.5.1 or newer and pnpm 11.21.0
through before 12. Do not run a destructive checkout, reset, clean, branch deletion, data cleanup, or
release command to make these checks look clean.

If remote verification is authorized and network access is available, separately run:

```powershell
git fetch --prune origin
git ls-remote --heads origin main
git ls-remote --tags origin refs/tags/v0.1.0
git show --no-patch --format='%H %D' v0.1.0
```

The existing v0.1.0 release/tag is immutable and is not a validation target for this cutover.

## Required validation matrix

| Area                      | Required proof                                                                                                                             | Candidate command                                                                      | Result                                                                          |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Fresh profile boundary    | The layout creates only the new canonical profile and does not probe an earlier database/media/key account.                                | pnpm exec vitest run scripts/production-cutover.contract.test.ts                       | **PENDING — main agent must fill**                                              |
| Canonical built-in Skills | Exactly 287 direct records, five exact class counts, canonical IDs/versions, trust state, and no retired wrapper.                          | pnpm exec vitest run scripts/production-cutover.contract.test.ts                       | **PENDING — main agent must fill**                                              |
| User Skill lifecycle      | skill.propose requires durable exact confirmation; confirmation registers atomically; the next root Run sees it.                           | Run the focused final runtime/storage Skill tests listed by the final package scripts. | **PENDING — main agent must fill exact command and result**                     |
| Production closure        | Formal source, emitted runtime, manifests, and package closure have one canonical entry graph and no retired/migration/import path.        | pnpm exec tsx scripts/check-production-closure.ts                                      | **PENDING — main agent must fill**                                              |
| Static deletion guard     | No prohibited identifier/path remains in live apps, packages, scripts, or workspace config.                                                | Run the guard below after the production-closure check.                                | **PENDING — main agent must fill**                                              |
| Storage/runtime           | Fresh create/reopen, canonical schema rejection, root Run/recovery, confirmations, provider exact-profile routing, and media CAS behavior. | pnpm test                                                                              | **PENDING — main agent must fill command scope and result**                     |
| IPC/native security       | Generated bridge, trusted sender check, denied unexpected sender/channel/payload, CSP/permission/session/media-protocol rules.             | Run focused Electron/IPC tests and the final native-shell smoke.                       | **PENDING — main agent must fill exact commands and result**                    |
| Renderer                  | Canonical renderer boot, typed bridge use, explicit unavailable states, and no fallback UI.                                                | Run focused renderer tests plus final E2E smoke with fixtures.                         | **PENDING — main agent must fill exact commands and result**                    |
| Static quality            | Lint and TypeScript validation on final workspace graph.                                                                                   | pnpm run lint; pnpm run test:types                                                     | **PENDING — main agent must fill**                                              |
| Canonical build           | All workspace packages and the two application entries build from clean outputs.                                                           | pnpm run build                                                                         | **PENDING — main agent must fill**                                              |
| Package                   | electron-builder packages only canonical main/preload/renderer and closure inspection covers packaged output. No install/release.          | pnpm --filter @lucid-fin/desktop-main run pack                                         | **PENDING — main agent must fill exact artifact inspection command and result** |
| Final diff                | No whitespace error, unintended user change, or live retired source path remains.                                                          | git diff --check; git status --short; git diff --name-status                           | **PENDING — main agent must fill**                                              |

Do not run the broad full suite repeatedly. Run each defined validation once after the implementation is
settled. If a validation fails, make at most one focused fix tied to that evidence and rerun only that
validation. If the same root failure remains after the permitted repair, stop and record it rather
than disguising it with a fallback.

## Static deletion guard

Run this only after the source move/deletion is complete. It intentionally excludes historical
documentation; a hit in the live product source/config is a blocker.

```powershell
rg -n -i --glob '!node_modules/**' --glob '!dist/**' --glob '!coverage/**' --glob '!docs/archive/**' '(legacy|target[-_]?rc|imported[-_]?history|migration)' apps packages scripts package.json pnpm-workspace.yaml
rg --files apps packages scripts | rg -i '(^|[\\/])(target|legacy|migration)([\\/]|$)|imported[-_]?history|i[078]-'
```

Expected result: no output. A required security term such as a generic migration label must be renamed
or removed from live code; it is not an allowed compatibility exception. The historical archive is the
only allowed home for the retired program's terminology and commands.

## Evidence fields to fill before goal closure

The main agent must replace every pending row above with:

- UTC completion time;
- final commit SHA under test;
- exact command line and exit code;
- report, package artifact, or test output path;
- a concise observed result; and
- any one permitted focused repair made after a failure.

For packaged output, record the exact archive/installer path and the command used to inspect it. For
native-shell smoke, record the disposable userData root pattern—not its concrete path—and confirm that
no external user profile or provider credential was used.

A passing release is not created by this ledger. Release requires a separately selected new version,
new tag, package signing/publishing authority, and a separate action.
