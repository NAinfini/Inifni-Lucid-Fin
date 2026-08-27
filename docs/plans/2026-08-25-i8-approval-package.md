# I8 Approval Package: Real Copy, Cutover, and Later Disposal

## Status and authority

This package is ready for review, but it grants no authority by itself. I8 has not started. No real
database, media root, export, backup, credential, installed application, or paid Provider was read,
written, moved, deleted, packaged, installed, or invoked while preparing it.

The three gates below are independent. Approval of an earlier gate does not approve a later gate.
Packaging/installation, paid Provider traffic, source-control publication, and release publication are
also separate approvals outside these three gates.

## Frozen candidate inputs

An approved I8 run must use the exact reviewed revisions of:

- `packages/target-storage/src/migration/legacy-migration-rehearsal.ts` and its migration modules;
- `packages/target-storage/src/migration/legacy-browser-state.ts` and
  `scripts/seal-legacy-browser-state.ts`;
- `scripts/rehearse-legacy-migration.ts`;
- the canonical Target DDL and built-in Skill pack loaded by `@lucid-fin/target-storage`;
- `scripts/check-target-only-rc.ts` and `scripts/build-target-rc.ts`;
- the I7 completion evidence and deletion manifest updated through 2026-08-26.

The real source paths and fingerprints are intentionally absent. Capturing them requires reading real
user state and is therefore the first operation after Gate A approval, not preparation work.

The reviewed I7 RC v3 evidence currently freezes closure
`a22bac8ae94d2328cb6eb274b1a535e55f569d9a3405f50316dbe3170f15bce9`, input
`9bda767fcf35a51c7db7536aa16fdbbed8645f1269c8a819d1de33a398a461c9`, and metadata
`f672fe3e398b1c05f67704bb5eedad7f6802ece7f58d495d5ad8b5b043c3c22b`. It contains four runtime
entrypoints, 187 emitted audit roots/closure files, 217 bound inputs, nine configurations, and 718
emitted artifacts. Any change requires the I7 RC checks and three-build determinism proof to be
repeated before Gate A can use it.

## Gate A — maintenance and final-copy approval

### Exact authority requested

Authorize one bounded maintenance window to identify the real Legacy database, prompt database, and
media root; close all writers; take read-only fingerprints and recovery copies; capture the ten frozen
browser-local keys through a reviewed trusted Chromium reader; and run the already verified preflight,
classification, dry-run, materialization, reconciliation, and startup validation against a fresh
Target destination. This gate does not authorize changing the official application entry, installing
a build, deleting anything, or invoking a paid Provider.

### Hard preconditions

1. The application and every Legacy Run/TaskList writer are stopped and independently checked to be
   inactive. No watcher, second application instance, sync client, or maintenance process may write
   either source or destination during the copy.
2. The staging parent is newly created for this run, owned by the operator, protected by an ACL that
   denies unapproved writers, and located on the same volume as the final Target destination.
3. The operator records the canonical path, file identity, byte length, SHA-256, schema fingerprint,
   and modification time of both SQLite sources and records a sorted hash/length inventory of the
   media root before copying.
4. The destination name and staging name do not exist. SQLite `-wal`, `-shm`, and journal sidecars are
   either safely checkpointed by the closed Legacy application or treated as a stop condition.
5. A recovery copy is written outside the live destination and verified by hash before transformation.
6. The exact candidate source revision, DDL fingerprint, Skill pack hash, migration-plan fingerprint,
   RC closure hash, toolchain versions, operator, UTC timestamps, and rollback owner are recorded.
7. A separately reviewed trusted collector binds the exact Chromium WebContents/profile/session/origin,
   capture run/session IDs, and a fresh 43-character challenge before reading localStorage. It must
   return one branded state for every frozen key: `present`, `absent`, or `capture_error`. Caller-authored
   JSON is not an input; any `capture_error` is a stop condition.
8. The v2 sealer writes the raw values and normalized absolute profile path only to the protected
   private evidence destination using exclusive temporary creation plus atomic hard-link/no-replace.
   Public evidence may contain only irreversible run/session/profile/challenge fingerprints, the
   canonical origin (`opaque:file` for file storage), timestamp, counts, byte length, hashes, and
   public fingerprints. The destination must not exist.

The trusted Chromium collector in items 7-8 is not implemented or authorized in I7. Gate A cannot
begin real browser-state capture until that collector and its exact WebContents/profile/session/origin
binding are reviewed. The existing v2 snapshot/sealer does not read Chromium and cannot accept
caller-supplied JSON as a substitute.

The exclusive-writer and protected-parent requirements are mandatory. Node 26 does not expose the
Windows directory-handle/no-follow/openat/no-replace primitives needed to make every path check and
rename safe against a hostile same-user process. The I7 tests prove deterministic behavior on a
controlled disposable root; they do not claim hostile-concurrency atomicity.

### Required outputs

- immutable source and backup inventories;
- final preflight and classification reports with zero blockers;
- one Target store and content-addressed media copy in the protected destination;
- exact first, reopened, and final reconciliation fingerprints;
- Target database schema/SHA-256/length evidence, offline-export evidence, and media byte verification;
- one private sealed ten-key browser-state snapshot plus a path-free public identity/report, with zero
  `capture_error` entries and exact SQLite Chat-mirror comparison;
