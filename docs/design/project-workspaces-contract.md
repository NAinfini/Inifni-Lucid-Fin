# Project Workspaces and Ownership Contract

## Status

Planning only. This contract defines the responsibilities, object ownership, navigation, and shared
interaction model for Overview, Canvas, Media, Production, and Delivery. It does not authorize source
changes, schema migration, deletion, or release work.

These are native workspaces of the ground-up AI video production Harness. They replace the legacy
Canvas/resource application model; they are not projections layered over old nodes, resource
managers, prompt/preset editors, or duplicate renderer stores.

This ownership contract implements the product model in
[`../plans/2026-08-15-project-first-lucid-fin.md`](../plans/2026-08-15-project-first-lucid-fin.md), uses
the authority and history rules in
[`../plans/2026-08-15-project-data-history-memory-cutover.md`](../plans/2026-08-15-project-data-history-memory-cutover.md),
and exposes the capabilities defined in
[`../plans/2026-08-15-commander-runtime-tool-surface.md`](../plans/2026-08-15-commander-runtime-tool-surface.md).

## Job and audience

The Project workspace is for a filmmaker or creative team directing a production, not administering
an AI system. The user should be able to move from intent to visible media, compare alternatives,
correct the film, and deliver it without deciding which prompt, tool, workflow, or Subagent should run.

Commander manages the production method and keeps the Project coherent. Each workspace presents the
objects needed for one kind of creative decision. No workspace owns a duplicate copy of another
workspace's facts.

## Structural thesis

```text
Project
├─ Overview    projection of what matters now
├─ Canvas      spatial organization
├─ Media       source and generated media review
├─ Production  creative truth and shot structure
└─ Delivery    selected sequence and export intent

Commander Dock
└─ works across the Project through the same authoritative objects
```

Navigation changes the user's working surface, not the underlying Project. A Shot selected in
Production, placed on Canvas, reviewed in Media, and used in Delivery is one Shot with references from
the other domains, not four synchronized Shot records.

## One fact, one owner

| Fact or object | Authoritative owner | Other workspaces may |
| --- | --- | --- |
| Project identity, settings, permission and budget defaults | Project | Read and link |
| Current explicit user request and decisions | Project History | Render a projection |
| Current derived creative memory | Project Memory | Query and explain provenance |
| Character, location, scene, sequence and Shot facts | Production | Link, place, review and revise through the owner |
| Immutable file bytes and technical metadata | MediaBlob; Global Media owns catalog identity | Reference, never duplicate bytes |
| A Project's use, label and relationship for a media asset | Media | Link and select |
| Generated candidate, provider parameters and prompt/reference provenance | Generated Result | Review, compare, select and link |
| User select, reject, refine, use-as-reference and undo actions | User Choice / Project History | Render consistently everywhere |
| Position, size, grouping, viewport and edges | Canvas | Read only when spatial context matters |
| Final order, chosen clip, trim, audio preference and export intent | Delivery | Link back to Shot and Result |
| Chat transcript | Chat | Read only inside that Chat |
| Public Run progress and final summary | Run / TaskList | Render in Chat and owning Project status |

Overview owns no production facts. Commander owns no secret second Project database. Project Memory is
a derived view over recorded evidence and must point back to the events and objects that support it.

## Shared selection model

The shell has one ephemeral Project selection that can contain one primary object and a bounded set of
supporting references. Each workspace contributes selections in its own visual language:

- Canvas selects placements but resolves them to their authoritative Production, Media, Result, or
  Delivery objects.
- Media selects assets or generated candidates.
- Production selects creative objects such as a Character, Scene, or Shot.
- Delivery selects a sequence item and its chosen result.
- Overview selects the object behind a decision, result, change, or blocker.

The Commander Composer mirrors this selection as removable context chips. Sending creates an immutable
Run snapshot containing the exact selected object IDs, revisions, references, attachments, Project,
Chat, permissions, and budget. Changing selection after send affects the next message only.

