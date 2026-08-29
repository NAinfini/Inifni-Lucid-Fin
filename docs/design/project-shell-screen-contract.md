# Project Shell and Commander Screen Contract

## Status

Implemented product contract. This document defines the canonical shell behavior and information
architecture.

This is the sole shell for the Lucid Fin AI video production Harness. Overview, Canvas, Media,
Production, and Delivery share one Project model and one Commander surface through the typed desktop
API; the renderer does not read databases, provider credentials, or host resources directly.

This screen contract implements the product model in
[`../plans/2026-08-15-project-first-lucid-fin.md`](../plans/2026-08-15-project-first-lucid-fin.md) and
renders the public Run, TaskList, Subagent, result, and final-summary behavior in
[`../plans/2026-08-15-commander-runtime-tool-surface.md`](../plans/2026-08-15-commander-runtime-tool-surface.md).

## Job and audience

Filmmakers, creative directors, and small production teams arrive with an idea, existing footage, or
visual references. They need to direct an AI production partner without learning prompts, tools,
workflow graphs, or internal agent concepts.

The interface succeeds when the user can immediately understand the Project, tell Commander what to
do, see real work and media results, make precise creative decisions, and return to the production
surface without losing context.

## Experience thesis

Lucid Fin adopts the project, thread, visible-work, review, and resumability grammar of Codex and
Claude Code, translated into a media-production environment. The Project workspace remains primary;
Commander is a fixed production partner that can enter a dedicated Focus mode when conversation and
review become the main task.

The interface does not imitate a terminal or code editor. Media, shot structure, spatial organization,
candidate comparison, and delivery decisions are the dominant visual material.

## Topology

### Workspace mode

```text
Global rail | Project navigation | Current workspace | Commander Dock
```

- Global rail owns Projects and Global Media. Its unavailable global Settings control may appear
  outside a Project, but the Project shell omits it; it never aliases Project settings.
- Project navigation owns Overview, Canvas, Media, Production, and Delivery.
- Current workspace owns the user's direct production task.
- Commander Dock owns Project Chats, conversation, active work, results, and the Composer.

Workspace and Commander remain independently scrollable. Resizing or collapsing Commander must not
reflow Canvas objects, discard workspace selection, or reset workspace scroll.

### Focus mode

```text
Project Chats | Commander conversation | Result / selected object inspector
```

Focus mode replaces the central workspace composition; it is not layered over it. The inspector is
present for a supported selected result or workspace object and otherwise remains collapsed. Recent
History changes expand only inside Overview and never trigger Focus.

Leaving Focus restores:

- The previous Project workspace.
- Workspace route and scroll.
- Current selection.
- Canvas camera.
- Commander Dock width and collapsed state.
- The same Chat and transcript position.

## Projects home

### Existing Projects

Projects use a compact, sortable list rather than a dashboard of equal cards. Each row may show:

- Project name and representative thumbnail.
- Last meaningful outcome or current work summary; there is no host-defined production stage.
- Last activity time.
- Active or waiting Commander indicator.
- Count of decisions that need the user.
- Delivery readiness when applicable.

Opening a row returns to the last Project workspace and Chat. A separate disclosure contains rename,
archive, export metadata, and permanent-delete entry points; destructive actions never occupy the
primary row.

### New Project

The primary action opens a brief Composer, not a configuration wizard. The user can:

- Describe the intended film.
- Attach images, video, audio, or documents.
- Optionally name the Project.

Submission creates the Project and its first Chat, opens Overview, and starts the first Commander Run.
Provider, budget, and permission defaults are inherited from Settings and remain visible before send.

### Empty state

The empty state explains one action: describe the film or attach a reference. It does not ask the user
to configure style, prompts, presets, templates, entities, workflow, or tools before starting.

## Project Shell

### Desktop window chrome

Electron hides the default operating-system title bar. The renderer owns the sole Lucid title-bar
surface, drag region, and inner window border, while the native Windows controls overlay retains
minimize, maximize, close, resize, and accessibility behavior. Content reserves the overlay control
area and never places clickable app actions beneath it.

### Project identity