- fresh-versus-migrated shared startup-suite result;
- a signed Gate A run record containing elapsed downtime and every path actually accessed.

### Stop conditions

Stop without publishing the Target destination if any writer remains active; a source fingerprint
changes; an unknown setting, ambiguous owner, invalid FK, hash mismatch, unexpected sidecar, reparse
point, browser capture error or identity mismatch, pre-existing evidence destination, extra output, or
cleanup error appears; the protected parent cannot be guaranteed; or any report differs across
reopen/reconciliation. Preserve the source and recovery copy unchanged.

## Gate B — atomic cutover approval

### Exact authority requested

After Gate A outputs are reviewed, authorize one switch of the official application/store pointer to
the verified Target candidate, followed by installed-build startup and acceptance checks. This gate
does not authorize deleting or rewriting the Legacy sources or recovery copies.

Packaging or installation needed for this gate must be approved explicitly in addition to Gate B.
Composing production adapters and changing the official Electron main/preload/renderer or package
entry must use the reviewed target-only RC closure and must not add a Legacy fallback, compatibility
alias, feature flag, or dual write.

### Preconditions

1. Gate A is accepted with exact hashes and no open blocker.
2. The target-only RC v3 source closure, four runtime entrypoints, and complete emitted audit-root set
   are unchanged before and after clean emit.
3. Production adapters are explicit and operational; the current intentional
   `target_rc_production_adapters_unavailable` failure has been replaced only by reviewed real Target
   composition, never by a synthetic success path.
4. The native Electron composition supplies reviewed settings, locale, and theme adapters and retains
   the Target renderer's trusted WebContents/frame/URL authorization, isolated session partition,
   permission denial, CSP, and opaque media protocol. Browser fixtures do not satisfy this native-shell
   precondition.
5. A one-step rollback pointer and its operator are documented and tested without deleting either
   store.
6. The installed-build hash, package manifest, signing identity, destination, and maintenance window
   are approved.

### Required validation

- startup reaches ready through schema, Skill provisioning, recovery, IPC, and renderer bridge;
- the migrated Projects, Chats, Messages, imported Run/Task history, media, Production, Canvas,
  choices, Delivery order, budgets, and evidence are readable through Target authorities;
- one target-native Run proves FIFO inbox, activation epochs, exact 40-tool catalog, child lineage,
  compaction, crash retry, and cold reopen without scheduling imported history;
- the installed shell proves all 45 invoke methods plus one push method, exact trusted renderer
  identity, denied permission requests, CSP enforcement, settings/locale/theme persistence, and
  `lucid-target-media:` GET/HEAD/range playback from verified CAS bytes;
- Delivery proves frozen-plan reads, operation progress/cancel/failure/usage/artifact/receipt state,
  and protected replies that use the persisted confirmation ID plus immutable input hash rather than
  substituting the Run interaction ID;
- no official entry, route, IPC channel, package export, emitted module, HTML/CSS asset, schema, or
  runtime registry reaches Legacy code;
- rollback to the untouched Legacy pointer remains possible until Gate B is formally accepted.

### Stop conditions

Rollback the pointer, keep both stores, and stop if startup, reconciliation, Target authority reads,
renderer smoke, catalog digest, recovery, or zero-Legacy closure differs from the approved evidence.
Do not forward-fix production state during the window without a separately reviewed repair plan.

## Gate C — later physical-disposal approval

### Exact authority requested

Only after the agreed retention period and independent acceptance of the Target installation,
authorize deletion of the exact Legacy code/data/export/backup objects listed by canonical path,
identity, size, and SHA-256 in the Gate C request.

Gate C is not implied by successful migration or cutover. The deletion request must be generated from
the I7 exhaustive manifest plus the actual Gate A inventories; broad paths, globs, unresolved
variables, repository roots, home directories, and parent folders are forbidden targets.

### Preconditions and evidence

1. The user confirms the retention period has ended and names the recovery copy, if any, to retain.
2. The installed Target has remained healthy for the agreed period and its current database/media
   inventories reconcile to the accepted Gate B record.
3. Every proposed object is classified as Legacy-only and has zero Target import, route, IPC, schema,
   registry, package, or runtime reference.
4. The operator prints the exact deletion list and recoverability status for confirmation before any
   destructive command.
5. Deletion is performed by exact path/identity from leaf to root, followed by a bounded existence and
   Target-health check. No unrelated workspace change is cleaned.

## Other approvals that remain separate

- package creation, code signing, application installation, or release publication;
- paid or credentialed Provider calls;
- commit, push, PR, merge, tag, or source-control history rewrite;
- any native helper/dependency added to obtain stronger Windows filesystem primitives;
- any production infrastructure, shared configuration, or credential change.

## Decision format

An approval must name exactly one gate, the candidate/run identifier, the allowed real paths or
installed-build destination, the maintenance window, and any additional permissions. A generic
“continue,” approval of this document, or approval of another gate is insufficient.