Direct navigation preserves the shared selection when the destination can represent it. If it cannot,
the destination shows the owning object in a contextual inspector rather than manufacturing a local
copy. Closing an inspector does not clear the shared selection.

## Overview

### Purpose

Overview answers three questions: what is the film becoming, what is Commander doing, and what needs
the user's attention next. It is the Project's prioritized decision feed, not a dashboard of generic
metrics.

### Primary content order

1. Decisions waiting for the user: result selection, material ambiguity, protected permission, budget
   expansion, or Delivery choice.
2. Current direction and the latest explicit user intent, with provenance and a route to Production or
   the originating Chat.
3. Active and queued Commander work, summarized once from the owning Runs.
4. Recent generated results and meaningful Project changes.
5. Production readiness and Delivery blockers.

### Actions

Overview may expose fast decision actions such as Select, Reject, Refine, Answer, Resume, or Open. It
does not become a general object editor. Editing the content of a Character, Shot, sequence, or media
relationship opens the owning workspace or sends a natural-language correction to Commander with the
object attached.

### States

- New Project: show the accepted brief, attachments, and visible first work.
- Quiet Project: show the last meaningful outcome and a clear Composer entry point.
- Running: show one live summary per active Chat, never a second TaskList.
- Waiting: place the exact decision first and explain what continues after it.
- Recovering or failed: retain completed results and show only truthful recovery actions.

## Canvas

### Purpose

Canvas is the infinite spatial surface inside a Project. It helps the user arrange, connect, and see
relationships between production objects and media. It is not the Project itself and not an
authoritative creative database.

### Canvas owns

- Placement and size.
- Grouping and visual regions.
- Directed and descriptive edges.
- Viewport, zoom, and saved spatial views.
- Optional annotations whose meaning is explicitly spatial.

### Canvas references

- Production objects.
- Project media references.
- Generated results.
- Delivery items or review milestones when spatially useful.

Node titles, thumbnails, status, creative facts, selection state, and provenance are projections from
the authoritative object. Editing an object's substantive content from a Canvas inspector writes to
that object's owner through the same command path used elsewhere; Canvas stores only the placement.

### Interaction

- Clicking a node selects its authoritative object and opens a compact contextual inspector.
- Multi-selection becomes Composer context without force-injecting the entire Canvas.
- Dragging changes placement only.
- Linking creates a typed relationship only when its meaning is explicit; a decorative line remains a
  Canvas edge and cannot silently become a Production fact.
- Commander may arrange or annotate Canvas reversibly. Permanent deletion of an authoritative object
  remains a protected action in the owning domain.

### States

- Empty: offer to place existing Project objects, attach media, or ask Commander to organize current
  work; do not require creating a special node first.
- Loading or large Project: stream placements and thumbnails without blocking the Commander Dock.
- Missing referenced object: show a recoverable broken reference, not a blank node or copied fallback.

## Media

### Purpose

Media is the Project's source and result review workspace. It makes provenance, comparison, selection,
and reuse legible while Global Media remains the byte store.

### Views

1. Project Library: media explicitly referenced by this Project.
2. Candidates: generated results grouped by request, Shot, or creative object.
3. Compare: two or more candidates with synchronized playback, reference view, and relevant technical
   metadata.
4. Detail: full provenance, relationships, usage, feedback history, and routes to Production,
   Delivery, Canvas, or the originating Chat.

### Selection and feedback

Chat quick actions and Media Compare write the same User Choice record. Select, Reject, Refine, Use as
reference, and Undo therefore appear consistently in both places. Rejected candidates remain
filterable and recoverable history; rejection is not file deletion.

Commander may compare candidates and recommend one, but every valid output remains visible. Automatic
retry is for bounded technical failure only. A valid but aesthetically weak result is shown to the
user with its real provenance.

### States

- No media: attach source material or request generation from the same Project Composer.
- Generating: show real candidate placeholders linked to the Run, not speculative media cards.
- Partial batch: show completed candidates and exact remaining or failed items.
- Provider failure: preserve sources and prior candidates; retry only when reconstructible.
- Missing local bytes: preserve the Project reference and provenance while showing a repair action.