The shell persistently shows Project identity and the active workspace. The workspace-header gear is
the only Project settings entry. Rename and Archive Project live inside that panel; Archive is never a
persistent navigation-footer action. Commander and Project navigation do not duplicate the settings
entry. Project-wide activity never becomes a second Chat or TaskList UI.

### Project navigation

Navigation order is stable:

1. Overview
2. Canvas
3. Media
4. Production
5. Delivery

Items may display small factual badges for waiting decisions, active generation, or delivery blockers.
Badges navigate to the owning object or review surface; they do not open generic status modals.

### Overview contract

Overview is the default Project route and shows, in priority order:

1. Decisions that require the user.
2. Current direction and latest explicit user intent.
3. Active Commander work.
4. Recent generated results and Project changes.
5. Production completeness and Delivery readiness.

Overview uses a prioritized feed with direct actions. It is not a KPI dashboard or a grid of generic
cards. Recent change labels are human-readable projections of typed history metadata. Each row toggles
one inline details region and can be closed from the same row; it never opens Focus or relocates the
Commander Dock.

## Commander Dock

### Fixed regions

```text
Chat selector / New Chat / Search / Focus
Project and active context
----------------------------------------
Conversation timeline
----------------------------------------
Context chips
Composer
Model / permission / budget status
```

The top Chat control changes or creates Project-scoped Chats without leaving the workspace. Search
finds Chats and messages within the current Project. It does not search unrelated Projects unless the
user leaves the Project boundary.

### Context chips

Current workspace selection appears immediately above the Composer as removable chips. A chip may
represent a Shot, Production object, Canvas placement, Media item, generated result, Delivery item, or
explicit attachment.

Removing a chip changes the next message context only. Sending freezes the exact chip set into the Run.
Later workspace selection changes do not alter an accepted Run.

### Conversation

The timeline contains only user messages, Commander messages, results, questions, protected
confirmations, and compact public work details. It does not render private reasoning, raw provider
payloads, or a permanent tool catalog.

The current Assistant response is the single owner of active Run presentation.

### Composer

The Composer supports text, pasted media, file attachments, selected Project objects, queued follow-up
messages, stop, and send. Model, high-level permission mode, and remaining or unavailable budget stay
visible without dominating the message field.

The user may keep writing while work runs. A follow-up is delivered to the current Run when safe, or
queued as the next Run with that distinction visible.

## Inline active work

### Running response

```text
Creating character references

✓ Read the selected character and references
◉ Generate four candidates
○ Organize results for review

Waiting for the provider · 28s
```

- Task names are authored in the user's language by Commander.
- Completed, current, and pending steps remain scannable in one column.
- Tool activity is summarized by purpose, not internal function name.
- Optional Subagents appear nested under the Task they support. Expanding a child shows its public
  objective, progress, results, usage, blockers, and controls to send feedback, pause, or stop; it never
  exposes private reasoning.
- A disclosure exposes public execution detail, usage, artifacts, and blockers.

There is no separate `Agent Activity` card when the TaskList already communicates the work.

### Waiting for the user

Questions, permission confirmations, and result choices appear exactly where progress paused. The user
can answer naturally or use direct controls. A response never asks for a second approval merely because
the user used different wording.

### Completed response

The running TaskList transforms in place into a concise final summary:

```text
Completed · 2m 14s

What changed
- Created four character candidates
- Added them to Project Media
- Updated the character's reference relationships

Needs your decision
- Select a candidate, or describe what to refine

Open in Media Compare
Execution details ▸
```

The summary names real objects and provides direct routes into the owning workspace. It does not report
success only as Tasks or tool calls.

## Result review

Valid creative outputs are visible in Chat and the relevant workspace.

- Chat provides quick Select, Reject, Refine, and Use as reference actions.
- Media Compare provides the deep side-by-side review experience.
- Both surfaces update the same selection and UserChoice records.
- Commander may explain differences and recommend an option.
- Results are not silently discarded or selected by a background evaluator.
- A technical failure is visibly separate from an aesthetically weak but valid result.

Selecting a Chat result can open Media Compare or the corresponding Production / Delivery object while
preserving the Chat and transcript position.

