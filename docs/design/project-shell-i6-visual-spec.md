# I6 Project Shell Visual Specification

## Status and authority

This is the implementation-facing visual specification for the canonical Project shell renderer. It
does not authorize a change to the frozen information architecture.
`project-shell-screen-contract.md` and `project-workspaces-contract.md` win where this document is
silent or conflicts with older terminology in `PRODUCT.md`.

Reference: [`../../.impeccable/mocks/i6/project-shell-workspace-reference.png`](../../.impeccable/mocks/i6/project-shell-workspace-reference.png).
The reference illustrates the wide working state; it is not a source of new product behavior.

## Visual direction

Preserve the incumbent professional video-tool language: cool, near-black blue-gray planes; thin
structural seams; compact controls; restrained blue only for focus and primary action. The UI should
feel calm and durable while media, candidate comparison, and visible work carry the visual weight.
It is not a marketing dashboard, terminal, glass surface, or high-saturation creative canvas.

Use the existing dark tokens without introducing a parallel palette:

| Purpose                | Existing token / value                                                         | Use                                                  |
| ---------------------- | ------------------------------------------------------------------------------ | ---------------------------------------------------- |
| Workspace field        | `--background` / `hsl(220 16% 6%)`                                             | Canvas-like central ground and unselected voids      |
| Panel plane            | `--card` / `hsl(220 14% 9%)`                                                   | Navigation, Dock, sheets, contained feed sections    |
| Raised control         | `--surface` / `hsl(220 14% 12%)`                                               | Inputs, compact controls, selected thumbnail chrome  |
| Quiet selection        | `--secondary` / `hsl(220 14% 14%)`                                             | Hover, grouped context, subtle row fill              |
| Structural seam        | `--border` / `hsl(220 14% 15%)`                                                | 1px column boundaries and row dividers               |
| Primary action / focus | `--primary` / `hsl(213 94% 56%)`                                               | Selected nav, send, clear direct actions, focus ring |
| Text                   | `--foreground` / `hsl(220 10% 88%)`; `--muted-foreground` / `hsl(220 10% 50%)` | Hierarchy, never low-contrast decorative copy        |

Keep the existing 6px radius, Inter/system font stack, 13px body, and compact 11–12px controls.
Section labels use the incumbent 11px, 600-weight, uppercase, tracked panel-header treatment.
Media receives the strongest contrast; borders and shadows stay quiet. Hover and selection should
change surface/border first, with blue reserved for the active destination or affirmative action.

## Wide Project Shell (`>= 1280px`)

Use a 40px application title bar above a four-column working surface:

```text
Global rail (48) | Project navigation (176) | current workspace (min 560, flex) | Commander Dock (400 default)
```

- Columns fill the viewport height below title chrome; 1px seams define boundaries. The Dock has a
  visible but quiet resize divider and may resize between 352px and 480px.
- Global rail contains only Projects, Global Media, and Settings. Icon buttons are 36–40px targets,
  with tooltip and selected state; it is not a second project navigator.
- Project navigation begins with persistent Project identity and one overflow menu for rename,
  archive, and settings. The stable order is **Overview, Canvas, Media, Production, Delivery**.
  Small factual count/status badges may appear at row ends, never generic traffic-light decoration.
- The current workspace has its own scroll container. Commander has a separate scroll container.
  Resizing/collapsing the Dock does not disturb a workspace route, selected object, scroll position,
  or Canvas camera.
- Central content uses 20–24px outer padding, 12–16px feed rhythm, and row dividers before adding
  card boundaries. Do not turn the surface into a grid of equal cards.

## Project Home

Project Home is a compact, sortable list, not a card gallery. A primary “New Project” action opens a
brief Composer with optional attachments rather than a configuration wizard.

- Rows are 64–76px with a 40–48px representative thumbnail, Project name, one-line last meaningful
  outcome/current work summary, last activity, and compact factual indicators for active/waiting work,
  decisions, and delivery readiness.
- The whole non-disclosure portion of a row opens the saved Project workspace and Chat. A trailing
  overflow disclosure owns rename, archive, export metadata, and permanent deletion entry points.
- Empty state contains one prominent composition field and attachment action: describe the film or
  attach a reference. It must not expose prompts, styles, presets, templates, tools, or workflow setup.

## Workspace treatments

