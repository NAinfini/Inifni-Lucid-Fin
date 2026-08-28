# Canonical application ownership

## Status

This is the ownership contract for the 2026-08-28 development reset. It describes the only accepted
end state, not a compatibility design. Final command results and the resolved source paths are recorded
by the main agent in [../validation/production-cutover.md](../validation/production-cutover.md).

## One application, one authority per boundary

The desktop product has exactly one canonical composition. It does not select an old or alternate
application at runtime, and it does not keep a fallback branch for either source or stored data.

| Boundary          | Canonical owner                                                       | Responsibility                                                                                                                 | Forbidden parallel authority                                                                             |
| ----------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| Electron main     | apps/desktop-main/src/electron.ts                                     | Creates the one composition root, hardened BrowserWindow, protocol handler, IPC host, lifecycle, and shutdown order.           | A second main entry, alternate launcher, or branch that opens another application tree.                  |
| Preload           | apps/desktop-main/src/preload.cts plus generated contract output      | Exposes only the typed, allowlisted IPC bridge to the trusted renderer.                                                        | Broad ipcRenderer exposure, ad-hoc channels, or an alternate preload.                                    |
| Renderer          | apps/desktop-renderer/src/main.tsx and its canonical application tree | Renders the canonical product through the preload bridge; it owns no filesystem, provider credential, or database access.      | A separate renderer entry, fallback application tree, or local persisted product state.                  |
| Contracts         | packages/contracts (@lucid-fin/contracts)                             | Canonical schemas, IPC definitions, generated bridge types, canonical JSON, DDL, and built-in Skill pack.                      | A prefixed package, parser-side duplicate, or duplicated wire definitions.                               |
| Storage           | packages/storage (@lucid-fin/storage)                                 | Fresh schema bootstrap, repositories, CAS/media metadata, provider-profile records, Skill registry, and durable confirmations. | A migration reader, imported-history tables, or a second store abstraction.                              |
| Runtime           | packages/runtime (@lucid-fin/runtime)                                 | Root Run lifecycle, frozen catalog, tool policy, confirmation protocol, recovery orchestration, and bounded adapter ports.     | A prior agent/task-execution runtime or runtime-selected fallback.                                       |
| IPC               | Contract-generated wire, bound once by the canonical main host        | Validates the sender identity, payload, response, and one-way event path.                                                      | Old channel registrars, allowlists, aliases, or duplicate invoke/push wires.                             |
| Skills            | Canonical built-in pack plus canonical storage registry               | Provisions built-ins, preserves trust/review state, and registers user-approved Skills.                                        | Preset/template/process-prompt managers or browser-local Skill state.                                    |
| Build and package | Root workspace scripts and apps/desktop-main/electron-builder.json    | Builds, tests, packages, and audits the same official entries.                                                                 | RC-only tsconfig/Vite/build scripts, a second builder config, or an artifact that contains retired code. |

The path names above are the required final names. A transition-stage directory is not an accepted
final name even if its code is functionally equivalent; move the code into the owning boundary and
delete the stage directory before closure.

## Fresh development profile

The canonical main process owns a newly named application-data root under Electron's userData path:

```text
<Electron userData>/lucid-fin-v1/
  project.sqlite
  media/
```

canonicalUserDataLayout() is the source-level boundary for this layout. It chooses only the path
above and the recovery-key-v1 account. It must not inspect, discover, compare, open, copy, alias,
or modify any pre-reset path. First launch creates a fresh canonical schema and provisions the
canonical built-in Skill pack. A non-canonical database is rejected rather than transformed.

The fresh-profile rule covers all prior local state, including:

- real AppData directories;
- SQLite databases and their -wal, -shm, journal, backup, or export files;
- media roots and browser profiles;
- browser localStorage and offline exports;
- existing Keychain credentials or recovery keys; and
- installed applications and any paid provider account/API.

No test, setup task, or handoff step may read those locations. Tests must use newly created disposable
temporary roots and fake/in-memory adapters only.

## Dependency direction

The allowed direction is intentionally narrow:

```text
Electron main / preload / renderer
                 |
                 v
        contracts <- runtime -> adapter ports
                 ^       |
                 |       v
               storage  provider/media/recovery implementations
```

The renderer depends on contract types and the preload bridge, never on storage or native APIs. The
runtime expresses ports and policy. The composition root supplies concrete provider, media, recovery,
and Electron adapters. Storage is the durable authority for canonical records, confirmations, Skill
registry state, and CAS metadata. No older package may sit between these layers to translate behavior.

## Non-negotiable reset rules

1. There is no data migration, data copy, import, retention path, dual write, history import, or
   compatibility reader.
2. There is no runtime feature flag, environment switch, file-presence probe, or catch-and-fallback
   that can select a retired implementation.
3. There is no automatic reuse of a credential, profile, browser state, local setting, or custom
   template from a previous installation.
4. Fail-closed validation is required: missing adapters, invalid profile state, invalid schema,
   untrusted sender, or unavailable provider produces an explicit error. It is not a reason to fall
   back to an older path.
5. Only the built-in Skill pack is installed on first launch. User-created Skills enter only through
   the durable confirmation flow described in [skills.md](skills.md).

## Completion evidence

The end state is not established merely because the code compiles. The main agent must record all of
the following as passing before declaring this contract complete:

- formal main, preload, and renderer entries resolve to the canonical composition;
- the source, emitted runtime, package manifest, and packaged archive have one closure with no retired
  roots or imports;
- a new disposable userData root creates and reopens the canonical database and media root;
- the trusted renderer can use the generated IPC wire while an untrusted sender is denied;
- the exact built-in Skill pack and user-Skill confirmation lifecycle work; and
- package/build scripts contain no alternate RC or migration path.

See the concrete command ledger in [../validation/production-cutover.md](../validation/production-cutover.md).