## Production

### Purpose

Production is the authoritative creative model of the film. Commander manages and updates it from the
user's messages, references, choices, and corrections. The user can inspect and directly correct facts
without managing prompt infrastructure.

### Views

- Direction: premise, tone, visual direction, constraints, and current user-approved intent.
- Story: outline, sequences, scenes, beats, and script material appropriate to the Project.
- World: Characters, Locations, props, wardrobe, relationships, and continuity facts.
- Shots: Shot intent, framing, action, dialogue, duration, continuity, source relationships, generated
  candidates, and current selection.

These are object views, not mandatory sequential phases. Commander decides what structure is useful
for the request and can work with incomplete Production data.

### Editing and provenance

Commander may update unlocked facts automatically and records each change in Project History. User
messages, direct edits, selections, and undo actions remain first-class evidence. A fact the user has
explicitly locked is changed only after confirmation, but the lock is a recorded user choice rather
than a hidden creative code rule.

Conflicts are resolved from provenance and recency. The latest explicit user decision wins unless the
user asks to restore an earlier choice. Commander asks only when competing evidence would materially
change the result and cannot be reconciled safely.

Production does not expose Prompt, Style, Preset, Template, Process Prompt, Guide Injection, or Tool
Injection managers. Submitted generation prompts remain immutable provenance on Generated Results;
they are not manually synchronized creative facts.

### States

- Sparse brief: show only facts supported by evidence and let Commander build structure as needed.
- Conflicting facts: show the conflict and provenance at the affected object.
- Awaiting creative decision: link the exact alternatives and downstream effect.
- Changed by Commander: show a concise diff and route back to the Run and user request.

## Delivery

### Purpose

Delivery is the user's authoritative assembly and export intent. It answers what will be delivered,
in what order, with which chosen clips and audio decisions.

### Views

- Sequence: ordered Delivery items linked to Shots and selected Generated Results.
- Review Cut: playable assembled preview with visible missing or invalid items.
- Checks: duration, aspect, technical compatibility, missing media, embedded-audio preference, and
  unresolved user choices.
- Export: immutable manifest preview, destination, format, estimated cost or unavailable cost, and the
  protected final action.

### Control boundary

Commander may prepare an initial sequence, identify gaps, propose substitutions, trim suggestions, or
build a Review Cut. It never silently changes a user's selected clip, final ordering, trim, audio
preference, external destination, or irreversible export decision.

A user selecting a candidate for a Shot makes it the Shot's current creative selection everywhere. It
becomes eligible for an existing linked Delivery item, but does not silently reorder the sequence or
trigger export. When no Delivery item exists, Commander may propose or create a reversible draft item
within the accepted Run; the action remains visible in the final summary and Project History.

### States

- Empty: explain that Delivery is assembled from selected Project results; offer Commander preparation
  or direct addition.
- Incomplete: show exact missing Shot or result references in sequence order.
- Ready for review: make playback and user decisions primary.
- Ready to export: show the frozen manifest and protected action.
- Exported: retain manifest, hashes, destination receipt, and source choices as provenance.

## Cross-workspace production flow

### From a brief to visible work

1. The user creates a Project with a sentence and optional references.
2. Overview shows the accepted intent and the first Commander response.
3. Commander creates only the Production objects needed to do the work and records public changes.
4. The user can continue in Chat or open Production / Canvas without interrupting the Run.
5. Generated candidates appear in the current Assistant response and Media Candidates.

### From Shot direction to selected result

1. The user selects a Shot in Production or its placement on Canvas.
2. The user optionally selects reference media; all selections appear as Composer chips.
3. Sending freezes that exact context into the Run.
4. Commander submits a generation request bound to the Shot revision, selected references, prompt,
   provider, parameters, and budget.
5. Every valid candidate appears in Chat and Media.
6. The user Selects, Rejects, Refines, or Uses as reference from either surface.
7. The User Choice updates the Shot relationship and every projection; the original result and choice
   history remain intact.

### From selection to Delivery

