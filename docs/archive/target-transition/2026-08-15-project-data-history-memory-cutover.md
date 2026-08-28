# Historical evidence — superseded by the 2026-08-28 development reset

> This file is retained only as historical evidence. Its data-migration, retention, rollback, and cutover commands must **not** be executed after the 2026-08-28 development reset. The current cutover intentionally performs no data migration; see [`docs/goal.md`](../../goal.md) and [`2026-08-28-development-cutover.md`](../../plans/2026-08-28-development-cutover.md).

# Project Data, History, Memory, and Cutover Contract

## Status

Planning only. This document does not authorize source changes, schema changes, migration execution,
database access, deletion, release, or a compatibility layer.

The target is a one-time cutover to the Project-first product. It does not retain Legacy Resources,
dual-write old and new models, or keep runtime fallback readers.

Migration preserves user evidence—Messages, media bytes, results, choices, provenance, and history—
but it does not preserve the old application's ownership graph, Canvas-as-project semantics, prompt /
preset/template resources, workflow state, context graph, Runtime, IPC, or UI structure. The output is
a fresh target-only store for the ground-up AI video production Harness.

The product and workspace ownership are defined in
[`2026-08-15-project-first-lucid-fin.md`](./2026-08-15-project-first-lucid-fin.md). The Agent Loop,
Capability Catalog, Dispatcher, tool, Skill, TaskList, and Subagent behavior that consumes this data is
defined in
[`2026-08-15-commander-runtime-tool-surface.md`](./2026-08-15-commander-runtime-tool-surface.md).
The exact tools allowed to read or mutate these authorities are defined in
[`2026-08-15-film-tool-catalog-contract.md`](./2026-08-15-film-tool-catalog-contract.md).

## Architecture decision

Lucid Fin uses current authoritative domain state plus immutable evidence. It does not rebuild every
Project object by replaying every historical event and is therefore not a full event-sourced system.

```text
Authoritative current objects
        │ transactional change
        ▼
Immutable evidence ledgers
        │ indexed and summarized
        ▼
Derived Project History and Project Memory
        │ selected at send time
        ▼
Immutable Run Context Manifest
```

- Current domain objects answer what the Project is now.
- Append-only evidence answers what happened, who decided it, and why.
- Project History is a read model over that evidence, not a second mutable object store.
- Project Memory is disposable, cited, and rebuildable. It is never an authority or a creative lock.
- UI selection is temporary. A Run receives an immutable snapshot only when the user sends.

## Evidence from the current implementation

The current model cannot be renamed in place because its ownership boundaries are structurally mixed:

- `canvases` owns project identity, spatial viewport, notes, visual direction, negative prompts,
  resolution, Provider defaults, Delivery sequence, lifecycle, and timestamps.
- `canvas_nodes.data_json` mixes spatial presentation with media identity, prompts, Provider settings,
  variants, current selection, generation progress, errors, cost, entity references, and Shot hints.
- `characters`, `equipment`, `locations`, `scripts`, and `color_styles` have no Project owner.
- `commander_sessions` stores both a mutable message snapshot and a derived context graph while
  `commander_events` also stores Run history.
- Task Lists, plan documents, approvals, attempts, evaluations, artifacts, and prompt assemblies each
  hold parts of Production truth, user decisions, results, and provenance.
- `custom_shot_templates`, `preset_overrides`, `t_prompt_overrides`, and `process_prompts` are the old
  resource system that the target product explicitly removes.

The migration must split these records by meaning. Adding a `project_id` column while leaving the mixed
payloads intact would preserve the root cause and is not an acceptable target.

## Data classes

Every field in the target must belong to exactly one class.

| Class              | Meaning                                                                          | Mutation rule                                                  |
| ------------------ | -------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Authoritative      | Current domain truth                                                             | Updated only through its owning service with expected revision |
| Immutable evidence | Message, decision, result, provenance, Run event, or domain change               | Append only; corrections create later evidence                 |
| Derived            | Overview, Project History view, Memory index/summary, counts, search index       | May be deleted and rebuilt                                     |
| Transient          | Current selection, open panel, scroll, hover, unsent context, temporary playback | Never becomes Project truth                                    |
| Private recovery   | Encrypted minimum needed to resume an exact Run                                  | Never exposed to UI, History, Memory, or search                |

