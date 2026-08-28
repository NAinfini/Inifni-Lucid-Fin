# Ground-up Lucid Fin AI Video Production Harness Rebuild Plan

## Status

Planning only. This document does not authorize source changes, database migration, deletion, or
release work.

This plan is the target product model. It is a ground-up semantic replacement, not a redesign layer,
Canvas mode, Commander upgrade, or compatibility shell added to the current product. Existing
`PRODUCT.md`, the archived product tree, old plans, schemas, services, and UI are migration evidence only;
they are not target requirements or architecture foundations.

## Product contract

Lucid Fin is a Codex- and Claude Code-style agent application for AI video creation. A Project is the
primary workspace. Commander is the agent that performs real production work inside that Project; it
is not a floating chat feature attached to a node editor.

The user directs the film, reviews real results, and makes creative selections. Commander manages the
production method, project facts, prompts, task tracking, tools, and optional delegation.

## Ground-up Harness charter

Lucid Fin is an **AI video production Harness**: a target-only application runtime that accepts a user
goal and references, gives Commander exact Project context plus typed production capabilities, runs
and recovers agent work, persists evidence, and returns visible media and Project changes for user
review.

The Codex/Claude Code product grammar maps exactly as follows:

| Agent-app concept                  | Lucid Fin target                                                           |
| ---------------------------------- | -------------------------------------------------------------------------- |
| Workspace / repository             | Project                                                                    |
| Thread / task conversation         | Project Chat                                                               |
| One agent execution                | Run                                                                        |
| Coding agent                       | Commander, the AI video-production agent                                   |
| Tool execution boundary            | Single Dispatcher over typed AI video-production tools                     |
| Durable transcript and task events | Messages, RunEvents, ProjectEvents, and History                            |
| Working plan                       | Optional Commander-owned TaskList                                          |
| Delegated worker                   | Optional scoped child Run / Subagent                                       |
| Diff and artifact review           | Project changes, generated media, comparison, choices, and Delivery review |
| Task completion message            | Evidence-backed final Assistant summary                                    |

This mapping defines interaction grammar, not visual imitation. Lucid Fin is not a terminal or code
editor: its artifacts are images, video, audio, Production objects, Canvas arrangements, choices,
Review Cuts, and Delivery exports.

Ground-up means:

- Project replaces the legacy Canvas/session aggregate; Canvas becomes one spatial Project workspace.
- The new Project data model, composition root, IPC, Runtime, 40-tool catalog, and application shell
  stand on their own and contain zero runtime dependency on Legacy Resources.
- User Messages, media bytes, generated results, choices, and history are migrated as evidence; old
  ownership models, workflow gates, prompt injection, and UI structure are not migrated.
- Existing code may be transplanted only as a small proven mechanism after it passes the target
  contract. Reuse never preserves an old public interface, owner, tool ID, state flow, or fallback.
- The target Build must boot from a fresh canonical Project store with no old database, tables,
  routes, tools, or settings present.

## Operating principle: tools, not workflow

Lucid Fin supplies Commander with the capabilities needed to make a film; it does not prescribe how
the model must use them.

The host supplies:

- Exact Project context and on-demand retrieval.
- A stable catalog of typed image, video, audio, Production, Canvas, Media, and Delivery tools.
- On-demand Skills containing reusable film-production expertise.
- Permission, budget, schema, CAS, privacy, Provider-truth, persistence, and recovery boundaries.
- Public progress, results, changes, questions, and final summaries that the user can inspect.

Commander decides whether to answer, inspect, plan, create or revise a TaskList, call tools, load a
Skill, compare results, ask the user, or delegate independent work. It also decides the order and level
of detail. The host does not impose a creative phase sequence, fixed tool chain, approval wording,
response phrase table, or mandatory planning loop.

This is the Codex and Claude Code interaction model applied to AI video creation: the user states the
outcome and supplies references; the Agent works inside the Project with real tools and returns visible
artifacts and changes. It is not a coding terminal, an unrestricted shell, or a workflow builder.

## Success flow

```text
User goal + selected references
-> Commander reads the minimum Project context it needs
-> Commander plans only when useful
-> Commander performs guarded work with typed tools
-> Valid generated candidates appear in Chat and the relevant workspace
-> User selects, rejects, refines, or reuses a result as reference
-> Choices and Project changes are appended to history
-> Project Memory is derived from that history
-> Commander continues or produces a concise final summary
```

Success means the user receives results that remain bound to the exact request, selected references,
Project facts, prior choices, prompts, and provider provenance. A successful Task status without a
useful visible result is not product success.

## Product tree

```text
Lucid Fin
├─ Projects
│  ├─ Overview
│  ├─ Canvas
│  ├─ Media
│  ├─ Production
│  └─ Delivery
├─ Commander
│  ├─ Project Chats
│  ├─ Shared Project Memory
│  ├─ Inline TaskList
│  ├─ Context selection
│  ├─ Result review
│  ├─ Questions and protected confirmations
│  ├─ Optional Subagents
│  └─ Final summary
├─ Project History
│  ├─ User messages and attachments
│  ├─ Public Commander actions
│  ├─ Submitted prompts and reference bindings
│  ├─ Generated results
│  ├─ User choices and feedback
│  ├─ Project changes
│  └─ Undo and restore events
└─ Platform
   ├─ Stable typed tools
   ├─ On-demand Skills
   ├─ Provider capabilities
   ├─ Permissions and privacy
   ├─ Budgets and cost
   ├─ CAS and concurrency
   └─ Durable events and recovery
```

