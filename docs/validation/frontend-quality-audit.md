# Desktop frontend quality audit

## Status: complete

The 2026-08-28 desktop frontend audit is complete at tested product commit
`f94ea0368b4e0a2813f438fe56834a4f6ff67b7e`. This document is the handoff record for the usability,
interaction, responsive-layout, and New Project identity follow-up. No implementation work remains
for this audit.

## Scope and acceptance

The audit covered Projects, New Project, all five Project workspaces, Commander, Project settings,
Project lifecycle menus, Global Media, minimum-window behavior, keyboard dismissal, hover feedback,
clipping, and hidden-scrollbar behavior. Acceptance required every visible control to have a real
action, one clear route to each authority, readable and inset content, visible interaction feedback,
and no horizontal document overflow at the supported 1024 by 720 minimum window.

New Project has one identity source: the trimmed description is sent unchanged as both the Project
name and first Chat title. There is no separate optional name field and no first-four-words heuristic.
The description is bounded to the canonical 240-character Project-name limit. A reference-only
submission uses `Untitled Project` because it has no description.

## Evidence and root causes

The rendered and static audit found these related product issues:

- New Project had two competing name sources: an optional name input and a derived four-word title.
- Global Settings and metadata export were visible but intentionally disabled. They looked like broken
  product controls and had no authority to open.
- Buttons, disclosure rows, menu actions, form fields, and settings Skill rows did not share a visible
  hover/pressed response.
- Project and Chat lifecycle menus lacked a complete Escape/focus-leave dismissal path. The Project
  menu could remain open behind its delete confirmation.
- At medium width, Commander started at the top of the window and covered the workspace-header toggle
  that was required to close it.
- Long Project/Chat context, Delivery rows, Focus titles, the New Project action row, and the Commander
  action row could clip or touch their borders.
- Canvas placement allowed negative coordinates while the field hid overflow, making an object
  possible to lose without a recovery route.
- Commander search, Commander compose, and New Project description lacked explicit accessible names.

The fixes converge on shared behavior rather than adding parallel controls:

- Project description now owns Project and first-Chat identity; the redundant name field and derived
  naming helper were deleted.
- Unavailable Global Settings and metadata-export controls were removed. Project settings remains the
  single workspace-header authority, and Archive remains inside that panel.
- Shared hover, pressed, focus-safe, and reduced-motion rules cover interactive elements; destructive
  hover treatment remains explicit.
- Lifecycle menus close on Escape or focus leaving. Delete closes its menu before opening the existing
  confirmation dialog.
- The medium Commander overlay begins below the 58-pixel workspace header, so its toggle stays
  reachable. Flexible action rows, ellipsis/wrapping, and Delivery insets remove the observed clipping.
- Canvas coordinates are clamped at zero and positive overflow remains scroll-reachable while default
  scrollbars stay hidden application-wide.
- The New Project composer can be closed without losing its draft, and attached references can be
  removed before submission.

## Validation ledger

| Check                  | Observed result                                                                                                                                                                                                                                                                                                                                        |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Renderer behavior      | `pnpm test -- apps/desktop-renderer/src` — exit 0; 8 files and 74 tests passed. The first sandboxed attempt was blocked before startup by Windows `spawn EPERM`; the identical command passed outside that sandbox.                                                                                                                                    |
| Native desktop journey | `pnpm run test:e2e` — exit 0; 3 Playwright/Electron tests passed. The new audit test clicks every workspace, opens and closes settings, exercises lifecycle menus and delete cancellation, opens Global Media, verifies hover feedback, resizes to 1024 by 720, and checks Commander access and document overflow.                                     |
| Type and build         | `pnpm run test:types` and `pnpm run build` — exit 0. The renderer emitted approximately 60.62 kB CSS, 133.37 kB application JavaScript, and 239.47 kB vendor JavaScript.                                                                                                                                                                               |
| Static quality         | `pnpm run lint`, `pnpm run format:check`, and `pnpm run check:production-closure` — exit 0.                                                                                                                                                                                                                                                            |
| Diff integrity         | `git diff --check` and `git diff --cached --check` — exit 0 before the product commit.                                                                                                                                                                                                                                                                 |
| Visual review          | One before and one after Electron capture set covered wide Projects/Overview/workspaces/settings and medium Commander/menu/Global Media states. The final set showed a reachable Commander toggle, inset content, readable truncation, no duplicate New Project control, and visible menu hover. Temporary images and capture statements were removed. |
| Impeccable detector    | The required one-time final mechanical detector returned `[]`.                                                                                                                                                                                                                                                                                         |

A broad repository `pnpm test` attempt made no progress and was interrupted rather than represented as
a pass. The changed renderer boundary has complete 74-test coverage in this handoff, the three native
desktop journeys passed, and the repository's earlier full 856-test result remains recorded in
[`production-cutover.md`](./production-cutover.md).

The final process check found no new task-owned Electron, Playwright, Vitest, Git, or repository Node
process. The only `%TEMP%\lucid-fin-e2e-*` directories remaining predate this task (2026-08-14), so
they were preserved. Existing user Electron and Codex MCP process trees were identified and left
running.

## Cross-PC continuation

There is no follow-up plan for this audit. On another PC, update `main`, verify `HEAD == origin/main`,
install the locked dependencies, and run:

```powershell
pnpm run test:types
pnpm run build
pnpm test -- apps/desktop-renderer/src
pnpm run test:e2e
pnpm run lint
pnpm run format:check
pnpm run check:production-closure
```

The Electron test profiles are disposable and must not be replaced with a real or older application
profile. Any new feature, data migration, compatibility behavior, release, or visual redesign starts
a separate goal.