No field may have two authoritative owners. A cache, snapshot, projection, or Context Manifest cannot be
read as the current value after its source revision changes.

## Target object model

### Project

`Project` is the top-level aggregate and owns only:

- Stable ID and display name.
- Active, archived, and deleted lifecycle timestamps.
- Default high-level Provider preferences, permissions, and budget settings.
- Current schema revision and optimistic row revision.
- Creation provenance, including the originating Chat and Message references.

The initial brief remains the first immutable user Message and Project creation evidence. The current
creative direction belongs to Production; it is not copied into a mutable `Project.brief` field.

Workspace route, scroll, Dock width, open inspector, and last Canvas camera belong to user-local
Project view state. They may be persisted for restoration but are neither Project History nor Project
Memory.

### MediaBlob, GlobalMediaFolder, GlobalMediaAsset, and ProjectMediaRef

- `MediaBlob` is an internal CAS object keyed by content hash. It owns bytes and immutable technical
  facts derived from those bytes.
- `GlobalMediaFolder` is a mutable global catalog hierarchy. It owns its parent link, name, sort order,
  and timestamps; root folders have no parent.
- `GlobalMediaAsset` is a stable global catalog record that references one MediaBlob and owns global
  filename, display name, source, GlobalMediaFolder reference, and catalog tags. Multiple catalog
  records may reference the same Blob without duplicating bytes.
- `ProjectMediaRef` is a Project-scoped relationship to one GlobalMediaAsset. It owns Project label,
  collections, roles, notes, and relationships to Production objects.

Generated media enters the same Blob and Global Asset system. Production and Delivery reference the
ProjectMediaRef or GeneratedResult; they never copy bytes.

`MediaDerivation` is immutable request/attempt evidence for extract-frame, clip, crop, resize, proxy,
audio extraction, waveform, OCR, or transcription work. It binds one source hash, one strict transform,
resource/receipt state, and every derived Blob/Global Asset. A derivative is a new asset; source bytes
and technical facts are never rewritten. Model tools receive only accepted opaque IDs and hash-bound
observations, never filesystem paths, arbitrary URLs, headers, or unrestricted bytes.

### ProductionObject

Production owns a strict typed union rather than arbitrary node JSON:

- Direction.
- Story, Sequence, Scene, and Beat.
- Character, Location, Equipment, prop, wardrobe, and other World facts.
- Shot.

Every object has `projectId`, stable ID, type, revision, typed content, content hash, lifecycle state,
created/updated provenance, and timestamps. Relationships use stable typed references. The latest row
is current truth; each accepted mutation also appends a Project domain event.

Only an explicit user-created protection requires exact confirmation before its owning fact changes.
Protection and unprotection are recorded UserChoices with object/path scope and provenance. The owning
Production/Result/Delivery object stores current protection state. A protected mutation atomically
writes the owning-domain revision, the confirming/causal evidence, and ProjectEvent after Dispatcher
re-read and CAS. There are no host-invented identity locks, fixed visual locks, stage locks, or
approval gates.

### CanvasDocument

The initial rebuild has one CanvasDocument per Project. It owns:

- Canvas placements referencing authoritative objects.
- Position, size, z-order, grouping, and spatial annotations.
- Spatial edges whose meaning is explicitly Canvas-only.
- Viewport and saved spatial views.
- Its own optimistic revision.

A placement stores target type and target ID, never a copy of the target title, content, media status,
prompt, selected candidate, or Production state. Typed domain relationships are written to Production
or Media; decorative or organizational edges remain Canvas-only.

### Chat and Message

- Every Chat belongs to exactly one Project.
- A Chat owns title, lifecycle, and ordered Message references.
- A Message is immutable public conversation evidence with role, content, attachment references,
  creation time, and optional superseded-message reference.