## State contract

| State            | Primary presentation                                      | Available user actions                       |
| ---------------- | --------------------------------------------------------- | -------------------------------------------- |
| Idle             | Normal transcript and Composer                            | Send, attach, select context, switch Chat    |
| Running          | Inline TaskList in current response                       | Message, queue follow-up, inspect, stop      |
| Background       | Activity indicator on owning Chat and Project             | Open, inspect, stop                          |
| Waiting for user | Inline question, permission, or result decision           | Answer, select, refine, decline              |
| Completed        | Final summary and direct workspace links                  | Review, continue, start another Chat         |
| Failed           | Typed failure, completed work retained, clear recovery    | Retry when reconstructible, revise request   |
| Blocked          | Exact permission, budget, provider, or data blocker       | Resolve blocker or cancel                    |
| Recovering       | Rehydrating recorded public state; no duplicate execution | Wait, inspect recovered facts, cancel safely |

A stale or terminal TaskList never presents as running and never prevents ordinary Chat deletion. Data
with independent Project value remains governed by Project history and object ownership, not by Chat
lifecycle.

## Responsive behavior

- Wide: full Project navigation, workspace, and resizable Commander Dock.
- Medium: compact Project navigation; Commander may overlay only after an explicit expand action, while
  Focus becomes the preferred conversation mode.
- Narrow: one primary surface at a time with persistent navigation back to Project and the active Chat.
  Focus occupies the content area rather than opening a floating window.
- The Composer, waiting decision, stop action, and current work remain reachable without horizontal
  scrolling.
- Scrollable surfaces preserve wheel, touchpad, keyboard, and programmatic scrolling without showing
  default browser scrollbars. Controls and bordered content retain an interior inset at every width;
  long English and Chinese content shrinks or wraps instead of clipping.

## Keyboard and accessibility

- All regions participate in a predictable landmark and focus order.
- Focus mode traps nothing; Escape returns to the previous workspace when no nested control owns it.
- Chat switching, workspace navigation, Focus, Composer, attachments, candidate review, and Task
  disclosures are keyboard reachable.
- Status is conveyed by text and icon, never color alone.
- Running motion respects reduced-motion preferences.
- Media cards and generated candidates provide meaningful labels and technical metadata alternatives.
- English and Chinese layouts allow text expansion without truncating actions or status.

## Explicit anti-goals

- No floating Commander window.
- No default activity modal.
- No duplicate TaskList or run-status panel.
- No Unassigned Chat in ordinary product flow.
- No prompt, style, preset, template, or tool-injection setup before work can begin.
- No terminal imitation as the main visual language.
- No tool directory covering the conversation.
- No private chain-of-thought display.
- No result hidden because an AI evaluator preferred another result.

## Acceptance scenarios

1. A first-time user creates a Project from one sentence and two reference images without visiting
   Settings or configuring a workflow.
2. The user selects a Shot on Canvas, adds a Media reference, sends a request, then changes workspace
   selection; the accepted Run retains the original exact context.
3. Commander runs visibly in one inline response while the user continues working in Media.
4. A generated candidate appears in Chat and Media Compare; selecting it in either place updates both.
5. A waiting permission or creative decision appears at the exact paused point and resumes from the
   user's natural response.
6. Focus mode opens the same Chat, Tasks, and results without duplicating state, then restores the
   prior Canvas camera and selection on exit.
7. A failed or interrupted Run preserves completed results and offers only truthful recovery actions.
8. A new Chat can use shared Project Memory without importing the full transcript of another Chat.
9. A completed response summarizes real Project outcomes and links directly to the changed objects.

## Confirmed decisions

1. Projects Home uses a compact list, not large project cards.
2. New Project begins with one brief Composer and optional attachments, not a wizard.
3. The result inspector in Focus mode stays collapsed until a result or Project change is selected.
4. Background progress is shown only on the owning Chat and Project; there is no global activity
   dashboard in the initial rebuild.

The detailed responsibilities and ownership boundaries of Overview, Canvas, Media, Production, and
Delivery are defined in
[`docs/design/project-workspaces-contract.md`](./project-workspaces-contract.md).
