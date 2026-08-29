# Current goal and cross-PC handoff

## Status: active — product planning only

The current goal is to define the complete Lucid Fin redesign before implementation. The product is
being reframed as a project/chat desktop AI film-production workspace with semantic Canvases,
versioned cross-Project Assets, one Sequence authority, real provider roles, and controlled autonomous
production from intent to review cut.

The user has not yet authorized implementation of this new plan. A documentation-only handoff commit
and push is authorized; do not continue or commit source implementation, release, call paid
providers, or access prior application data until the relevant gate is explicitly approved.

## Current repository state

- Branch at planning start: `main`.
- Clean committed baseline: `a901255` (`origin/main` at the planning inspection).
- The originating PC contains uncommitted exploratory source changes created before the user
  clarified that planning must continue. They are intentionally excluded from the documentation-only
  handoff commit and therefore do not transfer through the remote repository.
- Those source changes are not an approved implementation. Before Gate 1 on the originating PC,
  compare them against the final plan and explicitly decide whether each change is retained,
  rewritten, or discarded. A fresh clone should start from the committed source baseline instead.

## Objective

Complete an evidence-backed plan that answers:

1. What the pre-redesign application supported, what the current application truly supports, and
   which behavior is retained, selectively ported, redesigned, or deleted.
2. The final user journey from a natural-language intent to a review cut and export.
3. The information architecture for Projects, Chats, Canvases, Sequence, Global Assets, and Settings.
4. The single authority for every mutable product fact.
5. Provider, credential, model-role, budget, and three-mode automation behavior.
6. The reclassification of historical Skills, presets, templates, and prompt resources.
7. The implementation gates, acceptance criteria, validation, and cross-PC takeover procedure.

## Decisions already fixed

- Project is a user-defined workspace; there is no mandatory Series/Service hierarchy.
- A Project contains multiple Chats and multiple Canvases.
- Chat/Run owns conversation and execution, never film facts.
- Canvas nodes are semantic Story/Scene/Shot/Character/Location intentions, not provider operations or
  individual candidate files.
- A semantic node contains many candidates derived from generated results, assessments, and durable
  decisions.
- Sequence is the only editable Scene/Shot/Clip order authority; Canvas geometry never determines
  playback or export order.
- Global Assets owns reusable versioned media, Characters, Locations, Worlds, Styles, Props, and
  Wardrobe across Projects; Project bindings pin exact revisions.
- Settings is the single global provider/credential/policy/Skills/Catalog control surface.
- Skills are procedures. Presets, camera vocabulary, styles, and shot templates become typed
  Creative Catalog or Shot Recipe data.
- Automation has Review every spend, Approve for me, and Full auto presets, all bounded by hard
  budget, credentials, destructive-action, overwrite, upload, sharing, and export-destination gates.
- The desktop interaction model is Codex-like, with the real logo, a custom frameless shell, visible
  hover/focus states, no raw event JSON, no dead-end details, and accessible custom scrolling.

## Read in this order

1. [`docs/goal.md`](goal.md)
2. [`docs/plans/2026-08-29-lucid-fin-product-redesign-master-plan.md`](plans/2026-08-29-lucid-fin-product-redesign-master-plan.md)
3. [`docs/plans/2026-08-29-current-vs-historical-capability-matrix.md`](plans/2026-08-29-current-vs-historical-capability-matrix.md)
4. [`docs/architecture/target-authorities.md`](architecture/target-authorities.md)
5. [`docs/design/2026-08-28-canvas-first-desktop-redesign.md`](design/2026-08-28-canvas-first-desktop-redesign.md)
6. [`docs/validation/2026-08-29-planning-worktree-ledger.md`](validation/2026-08-29-planning-worktree-ledger.md)

The design specification links its three retained reference images. These six Markdown files and
three images are the complete live documentation set; do not search removed historical documents for
current instructions.

The removed 2026-08-28 documents describe the previous goal and remain recoverable through Git
history only. They are not instructions for the new redesign.

## Planning completion

- The historical/current capability disposition matrix is complete.
- The master plan is cross-checked against the matrix and records the retained, selectively ported,
  redesigned, and deleted behavior.
- The information architecture, authority model, Provider/Skill policy, execution modes,
  implementation gates, validation, and UI specification are complete.
- The next action requires explicit user approval to enter Gate 1 implementation.

## Cross-PC instruction

A second AI must treat this file and the master plan as the current goal. After cloning or updating
`main`, it must inspect `git status --short`, read the six retained documents in order, and wait for
explicit Gate 1 approval before source implementation. A remote clone will not contain the
originating PC's uncommitted exploratory source, and it must not reconstruct or resume the removed
older cutover plans.