- Editing or correcting a Message appends a replacement; it does not rewrite evidence.
- Archiving or permanently deleting a Chat does not delete committed Project facts, results, choices,
  Delivery, or media.

Assistant streaming is transient Run state. On terminalization it becomes one immutable final or
interrupted Message; intermediate stream chunks are not duplicated as Messages.

Assistant prose is not Project truth. It becomes fact only when a typed write commits to the owning
domain. Private reasoning, thought signatures, raw Provider bodies, secrets, and raw tool payloads are
never Message content.

### Run, TaskList, and ContextManifest

`Run` records one accepted request with Project, Chat, parent/child relationship, status, model,
permission, budget, immutable capability-catalog snapshot ID/hash, accepted time, terminal outcome,
and public/private event heads.

`CapabilityCatalogSnapshot` is a content-addressed immutable canonical document containing the complete
Tool definitions, versions, input/output schemas, public projections, recovery semantics, and compact
Skill catalog accepted for the Run. Cold recovery and `tool.get` read this snapshot, never a changed
live registry. A digest without the recoverable snapshot is insufficient.

`TaskList` belongs to a Run and is Commander-authored public progress. It may be created, renamed,
reordered, and completed by Commander. A terminal Run terminalizes its TaskList. TaskList is not
approval authority, Project truth, Chat lifecycle, or a deletion guard.

The target TaskList does not retain fixed production phases, plan gates, approval gates, or a
host-authored dependency graph. Optional child items and Subagent links exist only to explain work the
current Run actually chose to perform.

#### Imported Legacy execution history

Legacy `commander_runs`, `commander_events`, `task_lists`, tasks, plans, approvals, attempts,
artifacts, decisions, evaluations, and prompt assemblies do not satisfy the required target Run,
Context Manifest, capability catalog, Provider, permission, budget, inbox, activation, or TaskList
ownership contracts. Migration therefore preserves them in a separate immutable imported-history
ledger. It retains original IDs, ordering, parent/retry lineage, public payload hashes, timestamps,
and typed evidence without creating a live target Run, TaskList, Provider attempt, UserChoice, or
CapabilityCatalogSnapshot.

Imported history is non-schedulable and read only. The Run Coordinator, Dispatcher, recovery,
Context Manifest builder, model-visible History, search, Memory, and tool catalog never read it.
Desktop History may display a bounded projection explicitly labelled `historical`, `readOnly`, and,
when restricted private evidence was exported offline, `evidenceUnavailable`. A canonical assistant
Message may cite either one exact live Run or one exact imported Run, never both; migration blocks
rather than guessing when the Legacy transcript cannot prove that origin.

Production folder state is owned by `ProductionCollection` and ordered collection membership.
Cross-Project source entities and folders use the same deterministic clone policy as Production
objects; unowned records are exported offline. Legacy viewport translation values remain source
evidence and the target Canvas opens with its documented default view because the old ReactFlow
translation is not a target center coordinate.

The immutable `ContextManifest` contains:

- Project, Chat, and exact user Message IDs.
- Selected object type, ID, revision, and content hash.
- Explicit Project Media and attachment IDs, roles, and Blob hashes.
- Project History sequence watermark.
- Project Memory derivation version, watermark, and exact cited entries used.
- Provider/model, permission, and budget snapshot.
- CapabilityCatalogSnapshot ID/hash and Run-visible capability index.
- Compact Skill catalog digest; each subsequently loaded Skill and content digest is recorded in Run
  evidence.

The manifest does not contain an entire Canvas or Project dump. Later tool reads record the exact
object revision consumed. If a write target changes, expected-revision or CAS checks fail visibly; the
Run does not silently retarget itself.

### RunEvent and private recovery

Public RunEvents are append-only, ordered per Run, and safe for UI hydration. They contain public
progress, typed questions, protected confirmations, safe tool summaries, usage, results, blockers, and
terminal summary.