## Application shell

### Workspace mode

```text
Global rail | Project navigation | Current Project workspace | Commander Dock
```

- Global rail: Projects, Global Media, Settings.
- Project navigation: Overview, Canvas, Media, Production, Delivery.
- Workspace: the real production surface, not a Chat background.
- Commander Dock: fixed right-side Project Chat; collapsible and resizable, never floating.

### Commander Focus mode

```text
Project Chat list | Commander conversation | Results / Project changes inspector
```

Focus mode is the equivalent of a Codex task view. It is not a modal. Leaving Focus restores the
previous workspace, selection, scroll position, and Dock width.

At narrow widths Focus temporarily occupies the application content area. At wide widths the user may
keep the Project context or result inspector visible.

### One activity surface

Task progress, optional Subagents, tool summaries, questions, results, and completion state live in the
current Assistant response. There is no second activity console, floating status window, or default
run-details modal. Technical detail is available through an inline `Execution details` disclosure.

## Project workspaces

### Overview

An action-first project home showing current direction, decisions needed from the user, active work,
recent results and changes, and delivery readiness. It is not a card dashboard.

### Canvas

The spatial production view. It owns layout, position, grouping, and edges only. Media and Production
objects remain authoritative in their own domains and are referenced by Canvas placements.

### Media

Project Library, generated candidates, Compare, Detail and provenance. Chat quick selection and Media
Compare use one shared selection state.

### Production

Commander-managed Direction, Story, World, and Shots. The user inspects and corrects them through
natural language or direct object edits; the ordinary workflow does not expose prompt, style, preset,
template, or tool-injection managers.

### Delivery

User-controlled shot order, selected clips, trim, embedded-audio preference, Review Cut, manifest, and
export. Commander may prepare and recommend, but final creative selection remains visible and user
directed.

## Commander behavior

- Each Chat belongs to exactly one Project.
- Chats keep independent transcripts and share derived Project Memory.
- Each Run freezes the Project, exact user input, relevant Chat context, UI selection, explicit
  references, Project Memory index, stable authorized tools, permissions, and budget.
- Other Project facts are queried on demand rather than force-injected.
- Commander decides whether to ask, plan, act directly, create a TaskList, use a Skill, or delegate.
- TaskList names and steps are authored and maintained by Commander.
- TaskList is progress and memory, not approval authority and not a Chat deletion lock.
- Subagents are absent by default and appear only for genuinely independent or parallel work.
- Private chain-of-thought is neither stored nor displayed.

## Creative control

There are no host-authored creative phrase tables, fixed production stages, forced approval loops,
phase-hidden tools, or creative code locks.

User messages, Commander public actions, prompts, reference bindings, generated results, selections,
rejections, refinements, and undo actions are durable history. Project Memory is derived from ordered
evidence. The latest explicit user request wins; Commander interprets conflicts and asks only when the
conflict materially changes the result.

All valid creative candidates are shown. Commander may analyze and recommend but does not silently
discard, select, or spend more budget on subjective regeneration. Automatic retries are limited to
bounded technical failures such as timeout, empty or corrupt output, and explicit provider failure.

## Permissions

Automatic within the current Project and accepted Run:

- Read and query Project facts.
- Make reversible Project and Canvas changes.
- Use configured providers and typed tools within the visible budget.
- Generate the media the user requested.

Explicit confirmation remains for:

- Cross-Project access or mutation.
- Permanent deletion.
- External publish, send, or irreversible export action.
- Credential changes.
- Budget expansion.

The user manages high-level capabilities and budget, not individual tool calls. Schema, permission,
cost, CAS, provider-truth, privacy, persistence, and recovery checks remain execution-time host guards.

## Skills and removal of the old prompt system

The target product has no Legacy Resources and no Prompt, Style, Preset, Template, Process Prompt,
Guide Injection, or Tool Injection product surfaces.

Reusable professional knowledge from selected old prompts may be rewritten as new Lucid Fin Skills.
A Skill is an on-demand capability bundle, not a renamed prompt record and not a hidden system-prompt
layer.

### Convert when the source contains durable expertise

- Script and story breakdown methods.
- Character, scene, shot, and visual-continuity review.
- Reference-image analysis.
- Shot-language and coverage review.
- Media-generation prompt craft.
- Media quality diagnosis.
- Review Cut and delivery review.
- Provider-specific public usage guidance.

### Delete rather than convert

- Forced stage order or mandatory approval prose.
- Tool-routing instructions.
- Hard-coded response phrases.
- Host, CAS, permission, recovery, or cost mechanics already enforced by code.
- Project-specific style or prompt content.
- Duplicate or stale provider instructions.
- Any instruction whose only purpose is constraining model behavior to the old workflow.

