# I7 Completion Evidence: Disposable Migration and Target-only RC v3

## Completion status and authority

I7 is complete within its authorized disposable-only scope. The migration transformer, representative
rehearsal, fresh/migrated startup parity, target-native replay, target-only RC v3, exhaustive Legacy
manifest, I6 Target shell closure, and I8 approval package are implemented and verified. A
2026-08-26 continuation re-audited and completed the remaining safe non-Gate runtime, export-grant,
pagination, renderer, accessibility, cancellation, migration finalization, browser E2E, and
deterministic-RC work recorded below. The structural Target/Harness implementation and RC candidate
are complete within this scope; this is not a production cutover claim.

This evidence grants no authority to read real user databases or media, run a real migration, switch
the official Electron application, package or install a build, call a paid Provider, delete Legacy code
or user data, or publish source control. I8 has not started; its three independent approvals remain in
[`2026-08-25-i8-approval-package.md`](./2026-08-25-i8-approval-package.md).

## Disposable migration evidence

The representative fixture exercises all 39 supported Legacy source tables, two Projects, PNG/MP4/WAV
bytes, Canvas ownership, Production objects and collection clones, Chats/Messages, Delivery order,
generation attempts and results, choices, Run/Task history, settings, prompts, presets, templates, and
Skills. It proves:

- preflight, phase-one classification, readiness, plan, materialization, reopen, reconciliation, and
  atomic publish complete without a blocker;
- the first, reopened, and final reconciliation fingerprints are identical, and a second independent
  disposable run produces the exact same report;
- the two Legacy SQLite sources and every source media byte remain unchanged;
- the Target store passes canonical-schema validation and `PRAGMA foreign_key_check`, records its
  schema fingerprint/SHA-256/length, and verifies all three content-addressed media objects by hash and
  byte length;
- two Project settings are retained only in the private offline export; an unknown setting blocks
  before Target creation;
- seven Skill documents are materialized: three trusted built-ins and four unreviewed Legacy-derived
  identities; all four unreviewed identities are quarantined and none is enabled;
- three Legacy Runs, seven Run events, one TaskList, two Task items, their lineage/evidence, and related
  records are retained only in imported-history authorities and never enter schedulable Run/Task tables;
- the same full target-native replay runs against a fresh store and the migrated `target.sqlite`,
  covering FIFO inboxes, activation, child lineage, compaction, retry/recovery, and cold reopen without
  altering imported-history hashes or counts.

Failure coverage rejects unknown schema/settings, nonempty unsupported dependencies, ambiguous owners,
invalid references/FKs, missing or mismatched media, SQLite sidecars, extra staging outputs, path or
parent identity changes, symlinks/junctions/reparse points, destination races, post-reconcile database
mutation, and cleanup failure. The destination is never published on those paths.

## Target validation ledger

All results below were obtained on disposable stores or clean temporary emit roots.

| Boundary                                | Result                                                                                                              |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Consolidated Target suite               | 147 files, 1174/1174 tests in one serial run; 2939.55 seconds                                                       |
| Target browser E2E fixture              | 11/11 Playwright journeys; 3.9 seconds; Chromium at desktop, 390px, and 320px                                       |
| Target TypeScript                       | all eight application/package/E2E configurations exit 0                                                             |
| Target-scoped lint and source integrity | ESLint exits 0 with zero warnings; Prettier check and `git diff --check` pass                                       |
| Post-closure focused regressions        | 8 files, 142/142 tests; desktop-main, desktop-renderer, and agent TypeScript exit 0                                 |
| Full repository lint and contract drift | ESLint `--max-warnings=0` exits 0; contract/guide drift check exits 0                                               |
| Reviewed raw IPC registration baseline  | 150 current sites; direct CLI and actual-repository integration test exit 0                                         |
| Target-only RC boundary                 | `ok=true`; zero source/emitted closure violations                                                                   |
| Generated contract/preload/Skill checks | all three `--check` commands exit 0                                                                                 |
| Legacy baseline                         | 106 schema objects, 82 tools, 50 model tools, 165 IPC channels, 2 routes, 10 localStorage keys; exact check exits 0 |
| I6 browser visual/accessibility closure | 4 viewports, 20 inspected screenshots, zero overflow/console/page/request failures                                  |

The shared startup harness uses the same sequence for fresh and migrated stores:

```text
store -> built-in Skills -> recovery/reconciliation -> IPC -> ready -> cold reopen
```

## Final Target completion audit