`RunInboxMessage` is append-only and ordered per root or child Run. It contains host-assigned actor,
the causal immutable Chat Message or bounded parent direction, selected context refs, content hash,
and `queued|delivered|consumed|cancelled` state. A same-Chat user follow-up references its real Message;
it is never copied as a system instruction. `RunActivation` gives each root/child execution epoch a
monotonic number, trigger inbox message, start/end state, and event range. Active Runs consume inbox
messages FIFO at safe model boundaries. A terminal Run is never mutated back to active; continuation
creates a related Run from the verified public/private recovery boundary.

Private recovery records are encrypted, bounded, hash-chained, and include only the data required to
resume the exact accepted Run. They never enter Project History, Project Memory, renderer state,
search, logs, or export. Recovery never recreates missing reasoning.

### GeneratedResult and GenerationAttempt

`GeneratedResult` is an immutable candidate record and contains:

- Project, originating Run, and optional target Production object.
- GlobalMediaAsset and MediaBlob references.
- Exact submitted prompt and negative prompt when used.
- Prompt-assembly provenance and source revision/hash.
- Explicit reference bindings.
- Provider, model, parameters, seed, receipt, timing, usage, and known/estimated/unknown cost.
- Technical validation state and failure distinction.

Retries and Provider submissions are immutable `GenerationAttempt` evidence linked by stable
idempotency keys. Aesthetically weak but valid results remain visible. Result rows never own selected,
rejected, or preferred state.

### OperationRef and long-running attempts

`OperationRef` is a strict public control reference to a real domain attempt: GenerationAttempt,
MediaDerivation, ResultAssessmentAttempt, ReviewCutAttempt, or DeliveryExport. It contains operation
ID, kind, owning object reference, and revision. It is not an independent job, queue, scheduler, state
machine, or source of truth.

Each owning attempt exposes the shared public states `prepared`, `running`, `submitted`, `unknown`,
`succeeded`, `failed`, and `cancelled` where meaningful. Generic operation read/cancel commands route
to that owner. `unknown` can change only through authoritative receipt reconciliation; cancellation
never erases retained artifacts, rewrites usage, or automatically creates a replacement attempt.

### UserChoice

`UserChoice` is immutable Project evidence for Select, Reject, Refine, Use as reference, Protect,
Unprotect, delivery change, and Undo. It records the actor, subject, target, originating Message or UI
action, time, and the choice it supersedes or undoes.

Actor identity is assigned by the host and is never accepted from a tool argument. A direct UI action
is `actor=user`. A reversible change executed by Commander from a natural-language request remains
`actor=commander` with causal Message/Run evidence; no local phrase classifier promotes it to a
user-authored action. If it needs protection confirmation, the immutable confirmation response is
separate `actor=user` evidence while the resulting Commander-originated domain mutation remains
`actor=commander` and cites it. A direct UI mutation is `actor=user` for both action and evidence.

The owning domain stores the current resolved relationship, such as a Shot's selected result or an
active fact protection. The UserChoice is the evidence explaining that current state. Both are written
atomically. Undo appends a new UserChoice and domain mutation; it never deletes the original choice.

Commander recommendations remain Assistant content until the user adopts them or an accepted Run
performs an allowed reversible domain change. Commander cannot create a user-authored choice.

### DeliveryPlan and DeliveryItem

Delivery owns sequence order, current clip reference, trims, embedded-audio preference, review state,
format intent, and optimistic revision. It references Shots and GeneratedResults.

Commander may prepare a visible reversible draft within an accepted request. Explicit user choices
protect adopted clips, ordering, trims, and audio decisions from silent replacement. Export freezes an
immutable manifest with content hashes, source revisions, settings, destination intent, and cost
state; external or irreversible execution remains protected.

### ProjectEvent and ProjectHistory

Every committed domain mutation appends a `ProjectEvent` in the same transaction. It contains:

- Project-monotonic sequence and event version.
- Event ID, type, time, and public actor identity.
- Subject type and ID.
- Before and after object revision when applicable.
- Typed bounded change payload or immutable revision reference sufficient for audit and undo.
- Causation reference to Message, Run, UserChoice, import operation, or direct UI action.
- Correlation or operation ID for multi-object changes.

