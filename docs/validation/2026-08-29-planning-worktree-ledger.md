# 2026-08-29 planning worktree ledger

## Purpose

This ledger prevents the uncommitted working tree from being mistaken for an approved or validated
implementation. It records state observed while the user explicitly kept the task in product-planning
mode.

## Baseline

- Branch: `main`
- `HEAD`: `a901255`
- `origin/main` at inspection: `a901255`
- Source implementation is not authorized by the current planning instruction.

## Uncommitted exploratory source themes

Work had started before planning-only status was clarified. The working tree contains approximately
1,787 added and 645 removed tracked lines across 38 files, plus untracked planning/design and Sequence
files. The themes are:

1. **Desktop shell exploration**
   - frameless Electron window options;
   - custom window-control IPC/preload path;
   - real `asset/Logo.png` in the title bar;
   - custom scroll and hover/focus styling;
   - early global rail changes.
2. **Sequence/Canvas authority exploration**
   - new Sequence contracts/storage files;
   - multiple/named/archivable Canvas concepts;
   - Chat restore and related wire changes;
   - removal attempts for Production relation ordinal and Delivery-owned ordering.
3. **Provider exploration**
   - an unconnected OpenAI Responses model adapter and focused unit tests;
   - no approved ProviderConnection/Profile Settings authority or live credential test.
4. **Planning and design artifacts**
   - target product/authority/provider/Skills documents;
   - Canvas/Assets/Settings visual references;
   - market research and the 2026-08-29 master plan.

## Validation observed before the planning stop

- Focused OpenAI adapter unit suite: 1 file, 6 tests passed.
- Earlier focused frameless/keytar tests: 2 files, 11 tests passed.
- Earlier focused contracts/Canvas/renderer tests: 3 files, 49 tests passed.
- A later focused preload group had two failures because generated/current source expected more wire
  methods than the stale built `@lucid-fin/contracts` package exported.
- A desktop-main TypeScript check subsequently showed the same stale built-contract export for the
  window-control channel; one adapter-local type issue was corrected afterward.
- No full typecheck, full test suite, Electron click-through, packaged smoke, live provider test,
  distribution build, or release validation supports this worktree.

Passing focused tests do not approve the architecture or prove the product journey.

## Required action before implementation

After the user approves the final plan, review every exploratory source hunk against the capability
matrix and target authority map. Classify each hunk as:

- retain and finish;
- rewrite into the final boundary; or
- discard because it was premature, incomplete, or conflicts with the approved model.

Do not commit the whole worktree as a batch. Do not reset or delete it without explicit approval and
an exact, reviewed target list. Do not claim any incomplete Provider, Canvas, Sequence, Settings, or
desktop path is production-ready.

## Documentation cleanup and remote handoff

The user authorized removal of old documentation and a commit/push after cleanup. The live
documentation set was reduced to six Markdown files and three design reference images. Sixty-four
old files under `docs/` plus the superseded root `PRODUCT.md` were removed. Tracked history remains
recoverable through Git; deleted documents are not current instructions.

The authorized handoff commit includes documentation cleanup and the retained planning package only.
It intentionally excludes every uncommitted exploratory source change listed above. Consequently, a
fresh remote clone receives the committed source baseline plus the new planning package, not the
originating PC's partial implementation.