1. The chosen result is available to its linked Delivery item.
2. Delivery exposes sequence impact and any missing choices.
3. Commander may prepare a reversible draft Review Cut.
4. The user reviews, changes order or selection, and confirms only protected actions.
5. Export uses one frozen manifest and records the receipt in Project History.

### Across Chats and restart

1. A new Chat starts with its own transcript and the same derived Project Memory index.
2. Commander queries only the facts and provenance relevant to the request.
3. Accepted Runs keep their exact context even if another Chat changes the Project.
4. On restart, public history, committed Project objects, choices, results, and guarded recovery state
   reconstruct the UI without duplicate execution or invented private reasoning.

## Commander integration

- The Commander Dock is present across all five workspaces and receives the same shared selection.
- A Run may navigate or update multiple workspaces, but every write goes through the authoritative
  owner and one typed execution pipeline.
- TaskList exists to help Commander track and communicate current work. It appears inline in the
  current Assistant response and transforms into a final outcome summary.
- Optional Subagents are nested inside the Task they support and inherit Project scope, permission,
  budget, and privacy boundaries. They do not get a separate workspace. Their append-only inbox lets
  the parent or user send bounded follow-up direction; expanding a child shows public objective,
  progress, results, usage, blockers, and pause/stop controls, never private reasoning.
- Final summaries name real changed objects, generated results, unresolved decisions, and direct routes
  to the owning workspace.

## Explicit anti-duplication rules

- Overview is a projection, never storage.
- Canvas never copies creative or media facts into node-local truth.
- Media never copies Global Media bytes or Production facts.
- Production never treats a submitted prompt as a second editable source of truth.
- Delivery never copies a candidate; it references the selected Generated Result.
- Chat never owns Project facts; its messages and decisions are evidence from which facts are derived.
- Project Memory never overwrites Project History and cannot hide contradictory evidence.
- TaskList never owns approvals, creative selections, Chat lifecycle, or object deletion guards.
- A status, question, result, or error appears once in its owning Assistant response and may be linked
  elsewhere; the shell does not create a parallel activity console.

## Acceptance scenarios

1. A user creates a Project from a short brief and sees meaningful work without configuring legacy
   resources or a workflow.
2. Selecting a Shot on Canvas and opening Production resolves to the same object and preserves the
   selection.
3. Moving a Canvas node changes only placement; editing its Shot intent updates Production and every
   projection.
4. A candidate selected in Chat is immediately selected in Media Compare and linked to the same Shot.
5. Rejecting a candidate keeps it available in history and does not delete its bytes.
6. Two Chats keep separate transcripts while using the same latest Project facts and recorded choices.
7. A Run keeps the selected revisions and references it accepted even while the user continues working.
8. Commander updates unlocked Production facts and presents a concise history diff; a user-locked fact
   pauses for confirmation before change.
9. An interrupted generation restores completed candidates and never repeats an ambiguous provider
   submission.
10. Delivery references selected results, exposes missing decisions, and exports only from a frozen
    user-visible manifest.
11. The inline TaskList becomes a Codex-style final summary of real Project outcomes and no stale Task
    blocks Chat deletion.
12. No ordinary Project flow exposes Prompt, Style, Preset, Template, Process Prompt, Guide Injection,
    Tool Injection, raw tool names, or private chain-of-thought.

## Confirmed product decisions

- Project is the top-level production object; Canvas is one spatial workspace inside it.
- The five primary Project workspaces are Overview, Canvas, Media, Production, and Delivery.
- Commander is a fixed Dock with Focus mode, not a floating panel.
- Chat quick selection and Media Compare share one User Choice state.
- Production facts are Commander-managed and user-correctable; no legacy resource manager remains.
- TaskList is Commander-managed inline progress; Subagents are optional and hidden when unused.
- The user sees and chooses among valid creative results; Commander does not silently make subjective
  selection decisions.

The persistent object, history, memory, and migration rules that support these workspaces are defined
in
[`docs/plans/2026-08-15-project-data-history-memory-cutover.md`](../plans/2026-08-15-project-data-history-memory-cutover.md).