Events are never updated, reordered, or deleted. Corrections and restores append later events.

The immutable event envelope and the public event payload are separate. Privacy removal may purge an
authorized payload and append redaction evidence while retaining the event ID, sequence, type, hash,
and tombstone needed to preserve audit order. Purging never rewrites neighboring events.

The product-level Project History is a derived chronological view over Messages, public RunEvents,
ProjectEvents, GeneratedResults, and UserChoices. It stores references rather than copying their full
payloads into another ledger.

## Project Memory

### Purpose

Project Memory helps Commander retrieve the minimum relevant context across independent Chats. It does
not decide creative truth, lock the model into a workflow, or replace the owning Project objects.

### Source policy

Eligible sources:

1. Current authoritative Project, Production, Media, and Delivery objects.
2. Active UserChoices, including preferences, protections, selections, rejections, and undo.
3. Explicit user Messages, marked tentative when they have not yet produced a committed domain change.
4. Committed Commander changes and their causal Runs.
5. GeneratedResult provenance and recorded feedback.

Excluded sources:

- Uncommitted Assistant suggestions.
- Private reasoning or recovery payloads.
- Raw tool arguments/results and Provider bodies.
- Task names or workflow prose as creative facts.
- Old Prompt, Preset, Template, Process Prompt, Guide Injection, or Tool Injection records.
- AI evaluator preference as a user selection.

### Two derived layers

- `ProjectMemoryIndex` is deterministic and contains typed source references, revisions, active or
  superseded state, topics, and searchable text. It is the retrieval base.
- `ProjectMemorySummary` is an optional model-generated cache for compact narration. Every statement
  must cite index entries; it may vary across rebuilds and is never authoritative.

Both carry derivation version, source schema version, Project History watermark, source-set hash,
creation time, and completeness status. A stale, partial, or failed build is labeled and cannot replace
a newer complete projection.

Memory versions are immutable after publication. A newly built version becomes the active Project
Memory head only after its inputs are complete and its hashes validate; publication is one atomic head
change. A failed build leaves the previous ready head intact and marks the Project dirty after its
watermark.

### Invalidation and correction

- A source revision, UserChoice, undo, redaction, or derivation-version change invalidates affected
  entries.
- Rebuild reads a stable source snapshot through a fixed Project sequence watermark.
- New events after that watermark are applied in the next projection; they are never hidden.
- Deleting the entire Memory cache and rebuilding must preserve the same cited current facts, though a
  narrative summary need not be byte-identical.
- Users inspect Memory through citations to Messages, choices, and owning objects. Correction happens
  at the source or through a new user Message; there is no separate Memory editor or resource manager.

At Run start Commander receives a compact Memory index catalog. It retrieves full cited entries only
when relevant, rather than force-injecting the entire Project history.

## Transaction, revision, and concurrency rules

- Every mutable authoritative object has an integer revision and content hash.
- Every write supplies the expected revision. A mismatch returns a typed conflict with the current
  object reference; it never applies a best-effort merge silently.
- The object mutation and its ProjectEvent commit in one database transaction.
- A multi-object operation shares one operation ID and either commits every required owner change and
  event or none.
- ProjectEvents receive one monotonically increasing Project sequence.
- Chat Messages and RunEvents have independent stable sequence numbers within their owner.
- MediaBlob identity is its cryptographic content hash; the migration verifies bytes against it.
- Run ContextManifest and GeneratedResult provenance are immutable after acceptance/creation.
- Delivery updates and protected fact changes use the same expected-revision boundary as Commander
  tools and direct UI edits.

## Privacy, retention, and deletion

- Public evidence stores only user-visible content and safe typed projections.
- Credentials, secrets, private reasoning, raw Provider payloads, and local absolute paths are excluded
  or encrypted only in the narrow private recovery boundary.
- Permanent deletion is a distinct protected operation. Ordinary archive or Chat deletion never
  cascades into Project facts, Global Media bytes, choices, or Delivery.
