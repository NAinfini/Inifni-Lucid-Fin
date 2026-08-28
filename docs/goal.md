# Goal and cross-PC handoff

## Status: complete

The 2026-08-28 Lucid Fin development cutover is complete. Current tested product implementation
commit: `0f92e267fd376aba674a351f52a78f5d168569f6`. It contains the canonical cutover from
`e44b279a44356c2b8a60d8360eb826bb8ea2acc4` plus the narrow Electron CommonJS `keytar` import
repair recorded in the validation ledger. The documentation-only successor containing this record
does not change the tested product source.

No continuation task remains for this goal. A different PC should clone or update `main`, confirm it
matches `origin/main`, and treat this repository and the documents below as the only source of truth.
A future feature or release starts a new goal.

## Delivered state

- One Electron main, preload, renderer, runtime, storage, IPC, build, and package graph.
- One fresh profile at `<Electron userData>/lucid-fin-v1`, with `project.sqlite` and `media/`.
- No migration, retention/import route, compatibility reader, fallback, dual write, imported history,
  runtime application switch, or forwarding package.
- Exactly 287 trusted built-in Skills, materialized directly from every former preset/template class.
- User requests can create additional Project Skills through `skill.propose`, exact durable
  confirmation, atomic registration, and availability on the next root Run and cold reopen.
- Only the canonical workspace packages remain: contracts, storage, runtime, and media-engine.
- Superseded I0/I7/I8/migration/cross-PC documents are non-executable history under
  [`docs/archive/target-transition`](archive/target-transition/README.md).

Full commands, results, repairs, artifact sizes, and the safety record are in
[`docs/validation/production-cutover.md`](validation/production-cutover.md).

## Read in this order

1. [`docs/goal.md`](goal.md)
2. [`docs/plans/2026-08-28-development-cutover.md`](plans/2026-08-28-development-cutover.md)
3. [`docs/architecture/application-ownership.md`](architecture/application-ownership.md)
4. [`docs/architecture/production-adapters.md`](architecture/production-adapters.md)
5. [`docs/architecture/skills.md`](architecture/skills.md)
6. [`docs/validation/production-cutover.md`](validation/production-cutover.md)

Do not use anything in `docs/archive/target-transition` as an execution guide.

## Safety boundary preserved

Implementation and validation did not inspect, migrate, copy, hash, move, delete, or launch real
prior application data. This includes AppData, old SQLite databases and sidecars, media roots,
browser profiles/localStorage, offline exports, existing Keychain entries, installed applications,
and paid provider APIs. Tests used only fresh temporary paths and fake or in-memory adapters.

That remains the product contract. Work that would require older data is a new, explicitly authorized
goal—not an implicit compatibility addition.

## Cross-PC verification

From a clean checkout on the other PC:

```powershell
git fetch --prune origin
git switch main
git status --short --branch
git rev-parse HEAD
git rev-parse origin/main
git rev-list --left-right --count HEAD...origin/main
node --version
pnpm --version
```

Expected source-control result is a clean `main` with `HEAD == origin/main` and ahead/behind `0 0`.
The supported toolchain is Node 26.5.1 or newer and pnpm 11.21.x. Install dependencies with the frozen
lockfile before new work; do not copy an old profile to the new machine.

## Branch and release record

At closure, local and remote branch inspection showed only `main`. All prior Codex work that survives
the cutover is in `main`; there is no other branch to merge. GitHub has one Release, `v0.1.0`.
Historical `v0.0.x` tags remain only as repository history.

The existing `v0.1.0` release/tag points to
`d0f3b91e3dd436e2081428546a2a0329b06b0be8` and predates this cutover. It was not moved or reissued.
The completed cutover has no release tag; publishing it requires a new version and a separate release
decision.
