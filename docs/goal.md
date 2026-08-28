# Goal and cross-PC handoff

## Active goal

Complete the 2026-08-28 development canonical cutover for Lucid Fin, then leave a single
source-of-truth repository that another PC's AI can continue without accessing personal application
data.

The delivered product must have one canonical Electron main/preload/renderer/runtime/storage/IPC/Skills/
build/package path. It starts from a fresh canonical development profile. It has no migration, no
retired runtime, no compatibility branch, no fallback, no dual write, no imported history, and no
runtime switch between applications.

## Current handoff status

Implementation and final verification are owned by the main agent. This documentation pass has:

- created the live ownership, adapter, Skill, plan, validation, and goal documents;
- moved the superseded I0/I7/I8/migration/cross-PC documents to
  [docs/archive/target-transition](archive/target-transition/README.md); and
- marked every historical document as non-executable after the development reset.

It has **not** established final source closure, tests, packaging, native-shell smoke, a commit, a
push, a new tag, or a release. Read the PENDING result ledger in
[docs/validation/production-cutover.md](validation/production-cutover.md) before making any completion
claim.

## Read in this order

1. [docs/plans/2026-08-28-development-cutover.md](plans/2026-08-28-development-cutover.md)
2. [docs/architecture/application-ownership.md](architecture/application-ownership.md)
3. [docs/architecture/production-adapters.md](architecture/production-adapters.md)
4. [docs/architecture/skills.md](architecture/skills.md)
5. [docs/validation/production-cutover.md](validation/production-cutover.md)

Do not use a document in docs/archive/target-transition as an execution guide.

## Non-negotiable safety boundary

The continuation may not inspect, migrate, copy, hash, move, delete, or otherwise touch real prior
application data. This includes AppData, old SQLite databases/WAL/SHM/journals/backups, media roots,
browser profiles/localStorage, offline exports, existing Keychain entries, installed applications, and
paid provider APIs. Tests use new disposable paths and fake adapters only.

If a task appears to require such an input, it is outside this goal. Stop and report the conflict; do
not create a compatibility or data-migration branch.

## Exact continuation checks

From the repository root, first gather only local state:

```powershell
git status --short
git diff --name-status
git diff --check
git branch --show-current
git log --oneline --decorate -5
git rev-parse HEAD
git rev-parse origin/main
git rev-list --left-right --count HEAD...origin/main
git tag --points-at HEAD
node --version
pnpm --version
```

When remote access is authorized, refresh and verify remote state separately:

```powershell
git fetch --prune origin
git ls-remote --heads origin main
git ls-remote --tags origin refs/tags/v0.1.0
git show --no-patch --format='%H %D' v0.1.0
```

Interpretation:

- A non-empty status/diff may be the active cutover work. Preserve it; do not reset, clean, checkout
  over it, or delete a branch to make the tree appear tidy.
- HEAD must eventually be committed on main and equal origin/main after the explicitly authorized
  push. Until then, record the exact ahead/behind count.
- The prior immutable release is v0.1.0 at
  d0f3b91e3dd436e2081428546a2a0329b06b0be8. Do not amend, delete, retag, or re-release it.
- A new release requires a new selected version and separate publication authority. No version is
  selected in this handoff.

## Continue from the first unchecked gate

1. Inspect final ownership paths and the deletion surface; do not preserve a stage directory or
   forwarding package.
2. Run the first PENDING validation in
   [docs/validation/production-cutover.md](validation/production-cutover.md).
3. On evidence-backed failure, make at most one focused repair and rerun only that validation. Record
   both the failure and repair outcome.
4. After all validations pass, inspect the final diff for scope and run git diff --check.
5. Commit and push only under the already granted source-control authority, then re-run the read-only
   Git status checks and fill their results in the validation ledger.
6. Do not tag or release until a new version is explicitly chosen and release authority is confirmed.

## Goal closure criteria

Mark this goal complete only after:

- every requirement in the active cutover plan is implemented;
- every row in the validation ledger contains passing evidence at the final commit;
- the repository's canonical state is committed and pushed to main under authorization;
- the historical documents remain archived and clearly non-executable;
- no real user data, Keychain credential, installed application, or paid provider was touched; and
- any follow-up release decision is either completed as a separate authorized action or explicitly
  left pending with the new version choice identified as the remaining decision.

If these conditions are not all met, leave the goal active and state the first remaining blocker
precisely.