- A privacy deletion creates auditable tombstones or redaction evidence where retention policy permits;
  it does not rewrite unrelated event sequence.
- CAS garbage collection deletes bytes only after GlobalMediaAsset, ProjectMediaRef, GeneratedResult,
  Delivery, Run attachment, backup-retention, and export references are all absent.

## Current-to-target mapping

| Current source                                                                    | Target                                            | Deterministic rule                                                                                                                       | Blocking condition                                                      |
| --------------------------------------------------------------------------------- | ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `canvases` identity/lifecycle                                                     | Project                                           | Preserve Canvas ID as Project ID when valid                                                                                              | Duplicate/invalid ID or lifecycle contradiction                         |
| `canvases.viewport` and spatial notes                                             | CanvasDocument / annotation                       | Preserve spatial values and typed annotations                                                                                            | Invalid payload without a recoverable source record                     |
| Canvas Provider/resolution settings                                               | Project settings or Delivery intent               | Map by setting meaning, not column location                                                                                              | Unknown key or conflicting effective values                             |
| Canvas visual style/negative prompt                                               | Production Direction or Result provenance         | Map only when linked to an explicit Project choice or result                                                                             | No evidence of whether it is current direction or generation-only input |
| Canvas delivery sequence and refs                                                 | DeliveryPlan / ProjectMediaRef                    | Preserve order, selected hashes, audio and revision                                                                                      | Missing asset, invalid order, or duplicate identity                     |
| `canvas_nodes` spatial fields                                                     | Canvas placement/group/annotation                 | Preserve placement ID and spatial values                                                                                                 | Unparseable or conflicting spatial identity                             |
| Media node asset/variants                                                         | ProjectMediaRef / GeneratedResult                 | Preserve every valid candidate and original selection evidence                                                                           | Missing Blob or unknown variant source                                  |
| Node prompt/provider/seed/history                                                 | GeneratedResult provenance / GenerationAttempt    | Preserve only with exact result or attempt binding                                                                                       | Unbound prompt or ambiguous candidate binding                           |
| Node scene/shot/entity data                                                       | ProductionObject / relationship                   | Split by strict node type and typed reference                                                                                            | Arbitrary JSON cannot be assigned without guessing                      |
| `canvas_edges`                                                                    | Canvas edge                                       | Migrate as spatial unless an existing typed domain relation proves otherwise                                                             | Edge claims semantic truth without a valid typed target                 |
| `asset_contents`                                                                  | MediaBlob                                         | Preserve hash and verify bytes/technical facts                                                                                           | Missing bytes or hash mismatch                                          |
| `asset_folders`                                                                   | GlobalMediaFolder                                 | Preserve stable folder ID, parent, name, order, and timestamps                                                                           | Missing parent, self/cycle, or invalid folder field                     |
| `asset_entries`                                                                   | GlobalMediaAsset                                  | Preserve stable entry ID/catalog metadata and its proven folder reference                                                                | Entry points to missing Blob or Folder                                  |
| Asset use by a Canvas, task, result, or Delivery                                  | ProjectMediaRef                                   | Create one Project-scoped relationship per proven use                                                                                    | Project cannot be resolved                                              |
| Characters, equipment, locations, scripts and dependencies                        | ProductionObject / relationship                   | Preserve ID when linked to one Project; deterministically clone per Project when proven shared                                           | Unlinked object or cross-Project relation cannot be separated           |
| Color styles                                                                      | Production Direction or result provenance         | Import only when a Project/user/result binding is proven                                                                                 | Unbound style becomes offline-only legacy export                        |
| `commander_sessions`                                                              | Chat                                              | Preserve ID and ordered public messages; resolve Project from Canvas/run evidence                                                        | Truly unassigned Chat requires the confirmed import rule below          |
| Session context graph                                                             | Nothing authoritative                             | Rebuild Memory from accepted sources                                                                                                     | Never imported directly as Project Memory                               |
| Commander Runs, events, attachments                                               | Run, RunEvent, ContextManifest evidence           | Preserve stable IDs, public events, safe private recovery, and Blob refs                                                                 | Broken sequence/hash chain or unsupported active state                  |
| Task Lists, Tasks and task events                                                 | Run TaskList history                              | Preserve public names, states, ordering and artifacts                                                                                    | Nonterminal work at cutover                                             |
| Plan documents and approvals                                                      | Production objects and UserChoice evidence        | Import approved/current content and decision provenance, not future gates                                                                | Multiple incomparable approved heads                                    |
| Attempts, artifacts and evaluations                                               | GenerationAttempt, GeneratedResult and provenance | Preserve outputs, cost state, technical evidence and idempotency                                                                         | Ambiguous Provider submission or missing artifact                       |
| Prompt assemblies                                                                 | GeneratedResult immutable provenance              | Preserve exact submitted lineage only                                                                                                    | Assembly is unbound to a result/attempt                                 |
| Snapshots                                                                         | Offline backup                                    | Preserve in the migration bundle only; do not import as runtime truth or Memory                                                          | Any code path depends on restoring the legacy snapshot                  |
| `custom_shot_templates`, `preset_overrides`, Prompt overrides and Process Prompts | `Skill` catalog; Legacy managers are deleted      | Register the exact built-in pack and one-time dynamic versions; all dynamic content is `unreviewed`, quarantined, and never auto-enabled | Mapping/pack drift, missing quarantine, or automatic enablement         |
| `project_settings`                                                                | Global Settings or Project settings               | Explicit key-by-key registry                                                                                                             | Unknown keys block cutover                                              |