### Skill scopes

- Built-in Skills: curated Lucid Fin production expertise.
- Installed Skills: capabilities provided by trusted plugins or the user.
- Project Skills: created only when the user explicitly asks to save a reusable Project method.

At Run start Commander sees a compact Skill catalog. It loads full Skill content only when useful.
Skills do not grant authority or bypass the unified tool pipeline. Ordinary production exposes no
prompt editor or injection-order settings. Settings only supports viewing, enabling, disabling,
installing, removing, and auditing Skills and Plugins.

### Old data cutover

- Prompt and parameters bound to an existing generated result become immutable provenance for that
  result.
- Old records that express an actual user choice become Project History evidence.
- Unbound old Prompt, Style, Preset, and Template data is exported once to an offline backup before
  removal; it is never imported into the new product model.
- The old UI, runtime injection paths, storage tables, and duplicate registries are removed in one
  cutover after explicit migration approval. There is no long-term dual-write mode.

## Authoritative objects

| Object                                  | Ownership                                                                                        |
| --------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Project                                 | Project boundary, metadata, settings, permissions, and budget                                    |
| MediaBlob                               | Content-addressed immutable bytes and technical facts derived from those bytes                   |
| GlobalMediaFolder                       | Mutable global catalog hierarchy: parent, name, sort order, and timestamps                       |
| GlobalMediaAsset                        | Stable global catalog identity, source, display metadata, tags, and MediaBlob reference          |
| ProjectMediaRef                         | How a Project labels, relates, and uses one GlobalMediaAsset                                     |
| ProductionObject                        | Direction, Story, Character, Location, Scene, Shot, and related facts                            |
| CanvasPlacement                         | Spatial position, size, grouping, and edges for authoritative objects                            |
| Chat                                    | One Project-scoped transcript                                                                    |
| Run                                     | One accepted user request and frozen execution context                                           |
| TaskList                                | Commander-authored public progress for a Run                                                     |
| GeneratedResult                         | Candidate artifact, prompt provenance, references, provider, and parameters                      |
| UserChoice                              | Select, reject, refine, use-as-reference, protect, unprotect, Delivery choice, and undo evidence |
| DeliveryPlan / Item / Manifest / Export | Draft order and trims, frozen source identity, execution receipt, and export result              |
| ProjectEvent                            | Immutable Project history                                                                        |
| ProjectMemory                           | Derived current memory, never a second manually maintained fact database                         |

## Migration phases

1. Freeze this target model and finish the screen and interaction specification.
2. Inventory the current data and map every durable record to a target object, provenance, history,
   offline export, or approved deletion.
3. Design and test the Project / History / Memory data cutover on a copy, preserving IDs, media bytes,
   and user-visible choices.
4. Cut Commander over to Project context, stable tools, on-demand Skills, and one inline activity flow.
5. Replace the application shell and deliver Overview, Canvas, Media, Production, and Delivery against
   the same authoritative objects.
6. Remove old navigation, floating Commander, prompt-management surfaces, duplicate state, and old
   storage paths in one verified cutover.
7. Run end-to-end validation from new Project creation through generation, selection, revision,
   restart recovery, and delivery.

No implementation phase begins until its data ownership, migration behavior, acceptance criteria,
validation, and stop conditions are explicitly approved.

## Approved planning contracts

The screen contract is maintained in
[`docs/design/project-shell-screen-contract.md`](../design/project-shell-screen-contract.md).

The five-workspace ownership and interaction contract is maintained in
[`docs/design/project-workspaces-contract.md`](../design/project-workspaces-contract.md).

The target data, immutable evidence, Project Memory, and one-time cutover contract is maintained in
[`the archived data/history plan`](../archive/target-transition/2026-08-15-project-data-history-memory-cutover.md).

The minimal system prompt, stable per-Run Capability Catalog, canonical ToolDefinition, single
Dispatcher, autonomous Agent Loop, film-production tool surface, Skills, TaskList, Subagents, Tool
Program, permissions, recovery, and public execution contract is maintained in
[`docs/plans/2026-08-15-commander-runtime-tool-surface.md`](./2026-08-15-commander-runtime-tool-surface.md).

The exact target tool IDs, authority owners, strict inputs/outputs, effects, permissions, cost, CAS,
idempotency, recovery, public projections, user-only actions, and legacy-tool deletions are maintained
in
[`docs/plans/2026-08-15-film-tool-catalog-contract.md`](./2026-08-15-film-tool-catalog-contract.md).

The dependency order, stage gates, migration rehearsal, destructive-approval boundary, and release
verification program are maintained in
[`docs/plans/2026-08-15-project-first-implementation-program.md`](./2026-08-15-project-first-implementation-program.md).

Together this product contract and its six subordinate contracts define the target product, screen
behavior, workspace ownership, data authority, one-time cutover, Commander runtime, exact tool
surface, and implementation program without reintroducing legacy resources, a second runtime, or
host-authored film workflows.