All five routes retain the same shell chrome and shared selection. The selected object is visually
consistent across destinations and becomes a removable Commander context chip; no workspace fabricates
a duplicate record or an independent activity panel.

| Route      | Primary composition                                                        | Visual priority                                                                                                                                                  |
| ---------- | -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Overview   | Ordered decision feed                                                      | Waiting decisions first; then direction/intent, one active Commander summary, recent results/changes, readiness/blockers. Use direct row actions, not KPI tiles. |
| Canvas     | Deep workspace field with spatial nodes and a compact contextual inspector | Dark open ground, media thumbnails and semantic relationships. Nodes project authoritative facts; selection is a blue outline/handle, not a new data state.      |
| Media      | Library / Candidates / Compare / Detail views                              | Candidate thumbnails and side-by-side comparison dominate. Selected, rejected, and generation states remain visibly distinct and readable.                       |
| Production | Direction, Story, World, and Shots object views                            | Structured editorial detail, evidence/provenance, concise diffs, and direct correction. Never surface prompt/preset/template management.                         |
| Delivery   | Sequence, Review Cut, Checks, and Export views                             | Ordered source material and explicit missing decisions lead. Protected export presents its frozen manifest and typed reason before the final action.             |

For Overview's common working state, render a decision or candidate comparison strip first, followed by a
short direction block, then one compact active-work summary and a chronological meaningful-change list.
This sequence gives visual media prominence without presenting a generic dashboard.

## Commander Dock

Commander is a fixed fourth column in workspace mode—not a floating panel or modal. Its vertical
regions are fixed in this order:

1. Chat selector, New Chat, Search, Focus.
2. Project and active-context line.
3. Independently scrolling conversation timeline.
4. Removable context chips immediately above the Composer.
5. Composer with attach, stop/send, and follow-up state.
6. Small persistent Model, Permission, and Budget status line.

The active Assistant response owns all current Run presentation. Its compact inline TaskList shows
completed, current, and pending work in one scanable column; child work is nested only when it exists.
Questions, confirmations, result actions, errors, public execution disclosure, and final summary occur
at the exact point in that response. Do not add a separate activity card, status console, tool catalog,
or duplicate Commander view.

Use a clear active state such as “Waiting for provider · 28s” alongside text and icon. The Composer
remains reachable while work is running; exact accepted context is shown as chips but can be changed
only for the next message. Show high-level permission/budget constraints as quiet factual text, not a
full settings form.

## Focus mode

Focus replaces the central workspace composition rather than layering over it:

```text
Project Chats | Commander conversation | result / Project-change inspector (only when selected)
```

- Preserve the same Chat and transcript location. The inspector is collapsed until the user selects a
  result, decision, or Project change.
- A visible Exit Focus action and Escape return to the prior workspace with its route, scroll,
  selection, Canvas camera, and Dock width/collapsed state intact.
- Focus has no floating window, no duplicate Run, and no new Chat state.

## Responsive behavior

| Range                 | Shell behavior                                                                                                                                                                                                                                                                                 |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Wide (`>=1280px`)     | Full global rail, text Project nav, independent workspace, resizable fixed Dock.                                                                                                                                                                                                               |
| Medium (`960–1279px`) | Keep the global rail; compact Project nav to icon/label affordances. The Dock no longer consumes width when collapsed and only overlays after an explicit expand action. Prefer Focus for sustained conversation/review.                                                                       |
| Narrow (`<960px`)     | One primary surface at a time. Persistent header navigation exposes Back to Project and the active Chat. Selecting Commander opens Focus in the content area, never a floating panel. Composer, current work, waiting decision, and stop action remain reachable without horizontal scrolling. |

At every width, use text plus icon for status, preserve 40px minimum pointer targets for primary
controls, permit EN/ZH expansion without clipping action/status labels, and honor the existing
reduced-motion behavior. Keyboard order follows shell → project navigation → workspace → Commander;
all tabs, chat controls, disclosures, candidate actions, attachments, and Focus controls are reachable.

## Implementation guardrails

- Preserve separate scrolling and route/selection restoration across shell transitions.
- Back every visible action with canonical IPC/domain authority, or render it disabled with a typed reason.
- Do not expose internal resource UI, prompt/style/preset/template/tool-injection managers, raw tool
  names, or private reasoning in the Project shell.
- Treat empty, loading, recovering, failed, blocked, and partial-result states as first-class compact
  workspace states; completed work and valid results remain visible.