Every source record receives exactly one migration disposition: migrated current state, immutable
provenance/history, offline legacy export, or blocking error. No record is silently ignored.

The one-time Skill registration does not preserve a runtime preset/template/prompt authority. It
preserves reusable expertise in the target catalog. Unreviewed migrated content cannot enter a frozen
Run catalog until an explicit later review enables it; automatic activation, hidden injection, and
compatibility reads from the Legacy managers remain forbidden. Exact prompt/result bindings are still
retained independently as immutable provenance.

## Special migration rules

### Shared and unlinked Production entities

Current entity rows are not Project-scoped. A row linked to one legacy Canvas becomes a Production
object in that Project. A row proven to be used by multiple Canvases becomes independent
Project-scoped objects with deterministic IDs and a shared `migratedFrom` evidence reference. This is a
one-time data split, not continuing cross-Project shared state.

Unlinked entity, script, style, preset, or template records do not become hidden global creative
resources. They remain in the verified offline export unless the migration can prove a Project or
GeneratedResult binding.

### Legacy Chats without a Canvas

A session with one resolvable Canvas or Run claim joins that Project. For a truly unassigned session,
the proposed default is to create one minimal Imported Project containing that Chat and its referenced
media, rather than preserve an Unassigned area or discard the transcript.

### Active work

Cutover requires zero accepted, running, paused, or waiting legacy Runs and zero nonterminal TaskLists.
The migration does not attempt to cold-resume work across the incompatible product model. The user must
finish or stop it before maintenance mode; terminal history and completed results are preserved.

## One-time cutover plan

### Phase 0 — Freeze and inventory

- Freeze the target contracts and legacy key registry.
- Enter maintenance mode and reject new writes.
- Verify there is no active Run or TaskList.
- Create a byte-for-byte database backup, CAS file manifest, and versioned legacy-resource export.
- Record application build, schema fingerprint, file count, total bytes, and hashes.

### Phase 1 — Read-only classification

- Read a stable source snapshot.
- Assign every source row and embedded JSON member a migration disposition.
- Produce stable old-to-new ID mappings and reference graphs.
- Report orphan, duplicate, corrupt, ambiguous, and cross-Project records.
- Stop on any item that would require guessing.

### Phase 2 — Dry-run into a new store

- Build a new target database and indexes from canonical target definitions.
- Copy or transform data into it; never mutate the source database.
- Reuse existing Blob hashes and verify every referenced byte.
- Build ProjectEvents, ContextManifests, and provenance from proven evidence only.
- Rebuild Project Memory from target sources; never import the old context graph.

