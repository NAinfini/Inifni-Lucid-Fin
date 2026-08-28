# 2026-08-28 development canonical cutover

## Current status: complete

This engineering plan was completed on 2026-08-28. Tested product implementation commit:
`e44b279a44356c2b8a60d8360eb826bb8ea2acc4`. The complete command, result, repair, artifact, safety,
Git, and release evidence is recorded in
[../validation/production-cutover.md](../validation/production-cutover.md).

The old I0/I7/I8/migration/cross-PC documents are historical evidence only and have moved to
[../archive/target-transition](../archive/target-transition/README.md). Their commands are retired.

## Decision

Build one canonical desktop product now, while the project is still in development:

- no data migration;
- no retention/export/import path;
- no compatibility reader, adapter, alias, feature flag, fallback, or dual write;
- no imported history tables, records, provenance, or UI;
- no runtime selection between two applications; and
- no access to real prior user data or services.

The new product starts from a fresh canonical profile under Electron userData:
<Electron userData>/lucid-fin-v1 with project.sqlite and media/. It may create only that new path
during a disposable test or a deliberately launched canonical app. It must not inspect another path
to decide what to do.

## Safety boundary

The cutover must never read, write, copy, hash, enumerate, migrate, delete, package, or launch any of
the following as part of implementation or validation:

- real AppData or an existing application-data profile;
- old SQLite files, journals, WAL/SHM sidecars, backups, or offline exports;
- existing media roots or browser profiles;
- browser localStorage;
- installed applications;
- existing Keychain credentials/recovery keys; or
- paid provider APIs/accounts.

Use only fresh disposable directories, fake adapters, fixture data created by the test, and an
uncredentialed test configuration. If a command would need a real path, credential, or paid account,
stop rather than substitute a production operation.

## Canonical ownership target

The finished tree has one owner each for main, preload, renderer, contracts, storage, runtime, IPC,
Skills, build, and package. The detailed mapping is in
[../architecture/application-ownership.md](../architecture/application-ownership.md), provider/gateway
ownership in [../architecture/production-adapters.md](../architecture/production-adapters.md), and Skill
ownership in [../architecture/skills.md](../architecture/skills.md).

## Completed implementation sequence

1. Establish contract tests for a fresh canonical profile, direct Skill documents, and a one-closure
   production build.
2. Move the canonical contracts, storage, and runtime into their final package names. Remove
   imported-history schema/code and every migration/rehearsal/import implementation.
3. Materialize the 287 built-in Skills as the direct canonical pack and preserve the durable
   skill.propose confirmation-and-registration lifecycle.
4. Compose the canonical Electron main process with real bounded adapters: fresh storage/CAS, recovery
   boundary, profile-exact provider gateways, opaque media protocol, hardened renderer, typed IPC, and
   shutdown.
5. Replace the formal Electron main, preload, and renderer entries with that composition. There is no
   transition launcher or missing-adapter synthetic success.
6. Remove retired source, tests, configs, generated artifacts, scripts, exports, and package
   dependencies. A renamed transition directory is not completion.
7. Update live documentation, run the full validation matrix once, resolve a verified failure with at
   most one focused repair pass, and record all results.

## Completed deletion surface

The exact paths are rechecked immediately before deletion because the implementation may move files
while preserving the same ownership contract. The following surfaces must be absent from the final
live source/build/package closure:

| Retired surface                                                                                                                                                 | Required final disposition                                                                                                          |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| apps/desktop-main/src/target and its target-only main/preload/IPC/media/runtime tests                                                                           | Move required canonical code to the formal main/preload locations; delete the directory and RC entrypoints.                         |
| apps/desktop-renderer/src/target, target-entry.tsx, and target-only Vite configuration/tests                                                                    | Move required canonical renderer code to the formal renderer tree; delete target-only entry/config paths.                           |
| Prior Electron main/preload, IPC handlers, services, Codex/OAuth/analytics/bootstrap code that is not part of the canonical composition                         | Delete rather than branch or wrap it.                                                                                               |
| Prior renderer App fallback, routes, local persistence, UI stores/hooks, and feature-specific components not owned by the canonical renderer                    | Delete rather than use a runtime toggle.                                                                                            |
| packages/target-contracts, packages/target-storage, packages/target-runtime                                                                                     | Move canonical implementation to packages/contracts, packages/storage, and packages/runtime; delete target-prefixed packages.       |
| packages/agent, packages/application, packages/contracts-parse, packages/domain, packages/task-execution, and any obsolete old contracts/storage implementation | Delete unless a concrete canonical boundary directly owns and has moved the necessary behavior. Do not retain a forwarding package. |
| Migration/import code: packages/**/migration, imported-history tables/records, migration tests, source classification, browser-state sealing, rehearsal helpers | Delete completely. Fresh canonical storage is the only startup path.                                                                |
| Scripts/config/tests for I0/I7/I8, target RC, migration allowlists, migration build/closure, old generated preload, and old package exports                     | Delete or replace with one canonical production-closure check.                                                                      |
| Duplicate build/package configuration, target-only tsconfigs/Vite config, and retired package dependencies                                                      | Delete. Root scripts and apps/desktop-main/electron-builder.json are the only build/package authority.                              |
| I0/I7/I8/migration/cross-PC docs                                                                                                                                | Archive under docs/archive/target-transition with a superseded notice; do not execute them.                                         |

A directory cannot be retained merely because it is unreferenced. The final closure check must inspect
formal source, emitted output, manifests, and packaged contents.

## Completion criteria

All completion criteria were satisfied:

- formal main, preload, and renderer boot the canonical composition;
- canonical packages are the only contracts/storage/runtime packages in workspace and package
  dependencies;
- fresh profile bootstrap and reopen work without probing a prior profile;
- IPC/security/media/provider/recovery behavior remains real and fail-closed;
- the canonical Skill pack has 287 direct records and user Skill registration works through durable
  confirmation;
- no retired or migration/import path remains in live source, test, build, config, generated output,
  package, or packaged archive;
- the full validation matrix has recorded passing results; and
- the final diff was reviewed and committed under the granted source-control authority; the
  documentation-only successor records the push/remote handoff closure.

## Release boundary

The repository already has an immutable v0.1.0 release at commit
d0f3b91e3dd436e2081428546a2a0329b06b0be8. It predates this development cutover and must not be
amended, replaced, or re-used. A later release of this cutover requires an explicitly selected new
version, a new tag, successful package validation, and a separate release action. This document does
not select that next version.

## Cross-PC takeover

On another PC, read docs/goal.md first. Do not start a retired I0/I7/I8/migration command. Confirm that
the clean local `main` equals `origin/main`, then start only newly requested work as a new goal. The
repository and these live documents are the handoff source of truth; no real local profile is an input
to the task.