- The generated public wire contains exactly 45 invoke methods plus one versioned push method, and
  the single model-visible catalog/index still contains exactly 40 tools.
- The Electron boundary authorizes the exact trusted renderer WebContents/frame/URL before creating a
  command context, uses an isolated session partition, denies renderer permission requests, and ships
  the frozen Target CSP. No native Electron window was launched because Gate B is not authorized.
- Media and generated-result previews use expiring opaque `lucid-target-media:` capabilities backed
  by verified CAS bytes. The custom protocol implements GET, HEAD, one byte range, 404/405/416
  failures, and never exposes a path or media hash to the renderer.
- Delivery exposes its frozen plan plus running/failed operation state, progress, cancellation,
  usage, errors, artifacts, and receipts. Protected confirmation requests expose both the Run
  interaction ID and the separately persisted confirmation ID; the renderer replies with that
  confirmation ID and the immutable input hash.
- Delivery export destinations are represented only by private, single-use grants scoped to the
  exact Project, Delivery plan, and allowed extension. Main-process issuance rechecks close races,
  validates the selected extension, uses monotonic expiry internally, and never exposes or persists
  an absolute destination path. The production OS-picker/write adapter remains Gate B work.
- Overview derives its recent generated-result strip from reverse-chronological authoritative History,
  fetches up to four missing exact Result projections when they fall beyond the first query page, and
  reuses the same shared selection and decision authority as Media. No second result state or decision
  flow exists.
- Cancellation is a durable storage-owned request across every operation-owner table. Nonterminal
  work is marked `cancel_requested`, drained by stable ID pages, and scoped to the affected Run when
  possible. Runtime adapters receive one composed `AbortSignal`; startup, notification, and
  post-settlement drains converge on the same path. One failed observer or drain cannot suppress
  sibling work, and canceled Delivery destinations do not enqueue follow-up work.
- Migration rehearsal and browser-state sealing now have one explicit success/failure outcome and
  always finalize handles and exclusive files. Primary and cleanup failures are preserved together;
  cleanup cannot mask a materialization or publication failure.
- The IPC migration guard now binds the actual 150-site desktop-main registration inventory rather
  than testing only synthetic fixtures. New or stale registrations fail both the direct CLI and the
  repository integration test. The generated header states that reviewed Legacy entries remain
  migration debt, so a green guard cannot be mistaken for Gate C completion.
- Legacy browser-state snapshot v2 covers all ten frozen keys and distinguishes `present`, `absent`,
  and fail-closed `capture_error`. Raw values and the absolute Chromium profile path remain only in
  the private sealed snapshot. Public evidence contains per-value raw hashes, irreversible
  run/session/profile/challenge fingerprints, the canonical origin (`opaque:file` for file storage),
  timestamp, and public fingerprints. Browser session evidence is reduced to stable Chat/Message IDs
  and compared exactly with the canonical SQLite mirror; a missing Skills key yields one canonical
  empty renderer export. Applying captured provider/settings/locale/theme preferences is Gate B work.
  The real trusted Chromium collector is Gate A work and was not implemented or run.
- Browser fixture journeys covered Overview, Media Compare, Delivery, protected confirmation,
  Project Home, settings, Commander Focus, and Chat lifecycle at 1440x900, 1100x800, 390x844, and
  320x800. The final 20 generated audit screenshots and interactive state screenshots were inspected.
  A separately rerun 11-test Playwright suite covered navigation, Project/Chat/Message/Run creation,
  result decision/undo, Canvas placement, exact protection confirmation, Delivery binding/cancel,
  canceled destination selection, global media, invalid-route canonicalization, and the 320px/390px
  critical Project route. Keyboard focus, reduced motion, real preview rendering, exact cancel/confirm
  requests, direct Result decisions, route reload, and responsive geometry passed with no page or
  section overflow, broken media, or final console/page/request failure. This is fixture-browser
  evidence; the installed native Electron shell remains Gate B.

## Frozen target-only RC v3 evidence

After every fixture/reviewer process stopped, three consecutive serial clean emits produced identical
results:

- schema: `lucid-fin.target-rc-build/v3`;
- source/emitted closure SHA-256:
  `a22bac8ae94d2328cb6eb274b1a535e55f569d9a3405f50316dbe3170f15bce9`;
- bound input SHA-256:
  `9bda767fcf35a51c7db7536aa16fdbbed8645f1269c8a819d1de33a398a461c9`;