### Phase 3 — Reconciliation

The dry-run report must contain:

- Source and target counts by type and Project.
- One disposition for every source row and nested legacy item.
- Old-to-new ID mapping and clone mapping.
- Message, RunEvent, ProjectEvent, Task, choice, result, and Delivery sequence counts.
- CAS file hashes, missing bytes, duplicate hashes, and unreferenced bytes.
- Reference and foreign-key validation.
- Project sequence, Chat sequence, Run sequence, and Delivery order validation.
- Sampled and aggregate provenance checks from user request through submitted prompt to result.
- Memory watermark/source-set validation and rebuild result.
- Proof that target schema, runtime registries, and planned navigation contain no Legacy Resources.

Cutover requires zero blocking, ambiguous, unclassified, missing-byte, hash-mismatch, sequence-gap, and
referential-integrity findings.

### Phase 4 — Explicitly authorized switch

After separate approval:

- Stop the old runtime.
- Reconfirm the source fingerprint and zero-active-work requirement.
- Rerun the proven migration against that exact snapshot.
- Atomically switch the application data pointer to the new store.
- Start only the new runtime; there is no dual write or compatibility reader.
- Run the complete product acceptance path before accepting ordinary writes.

### Phase 5 — Retention and later removal

- Keep the old source and offline legacy export read-only for the approved retention period.
- Do not expose them in the new app or allow Commander to query them.
- Deleting old tables, files, backup bundles, or legacy source code is a separate destructive action
  requiring explicit authorization and a verified retention decision.

## Rollback boundary

Rollback is safe only before the new runtime accepts the first ordinary Project mutation. During that
window the data pointer can return to the untouched old snapshot and old build.

After new writes exist, automatic downgrade is forbidden because it would lose or mis-map new Project
events, choices, and results. Recovery becomes fix-forward or an explicitly reviewed export/import of
the new evidence. The system never merges old and new stores through dual write.

## End-to-end acceptance

1. Create a Project and first Chat from a brief and references.
2. Send a request with a selected Shot and media; freeze their exact revisions in ContextManifest.
3. Change current UI selection while the Run continues; the accepted manifest remains unchanged.
4. Commit a Production update and ProjectEvent atomically, then display it in Overview and Canvas by
   reference.
5. Generate multiple candidates with complete provenance and show all valid results in Chat and Media.
6. Select, reject, refine, use as reference, and undo; current domain state and immutable UserChoice
   evidence remain consistent.
7. Open another Chat and retrieve cited Project Memory without importing the first transcript.
8. Delete and rebuild Memory; current facts and citations remain complete.
9. Restart during a recoverable Run without duplicating a Provider submission or exposing private
   recovery data.
10. Build a Delivery draft, preserve user-protected selections/order, freeze a visible manifest, and
    perform only the explicitly authorized export.
11. Archive or delete a Chat without a stale TaskList blocking it or deleting Project outcomes.
12. Complete migration reconciliation with every source item classified and no Legacy Resource in the
    target runtime.

## Stop conditions

- Any current record cannot be assigned a unique target without creative guessing.
- Any Blob is missing or does not match its recorded hash.
- Active work exists at the cutover boundary.
- The target would require legacy reads, compatibility fallbacks, or dual write.
- Project Memory would need to become an authority or ingest private/uncommitted Assistant content.
- History and current object state cannot be committed atomically.
- A rollback would require discarding new writes.
- Any deletion is required before a separately authorized retention/removal decision.
- The same migration or reconciliation failure repeats three times without a new evidence-based design.

## Confirmed decisions

1. The initial rebuild has exactly one CanvasDocument per Project; saved views are allowed, multiple
   independent Canvases are deferred until a real use case exists.
2. Explicit user Messages may enter Project Memory as cited tentative intent before a domain object is
   updated; uncommitted Assistant prose never enters Memory.
3. A truly unassigned legacy Chat becomes its own minimal Imported Project so its transcript is
   preserved without retaining an Unassigned product area.