- metadata SHA-256:
  `f672fe3e398b1c05f67704bb5eedad7f6802ece7f58d495d5ad8b5b043c3c22b`;
- four runtime entrypoints, 187 emitted audit roots/closure files, 217 bound inputs, nine
  configurations, and 718 emitted artifacts (128 contracts, 564 storage, 4 runtime, 9 main, 10
  preload, and 3 renderer);
- Node `v26.5.1`, TypeScript `6.0.2`, Vite `8.2.1`, `@vitejs/plugin-react` `6.0.5`,
  and Rolldown `1.2.3`.

RC v3 audits every parsed Target tsconfig root, package export, static source dependency, triple-slash
reference, effective type/typeRoot/path input, exact Vite configuration, Rollup module provenance, and
every emitted JS/CJS/MJS/HTML/CSS root. It rejects unresolved/non-target/Legacy paths and ordinary
direct, property, computed, reflection, or simple-alias dynamic-code loaders before emit. The four true
runtime entrypoints are recorded separately from the complete emitted audit-root set.

The isolated renderer build derives non-workspace runtime dependencies from the hashed Target package
manifests. Exact package exports are aliased to clean emits in longest-subpath-first order and deduped,
with wildcard exports rejected. Renderer canonical serialization uses the Zod-free
`@lucid-fin/target-contracts/canonical-json` export, so the emitted renderer closure does not inherit
Zod's `Function` capability.

Rolldown is given the isolated build tree as its `cwd`, so non-minified module-region labels cannot
embed the random temporary-directory suffix. Emitted JS/CSS/HTML is also rejected if that isolated
path marker appears. The final three serial clean builds matched in every reported hash and count.

The RC has no default production-adapter composition: direct startup fails with
`target_rc_production_adapters_unavailable` instead of falling back to Legacy or returning synthetic
success. Composing real production adapters and changing the official entry remain Gate B work.

## Reproduction commands

From the repository root with the pinned toolchain and settled Target inputs:

```powershell
pnpm run test:target -- --reporter=dot --testTimeout=120000 --maxWorkers=1 --no-file-parallelism
pnpm run test:e2e:target
pnpm exec vitest run --testTimeout 120000 scripts/seal-legacy-browser-state.test.ts scripts/migrate-legacy-skills.test.ts scripts/migrate-legacy-skills.sqlite.test.ts scripts/generate-target-preload.test.ts scripts/generate-target-contracts.test.ts scripts/check-target-only-rc.test.ts scripts/check-ipc-migration-allowlist.test.ts scripts/build-target-rc.test.ts
pnpm exec tsc --noEmit --strict --target ES2022 --module NodeNext --moduleResolution NodeNext scripts/check-target-only-rc.ts scripts/build-target-rc.ts scripts/target-rc-test-fixture.ts
pnpm exec tsx scripts/generate-target-contracts.ts --check
pnpm exec tsx scripts/generate-target-preload.ts --check
pnpm exec tsx scripts/gen-preload.ts --check
pnpm exec tsx scripts/check-ipc-migration-allowlist.ts
pnpm exec tsx scripts/check-target-only-rc.ts
pnpm exec tsx scripts/build-target-rc.ts
pnpm exec tsx scripts/build-target-rc.ts
pnpm exec tsx scripts/i0-baseline.ts --check
```

The clean-emission commands remove their temporary roots and write no worktree `dist`, package,
installer, or release artifact.

## Remaining approval boundary

The controlled disposable-root tests do not claim hostile same-user filesystem atomicity on Windows.
Node 26 lacks the directory-handle/no-follow/openat/no-replace primitives needed for that claim. Gate A
therefore requires all writers to be closed and independently checked, plus a newly created,
operator-owned, ACL-protected same-volume parent. If either condition cannot be proved, the real copy
must stop.

Gate A must also supply and review the trusted Chromium collector that binds the exact WebContents,
profile/session/origin, run/session identifiers, and fresh challenge before passing a branded ten-key
capture to the v2 sealer. Caller-authored JSON, `capture_error`, a public absolute profile path, or a
non-exclusive evidence destination is a stop condition. Gate B must separately compose the real
Target production/native adapters and validate the installed Electron shell, settings, locale, and
theme behavior; none of those operations occurred in I7.

The exhaustive retained/not-authorized deletion inventory is
[`2026-08-25-i7-target-rc-deletion-manifest.md`](./2026-08-25-i7-target-rc-deletion-manifest.md).
I7 proves zero callable/discoverable Legacy closure for the Target RC, not repository-wide deletion.
