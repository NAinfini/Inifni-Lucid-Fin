# Exact AI Video Production Tool Catalog Contract

## Status

Planning only. This document freezes the target Commander tool surface. It does not authorize source,
schema, database, migration, provider, UI, or release changes.

This is the native capability surface of the ground-up AI video production Harness. It is not a
renaming layer over current model tools. The current-tool table at the end is a deletion/migration
disposition only; it never authorizes wrapping, aliasing, importing, or calling an old implementation.

This catalog implements the Agent Loop and Dispatcher in
[`2026-08-15-commander-runtime-tool-surface.md`](./2026-08-15-commander-runtime-tool-surface.md), operates
on the authorities in
[`the archived data/history cutover`](../archive/target-transition/2026-08-15-project-data-history-memory-cutover.md),
and produces the public states defined by
[`../design/project-shell-screen-contract.md`](../design/project-shell-screen-contract.md).
Its implementation order is defined by
[`2026-08-15-project-first-implementation-program.md`](./2026-08-15-project-first-implementation-program.md).

## Catalog rule

The target catalog contains 40 tools. Each tool has one stable ID, one authority owner, one strict
input schema, one strict success schema, one effect declaration, and one Dispatcher path. There are no
aliases, legacy fallbacks, phase variants, UI-button tools, or dynamically injected tools.

Tool order in this document is organizational only. It is not a film workflow and does not instruct
Commander which tool to call or when.

Every initial definition is version `1.0.0`. A breaking schema or semantic change creates a new tool
version and a new content-addressed Capability Catalog Snapshot. An active Run continues using its
frozen snapshot.

## Host-owned fields

The model never supplies:

- `projectId`, `chatId`, `runId`, `actor`, permission mode, credentials, event sequence, or resource
  account.
- Public/private event payloads, operation fingerprints, idempotency keys, or ProviderAttempt state.
- Approval state, confirmation result, Project History actor, or user-choice attribution.

The Dispatcher derives these from the accepted Run and canonical input. A tool cannot claim another
actor, Project, permission, budget, or event identity through arguments.

## Shared schema vocabulary

All named shapes below become strict discriminated schemas before implementation. `CanonicalJson` is
allowed only in explicitly named domain payloads whose discriminant selects a stricter schema. It is
not a generic escape hatch.

- `ObjectRef`: `{ kind, id, revision, contentHash }`.
- `OperationRef`: `{ id, kind, ownerRef, revision }` for one durable asynchronous operation owned by a
  real domain attempt; it is not a second job database.
- `ObjectSelector`: exact IDs or strict typed filters; never SQL, regex code, or raw query text that is
  executed outside a bounded search parser.
- `PageRequest`: `{ cursor?, limit }`, with deterministic ordering and a bounded limit.
- `Page<T>`: `{ items, nextCursor? }`.
- `MutationReceipt<T>`: `{ object: T, previousRevision?, eventId, changedPaths, undoRef? }`.
- `ArtifactRef`: `{ kind, id, contentHash, mimeType?, width?, height?, durationMs? }`.
- `ProviderSelection`: optional configured `{ providerId, model }`; credentials are never included.
- `CostQuote`: bounded or unknown cost state, currency, expiration, provider/model, and quote hash.
- `GenerationSpec`: strict modality/task union:
  - image `create|edit|inpaint|outpaint|variation`
  - video `create|imageToVideo|videoToVideo|extend|edit`
  - audio `music|soundEffect|speech`
    It also contains the exact target reference, complete public prompt, optional negative prompt,
    selected reference bindings, configured provider/model, parameters validated against a strict
    versioned provider extension schema frozen in the catalog, seed, and expected target revision.
    Generic `providerOptions` objects are forbidden. Voice cloning is not a task.
- `ToolFailure`: the normalized Dispatcher failure union defined by the Runtime contract.

Every success is returned as `succeeded` plus the exact named success data. Unknown output fields,
non-finite numbers, mutable prototypes, raw provider payloads, local file paths, credentials, and
private reasoning are invalid tool output.

Every mutation input is a strict discriminated `oneOf` union with `additionalProperties: false` at
every object boundary. Each variant declares its own effect, permission, resource, confirmation,
idempotency, cancellation, and recovery metadata in the frozen catalog. The examples below are the
semantic contract, not permission to replace them with a generic patch, map, or command blob.

Protection is resolved dynamically from the owning Production/Result/Delivery authority. Any mutation
that would change a protected field, selection, relation, or Delivery decision is upgraded by the
Dispatcher from its normal profile to `PROTECTED`. Confirmation re-reads protection and all expected
revisions before one atomic domain mutation + UserChoice + ProjectEvent commit. The user confirmation
is `actor=user`; a Commander-originated mutation remains `actor=commander` with causal confirmation.

## Effect and recovery profiles

| Profile     | Default effect, permission, integrity, resource, cancellation, and recovery                                                                                                                       |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `R`         | `project.read`; no domain mutation or paid cost unless overridden; no CAS; bounded read cancellation; safe retry; `authority_reread`                                                              |
| `RW`        | `project.write`; reversible current-Project mutation; expected revision and idempotent operation record; cancellation only before commit; `event_receipt`                                         |
| `CTRL`      | `run.control`; Run-local mutation with Run/child revision and idempotent operation; cooperative cancellation; `run_state`                                                                         |
| `EXT`       | Explicit configured provider/local execution capability; quote/reserve/attempt prepared before side effect; cancellation only when declared; `provider_receipt`; unknown state never auto-retried |
| `PROTECTED` | Exact Dispatcher confirmation plus the underlying effect profile; confirmation cannot be globally waived and is invalidated by changed input/revision/manifest/quote                              |

Recovery is one of:

- `authority_reread`: result can be reconstructed from current immutable/current domain authority.
- `event_receipt`: reconstruct from committed event and mutation receipt.
- `provider_receipt`: reconcile the prepared/submitted ProviderAttempt by its real receipt.
- `run_state`: reconstruct from Run, child Run, TaskList, interaction, or Tool Program state.

## Exact inventory

| Family                  | Tool IDs                                                                                                                    |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Discovery               | `tool.get`                                                                                                                  |
| Skills                  | `skill.load`, `skill.propose`                                                                                               |
| Project context         | `project.get`, `run.inspect`, `project.search`, `chat.query`, `history.query`, `memory.query`                               |
| Production              | `production.query`, `production.mutate`                                                                                     |
| Canvas                  | `canvas.query`, `canvas.mutate`                                                                                             |
| Media                   | `media.query`, `media.inspect`, `media.derive`, `media.attach`, `media.link`                                                |
| Provider and generation | `provider.capabilities`, `generation.quote`, `generation.submit`                                                            |
| Results and decisions   | `result.query`, `evaluation.run`, `decision.record`, `decision.protect`                                                     |
| Delivery                | `delivery.query`, `delivery.mutate`, `delivery.preview`, `delivery.freeze`, `delivery.export`                               |
| Async operations        | `operation.get`, `operation.cancel`                                                                                         |
| Run control             | `interaction.ask`, `task.manage`, `agent.spawn`, `agent.send`, `agent.wait`, `agent.result`, `agent.cancel`, `tool.program` |

## Discovery tools

### `tool.get`

- **Owner:** frozen Capability Catalog Snapshot.
- **Purpose:** load exact definitions and examples for named tools already visible in the Run catalog.
- **Input:** `{ names: ToolId[] }`, bounded and deduplicated.
- **Success:** exact frozen schema/public metadata documents and their hashes.
- **Profile:** `R`; no cost; no CAS; safe retry; `authority_reread`.
- **Public projection:** normally omitted from Chat; `Execution details` may list materialized tools.
- **Invariant:** reads the Run snapshot, never the live Registry; cannot add or enable a tool.

### `skill.load`

- **Owner:** frozen Skill Catalog Snapshot.
- **Purpose:** load exact enabled Skill versions when Commander finds their expertise useful.
- **Input:** `{ skillIds: SkillId[] }`, bounded and deduplicated.
- **Success:** immutable Skill documents, versions, content hashes, provenance, and trust metadata.
- **Profile:** `R`; no cost; no CAS; safe retry; `authority_reread`.
- **Public projection:** loaded Skill names/versions in `Execution details`.
- **Invariant:** cannot install, enable, grant authority, inject a system message, or change the Run
  catalog.

### `skill.propose`

- **Owner:** current Project, Run interaction, and host Skill confirmation authority.
- **Purpose:** propose one reusable Project Skill in direct response to the user's request, then wait
  for exact user confirmation before registration and next-root activation.
- **Input:** `{ name, description, content }`; the host derives Skill ID, version, digest,
  provenance, trust, ownership, and confirmation identity.
- **Success:** pending `confirmationId`, immutable input hash, `waiting_confirmation` Run state, and
  Run revision.
- **Profile:** `PROTECTED`; requires `project.write` and `run.control`; no provider call or cost;
  `run_state` recovery.
- **Public projection:** exact confirmation card and, after approval, the registered Skill identity;
  rejection remains visible and writes no Skill.
- **Invariant:** confirmation is never globally waivable; changed or stale input cannot register;
  approval creates one reviewed Project Skill and enables only that exact version for the next root
  catalog. The tool cannot be invoked as a Tool Program child.

## Project context tools

### `project.get`

- **Owner:** Project and ProjectSettings.
- **Purpose:** read current Project metadata, revision, format policy, configured capabilities,
  permission summary, and budget summary.
- **Input:** `{ include: ProjectSection[] }` with a strict section enum.
- **Success:** requested typed Project sections with revisions and hashes.
- **Profile:** `R`; no paid cost; no CAS; safe retry; `authority_reread`.
- **Public projection:** none unless the information directly answers the user.

### `run.inspect`

- **Owner:** accepted Run manifest, frozen Capability/Skill Catalog Snapshots, Run resource account,
  accepted Messages, selections, attachments, and referenced authority revisions.
- **Purpose:** re-read the exact context accepted for this Run after compaction, recovery, or child
  delegation without relying on mutable Chat prose.
- **Input:** `{ include: RunContextSection[] }` with a strict enum for `manifest`, `inputs`,
  `selections`, `attachments`, `authorityRefs`, `catalogs`, `permissions`, and `resources`.
- **Success:** the selected typed sections with Message IDs/hashes, opaque attachment/media refs,
  accepted object revisions, catalog/Skill digests, permission ceiling, and known/estimated/unknown
  resource usage and remaining budget.
- **Profile:** `R`; current Run only; no paid cost; no CAS; safe retry; `run_state`.
- **Public projection:** none; a user-requested explanation may cite safe manifest facts.
- **Invariant:** never returns private reasoning, provider transcript, credentials, raw local paths,
  child-private instructions, or a live Registry view.

### `project.search`

- **Owner:** rebuildable Project search index over authoritative objects.
- **Purpose:** locate Production objects, Project Media, Delivery objects, Messages, and Results without
  loading the whole Project.
- **Input:** `{ query, kinds?, filters?, page }` using a bounded text/filter grammar.
- **Success:** `Page<SearchHit>` where every hit has an authority `ObjectRef` and source label.
- **Profile:** `R`; no paid cost; no CAS; safe retry; `authority_reread`.
- **Public projection:** none.

### `chat.query`

- **Owner:** current Project Chat and immutable Messages.
- **Purpose:** retrieve exact earlier Messages outside the current compact model view.
- **Input:** `{ chatId?, beforeSeq?, afterSeq?, messageIds?, page }`; current Chat by default; another
  Project Chat remains current-Project read.
- **Success:** `Page<PublicMessage>` with IDs, hashes, roles, status, and safe content.
- **Profile:** `R`; no paid cost; no CAS; safe retry; `authority_reread`.
- **Public projection:** none.

### `history.query`

- **Owner:** append-only Project History.
- **Purpose:** retrieve public evidence, changes, choices, generation, and undo provenance.
- **Input:** `{ eventTypes?, objectRefs?, actors?, fromSeq?, toSeq?, page }`.
- **Success:** `Page<ProjectEventView>` with sequence, actor, causal refs, public payload, and hash.
- **Profile:** `R`; no paid cost; no CAS; safe retry; `authority_reread`.
- **Public projection:** none.

### `memory.query`

- **Owner:** one immutable published ProjectMemoryVersion.
- **Purpose:** retrieve cited cross-Chat facts relevant to the current request.
- **Input:** `{ query, categories?, itemKeys?, limit }`.
- **Success:** Memory items with version, watermark, freshness, source citations, conflict state, and
  content hash.
- **Profile:** `R`; no paid cost; no CAS; safe retry; `authority_reread`.
- **Public projection:** none.
- **Invariant:** stale/unavailable is explicit; Memory never overrides current authority.

## Production tools

### `production.query`

- **Owner:** ProductionObject, ProductionRelation, and ProductionFactSource.
- **Purpose:** inspect Direction, Story, Sequence, Scene, Beat, Character, Location, Equipment,
  Wardrobe, Prop, Shot, their relationships, and field provenance.
- **Input:** `{ refs?, kinds?, parentRef?, relationFilter?, include?, page }`.
- **Success:** `Page<ProductionObjectView>` plus requested relations and citations.
- **Profile:** `R`; no paid cost; no CAS; safe retry; `authority_reread`.
- **Public projection:** none unless explicitly presented as an answer.

### `production.mutate`

- **Owner:** ProductionObject/Relation transaction and matching ProjectEvent.
- **Purpose:** create, update, relate, reorder, archive, restore, or cite Production facts.
- **Input:** strict union:
  - `create { kind, parentRef?, ordinal?, title, content }`
  - `update { ref, expectedRevision, changes }`
  - `relate { mode, relationKind, sourceRef, targetRef, expectedRevisions }`
  - `reorder { parentRef, expectedRevision, orderedChildIds }`
  - `archive|restore { ref, expectedRevision }`
  - `cite { ref, expectedRevision, fieldPath, sourceRef, relation }`
- **Success:** affected `MutationReceipt<ProductionObjectView>[]` and relation receipts.
- **Profile:** `RW`; no paid cost; object/collection CAS; idempotent operation key; cooperative cancel
  before commit; dynamic `PROTECTED` upgrade for targeted protected facts; `event_receipt`.
- **Public projection:** concise created/changed object links and changed paths with undo when valid.
- **Invariant:** `content` and `changes` use the strict schema selected by Production kind; no generic
  object patch.

## Canvas tools

### `canvas.query`

- **Owner:** ProjectCanvasState, CanvasPlacement, CanvasGroup, CanvasEdge, and CanvasSavedView.
- **Purpose:** inspect spatial state and placements without duplicating target object content.
- **Input:** `{ viewport?, targetRefs?, groupIds?, edgeIds?, include?, page }`.
- **Success:** bounded spatial objects with revisions and referenced authority IDs.
- **Profile:** `R`; no paid cost; no CAS; safe retry; `authority_reread`.
- **Public projection:** none.

### `canvas.mutate`

- **Owner:** one Canvas transaction and matching ProjectEvent.
- **Purpose:** place, move, resize, group, ungroup, connect, disconnect, annotate, arrange, remove a
  placement, or save/restore a view.
- **Input:** strict union:
  - `place { targetRef, geometry, groupId?, expectedCanvasRevision }`
  - `move|resize { placementId, geometry, expectedCanvasRevision, expectedPlacementRevision }`
  - `group { placementIds, title?, expectedCanvasRevision, expectedPlacementRevisions }`
  - `ungroup { groupId, expectedCanvasRevision, expectedGroupRevision }`
  - `connect { sourcePlacementId, targetPlacementId, label?, expectedCanvasRevision }`
  - `disconnect { edgeId, expectedCanvasRevision, expectedEdgeRevision }`
  - `annotate { placementId?, text, geometry?, expectedCanvasRevision }`
  - `arrange { placementIds, layout, spacing?, expectedCanvasRevision, expectedPlacementRevisions }`
  - `remove { placementIds, expectedCanvasRevision, expectedPlacementRevisions }`
  - `saveView|restoreView { viewId?, name?, viewport?, expectedCanvasRevision }`
    Batch actions preserve one atomic order.
- **Success:** Canvas revision plus `MutationReceipt<CanvasSpatialObject>[]`.
- **Profile:** `RW`; no paid cost; Canvas/child CAS; idempotent operation key; cancel before commit;
  `event_receipt`.
- **Public projection:** concise spatial change and link to Canvas; undo when valid.
- **Invariant:** changes only spatial facts, never Production or Media authority.

## Media tools

### `media.query`

- **Owner:** MediaBlob technical facts, GlobalMediaAsset catalog identity, ProjectMediaRef, and
  ProjectMediaLink.
- **Purpose:** search and inspect Project/Global Media, metadata, integrity, provenance, usage, and
  candidate groups.
- **Input:** `{ scope, refs?, hashes?, mediaTypes?, tags?, usages?, integrity?, query?, page }`.
- **Success:** `Page<MediaView>` with safe technical metadata and authority refs.
- **Profile:** `R`; no paid cost; no CAS; safe retry; `authority_reread`.
- **Public projection:** none unless media is presented to the user.

### `media.inspect`

- **Owner:** immutable MediaBlob bytes/technical facts, GlobalMediaAsset identity, and the accepted
  ProjectMediaRef or Message attachment binding.
- **Purpose:** give Commander model-safe evidence from a reference: an image view, bounded video
  timecode frames, bounded audio window/waveform, or document pages/text.
- **Input:** strict union selecting exactly one opaque `projectMediaRef`, `globalAssetId`,
  `acceptedAttachmentId`, or `generatedResultId`, plus one bounded view:
  `image`, `videoFrames { timecodesMs, maxDimension }`, `audioWindow { startMs, endMs }`, `waveform`,
  `documentPages { pageNumbers }`, or `text { range }`.
- **Success:** immutable `MediaObservation` handles bound to source content hash, with exact
  timecodes/page ranges, safe MIME/dimensions/duration, and bounded model-readable image/audio/text
  evidence.
- **Profile:** `R`; bounded local decoding only; no paid cost; cancellable read; safe retry;
  `authority_reread`.
- **Public projection:** observation thumbnails/labels only when material to the response.
- **Invariant:** never returns filesystem paths, URLs, headers, raw decoder state, unrestricted bytes,
  or content not bound to the accepted source hash.

### `media.derive`

- **Owner:** immutable MediaDerivation request/attempt, new MediaBlob, derived GlobalMediaAsset,
  provenance, and optional ProjectMediaRef transaction.
- **Purpose:** create a traceable derivative required for film work without exposing raw file tools.
- **Input:** strict union for `extractFrames`, `clip`, `crop`, `resize`, `proxyTranscode`,
  `extractAudio`, `waveform`, `ocr`, or `transcribe`; every variant contains one opaque source ID,
  expected source hash, bounded kind-specific options, and optional attach intent with expected
  Project revision.
- **Success:** `OperationRef`, derivation request/attempt refs, and any immediately available new
  MediaBlob/GlobalMediaAsset/ProjectMediaRef/ArtifactRef with complete source and transform provenance.
- **Profile:** `RW` for a deterministic local derivative or `EXT` for a configured paid/provider
  derivative; every catalog variant declares its exact effect and permission; source-hash and optional
  Project CAS; exact derivation hash; quote/reservation when paid; idempotent; cooperative/provider
  cancellation; durable local receipt or `provider_receipt`.
- **Public projection:** progress plus every completed derivative card and provenance label.
- **Invariant:** source bytes remain immutable; a transformation always creates a new derivative.
  Long-running state is read/cancelled through `operation.get/cancel`; `unknown` is never retried.

### `media.attach`

- **Owner:** ProjectMediaRef transaction and ProjectEvent.
- **Purpose:** attach an already authorized GlobalMediaAsset or accepted Message attachment to the
  current Project; never browse arbitrary local files.
- **Input:** exact union selecting one authorized `globalAssetId`, `acceptedAttachmentId`, or
  `generatedResultId`, plus strict Project metadata and expected Project revision.
- **Success:** `MutationReceipt<ProjectMediaRef>`.
- **Profile:** `RW`; no paid cost; Project CAS; idempotent by Project/source identity; `event_receipt`.
- **Public projection:** attached media card/link.
- **Invariant:** creates only a ProjectMediaRef. It cannot mutate bytes/technical facts or accept
  a filesystem path, arbitrary URL, network header, credential, or unaccepted upload.

### `media.link`

- **Owner:** ProjectMediaRef; `project_media_links` is only its aggregate child set.
- **Purpose:** link or unlink an active ProjectMediaRef to an active ProductionObject using
  `depicts` or `references`; Generation alone creates `generated_for`.
- **Input:** exact `{ mode, mediaRef, target, relation }` with revision/hash CAS on both refs.
- **Success:** `MutationReceipt<ProjectMediaRef>` with `changedPaths: ['productionLinks']`.
- **Profile:** `RW`; no paid cost or confirmation; ProjectMediaRef CAS plus read-only Production
  CAS; exact request replay; `event_receipt`.
- **Public projection:** the revised ProjectMediaRef. It cannot create or remove selection,
  Generation, or Delivery facts.

User file picking, drag/drop, and raw-byte upload are UI-owned actions using the same media command
service. They are not model tools because Commander never receives arbitrary local paths.

## Provider and generation tools

### `provider.capabilities`

- **Owner:** configured provider/model capability projection.
- **Purpose:** inspect available modalities, model limits, supported parameters, quote support, and
  current availability without seeing credentials.
- **Input:** `{ modality?, providerIds?, models? }`.
- **Success:** configured capability records with version/freshness and public limits.
- **Profile:** `R`; no paid cost; no CAS; safe retry; `authority_reread`.
- **Public projection:** none unless explaining a limitation.

### `generation.quote`

- **Owner:** provider quote service; no GenerationRequest mutation.
- **Purpose:** obtain a bounded or explicitly unknown cost/time estimate for an exact GenerationSpec.
- **Input:** `GenerationSpec` without a submission ID.
- **Success:** `CostQuote` and normalized provider constraints.
- **Profile:** `R`; quote calls may have bounded local/network cost but no generation charge; safe retry
  only if the provider declares it; `authority_reread`.
- **Public projection:** quote shown only when material to a choice or confirmation.

### `generation.submit`

- **Owner:** immutable GenerationRequest, GenerationAttempt, resource reservation, and provider job.
- **Purpose:** submit one exact image, video, or audio request.
- **Input:** `GenerationSpec` plus optional unexpired quote reference; Dispatcher always re-quotes or
  validates the bound before spending.
- **Success:** `OperationRef`, GenerationRequest/Attempt refs, provider receipt state, reservation,
  and any immediately returned GeneratedResults.
- **Profile:** `EXT`; `generate` permission; target CAS; canonical request hash/idempotency key;
  provider cost; cooperative/provider cancellation; `provider_receipt`.
- **Public projection:** submission progress, known usage/cost, and every valid result card.
- **Invariant:** ProviderAttempt is `prepared` durably before the network call; `unknown` is never
  automatically resubmitted.

## Result, evaluation, and decision tools

### `result.query`

- **Owner:** immutable GeneratedResult, GenerationRequest provenance, assessments, and current decision
  projection.
- **Purpose:** inspect result batches, artifacts, prompts, references, provider provenance, prior
  feedback, and current choice state.
- **Input:** `{ resultIds?, requestIds?, targetRefs?, decisionStates?, include?, page }`.
- **Success:** `Page<GeneratedResultView>` with safe provenance and ArtifactRefs.
- **Profile:** `R`; no paid cost; no CAS; safe retry; `authority_reread`.
- **Public projection:** result cards only when requested or newly produced.

### `evaluation.run`

- **Owner:** immutable ResultAssessment linked to exact subjects and evidence.
- **Purpose:** perform technical integrity, reference-similarity, continuity, coverage, or delivery
  readiness evaluation without selecting a creative winner.
- **Input:** `{ kind, subjectRefs, referenceRefs?, criteria?, provider? }` with a strict kind-specific
  schema.
- **Success:** `OperationRef` when asynchronous, assessment, visible evidence, limitations,
  ArtifactRefs, and optional recommendations.
- **Profile:** `project.read` plus `evaluate`; `R` if local or `EXT` if a configured model/provider is
  required; exact subjects and quote/reservation when paid; idempotent assessment hash;
  `authority_reread` or `provider_receipt`.
- **Public projection:** concise assessment and evidence; never a hidden filter or automatic choice.

### `decision.record`

- **Owner:** the selected Production/Result/Delivery domain command plus immutable UserChoice evidence
  and ProjectEvent in one transaction.
- **Purpose:** record reversible select, reject, refine, use-as-reference, or undo actions.
- **Input:** strict union with subject/scope refs, expected revisions, feedback, and superseded/undo
  reference where applicable.
- **Success:** decision record, updated current projection, domain mutation receipt, and undo ref.
- **Profile:** `RW`; no paid cost; subject/scope CAS; idempotent operation key; dynamic `PROTECTED`
  upgrade when changing a protected current choice; `event_receipt`.
- **Public projection:** visible choice/feedback state and affected result/object links.
- **Invariant:** Dispatcher assigns `actor=commander` for tool calls and records the causal Message/Run.
  It never accepts actor input or claims the action was user-authored. UserChoice is evidence, not a
  second current-state owner; current selection/rejection/reference state remains in the owning domain.

### `decision.protect`

- **Owner:** the same decision command boundary as `decision.record`, with protected fact/decision
  evidence, owning-domain protection projection, and ProjectEvent committed atomically.
- **Purpose:** protect or unprotect an exact Production field, selected result, or Delivery decision.
- **Input:** `{ mode: protect|unprotect, subjectRef, fieldPath?, expectedRevision, reason? }`.
- **Success:** protection decision and domain receipt.
- **Profile:** `PROTECTED`; exact confirmation always required; no paid cost; subject CAS; idempotent;
  `event_receipt`.
- **Public projection:** protection state, scope, causal confirmation, and undo when valid.
- **Invariant:** this is a separate tool only because confirmation/permission differs. It does not own
  a second protection table or let Commander construct its own confirmation.

Direct UI Select/Reject/Refine/Use-as-reference/Undo uses the same decision command service with
`actor=user`. The model tool cannot forge that actor. Commander recommendations without a committed
decision remain Assistant content.

## Delivery tools

### `delivery.query`

- **Owner:** DeliveryPlan, DeliveryItem, DeliveryManifest, DeliveryExport, and readiness projection.
- **Purpose:** inspect sequence, clips, trims, audio policy, review state, manifests, exports, and
  blockers.
- **Input:** `{ planIds?, itemIds?, manifestIds?, include?, page }`.
- **Success:** typed Delivery views with revisions, result refs, integrity, and known cost/status.
- **Profile:** `R`; no paid cost; no CAS; safe retry; `authority_reread`.
- **Public projection:** none unless presenting delivery state.

### `delivery.mutate`

- **Owner:** DeliveryPlan/Item transaction and ProjectEvent.
- **Purpose:** create or update a reversible draft, place/remove/reorder items, set trims/transitions,
  and configure embedded-audio preference.
- **Input:** strict union:
  - `create { name, settings, expectedProjectRevision }`
  - `updateSettings { planRef, expectedRevision, settings }`
  - `place { planRef, expectedRevision, shotRef, resultRef, ordinal, trim?, audioPolicy? }`
  - `remove { planRef, expectedRevision, itemId, expectedItemRevision }`
  - `reorder { planRef, expectedRevision, orderedItemIds }`
  - `trim|transition|audioPolicy { planRef, expectedRevision, itemId, expectedItemRevision, value }`
  - `archive|restore { planRef, expectedRevision }`
- **Success:** plan revision and affected `MutationReceipt<DeliveryObject>[]`.
- **Profile:** `RW`; no paid cost; plan/item CAS; idempotent operation key; cancel before commit;
  dynamic `PROTECTED` upgrade for protected clips/order/trims/audio choices; `event_receipt`.
- **Public projection:** concise sequence changes with links and undo when valid.

### `delivery.preview`

- **Owner:** immutable ReviewCut request/attempt/artifact linked to a DeliveryPlan revision.
- **Purpose:** render a non-final Review Cut for user inspection.
- **Input:** `{ planRef, expectedRevision, formatProfile, range? }`.
- **Success:** `OperationRef`, preview attempt, ArtifactRef when immediately ready, validation
  warnings, and known usage.
- **Profile:** `project.write` plus configured preview execution; local/provider `EXT` according to
  renderer; exact plan revision; quote/reservation when paid; idempotent request hash; cooperative
  cancel; `provider_receipt` or durable local receipt.
- **Public projection:** progress and playable Review Cut card.

### `delivery.freeze`

- **Owner:** immutable DeliveryManifest.
- **Purpose:** freeze one visible DeliveryPlan revision into an exact manifest before export.
- **Input:** `{ planRef, expectedRevision }`.
- **Success:** manifest ID/hash, item/content hashes, validation summary, and source revisions.
- **Profile:** `RW`; no paid cost; plan CAS; idempotent by canonical manifest hash; `event_receipt`.
- **Public projection:** manifest summary and readiness/blockers.

### `delivery.export`

- **Owner:** DeliveryExport, immutable manifest, resource reservation, and external/local destination
  receipt.
- **Purpose:** export one frozen manifest to an explicit destination and format.
- **Input:** `{ manifestId, manifestHash, destinationIntent, format, options, quoteRef? }`; no arbitrary
  path supplied by the model.
- **Success:** `OperationRef`, export state, receipt, ArtifactRef or destination summary, content hash,
  and known cost.
- **Profile:** `PROTECTED` and `EXT`; exact confirmation always required; manifest hash CAS;
  idempotency key; destination/provider cancellation where safe; `provider_receipt`.
- **Public projection:** export confirmation, progress, final receipt, artifact, cost, and failure.

Destination picking and OS save dialogs are user-owned UI actions. Commander may prepare the exact
export request but cannot invent or read a local path.

## Async operation tools

`OperationRef` is a shared public control projection over a real domain attempt. These tools do not
create a second job table, scheduler, retry policy, or ownership model. Every operation delegates to
the GenerationAttempt, MediaDerivation, ResultAssessmentAttempt, ReviewCutAttempt, or DeliveryExport
that owns the actual state and receipt.

### `operation.get`

- **Owner:** Dispatcher operation projection backed by the referenced domain attempt and provider or
  durable local receipt.
- **Purpose:** read or safely reconcile one or more long-running operations without resubmitting them.
- **Input:** `{ operations: OperationRef[] }`, bounded, deduplicated, and current-Project/Run scoped.
- **Success:** exact operation revisions and states `prepared|running|submitted|unknown|succeeded|failed|cancelled`,
  known/estimated/unknown usage and cost, public blockers/errors, domain result refs, and ArtifactRefs.
- **Profile:** `R` with owner-specific reconciliation; no new reservation or side effect; idempotent;
  cancellation of the read only; `authority_reread`, durable local receipt, or `provider_receipt`.
- **Public projection:** only changed progress, usage, blockers, and newly available artifacts/results.
- **Invariant:** `unknown` remains unknown until authoritative reconciliation; it never means failed,
  free, or safe to retry.

### `operation.cancel`

- **Owner:** the referenced domain attempt's cancellation command and receipt.
- **Purpose:** request cooperative/provider cancellation through the same owner that created the
  operation.
- **Input:** `{ operations: { ref: OperationRef, expectedRevision, expectedState }[] }`, bounded and
  current-Project/Run scoped.
- **Success:** reconciled operation revisions/states, retained outputs, and known non-refundable usage.
- **Profile:** `CTRL`, `RW`, or `EXT` inherited from the owning attempt; state CAS; idempotent cancel
  fingerprint; no new paid operation; owner-specific cancellation; owner receipt recovery.
- **Public projection:** cancellation result, retained outputs, and any remaining unknown state.
- **Invariant:** unsupported or too-late cancellation is explicit and never deletes valid artifacts,
  rewrites usage, or creates a replacement attempt.

## Run control tools

### `interaction.ask`

- **Owner:** one pending RunInteraction and Run state.
- **Purpose:** ask a material structured or free-text question and wait for the user's answer.
- **Input:** `{ prompt, options?, allowFreeText, contextRefs? }`; options are optional and bounded only
  for UI/resource safety, not required by creative policy.
- **Success:** pending interaction ID/state; the answered continuation receives a separate exact user
  event.
- **Profile:** `CTRL`; no paid cost; one active interaction CAS; idempotent; `run_state`.
- **Public projection:** question card in the current Assistant response.
- **Invariant:** not used for protected operations; Dispatcher owns confirmations.

### `task.manage`

- **Owner:** optional Run TaskList and TaskItems.
- **Purpose:** get, create, rename, add, update, reorder, remove, or terminalize Commander working tasks.
- **Input:** strict union:
  - `get {}`
  - `create { title?, tasks? }`
  - `rename { expectedRevision, title }`
  - `add { expectedRevision, parentTaskId?, ordinal?, title }`
  - `update { expectedRevision, taskId, title?, status?, resultSummary?, childRunId? }`
  - `reorder { expectedRevision, orderedTaskIds, parentTaskId? }`
  - `remove { expectedRevision, taskId }`
  - `terminalize { expectedRevision, status, summary? }`
- **Success:** current TaskList snapshot, revision, and changed task IDs.
- **Profile:** `CTRL`; no paid cost; Run/TaskList CAS; idempotent; `run_state`.
- **Public projection:** one inline TaskList in the current Assistant response.
- **Invariant:** no phases, dependency gate, approval authority, tool policy, or Chat lifecycle effect.

### `agent.spawn`

- **Owner:** child Run under the current Run tree.
- **Purpose:** delegate a scoped objective with selected context and narrower/equal boundaries.
- **Input:** `{ displayName, objective, contextRefs, toolAllowlist?, permissionCeiling?, budgetCaps? }`.
- **Success:** child Run ref, accepted manifest/catalog hashes, and initial public state.
- **Profile:** `CTRL`; child tools/permission/budget can only narrow; structural depth/concurrency/total
  limits; idempotent spawn fingerprint; `run_state`.
- **Public projection:** nested child row with objective, state, and budget.

### `agent.send`

- **Owner:** descendant Run inbox and activation sequence.
- **Purpose:** send a follow-up objective, correction, or new bounded context to an existing child Run
  without rebuilding or exposing its private reasoning.
- **Input:** `{ childRunId, message, contextRefs? }`, restricted to descendants and bounded public
  content.
- **Success:** durable inbox message ID, child activation epoch, delivery state, and child Run state.
- **Profile:** `CTRL`; no separate paid operation until the child resumes; descendant CAS; idempotent
  message fingerprint; cancellable before delivery; `run_state`.
- **Public projection:** concise “follow-up sent” row and subsequent child progress.
- **Invariant:** the inbox is append-only and actor identity is host-assigned. A child consumes messages
  FIFO at safe model boundaries; terminal children require a related retry/cold-resume Run rather than
  mutation.

### `agent.wait`

- **Owner:** descendant Run state.
- **Purpose:** wait for one or more existing descendants without polling arbitrary Runs.
- **Input:** `{ childRunIds, condition, timeoutMs? }`, bounded to descendants.
- **Success:** child state summaries and newly available public results.
- **Profile:** `CTRL`; no new paid operation; cancellable wait; `run_state`.
- **Public projection:** state changes only.

### `agent.result`

- **Owner:** terminal descendant Run public projection.
- **Purpose:** retrieve validated public child results, object/artifact refs, usage, and blockers.
- **Input:** `{ childRunIds }`, bounded to descendants.
- **Success:** terminal child summaries and canonical public result refs.
- **Profile:** `CTRL`; no paid cost; safe retry; `run_state`.
- **Public projection:** nested child result summary when relevant.

### `agent.cancel`

- **Owner:** descendant Run command service and append-only Run state.
- **Purpose:** cancel a no-longer-needed descendant and its still-active descendants without waiting
  for normal completion.
- **Input:** `{ childRunId, expectedRevision, reason? }`, restricted to descendants; `reason` is a
  bounded public explanation, never a system-role instruction.
- **Success:** reconciled child/descendant states, retained public results/artifacts, and known usage.
- **Profile:** `CTRL`; descendant-only; Run CAS; idempotent cancellation fingerprint; cooperative
  cancellation at model/tool/provider safe boundaries; `run_state`.
- **Public projection:** cancelled child row, retained results, and any operation that remains unknown.
- **Invariant:** cannot cancel an ancestor, sibling, unrelated Run, or erase events/charges. Direct UI
  Stop uses this same Run command service with host-assigned `actor=user`.

### `tool.program`

- **Owner:** one bounded Tool Program child Run.
- **Purpose:** execute strict call/map/batch/filter/sort/validate/take operations over tools in the
  frozen catalog.
- **Input:** typed, bounded Tool Program AST with display name and optional scoped context refs.
- **Success:** aggregate canonical results, child operation refs, ArtifactRefs, usage, and blocker.
- **Profile:** `CTRL`; child calls retain their own effect/permission/cost/CAS/retry profiles; structural
  operation/size/concurrency limits; cooperative cancellation; `run_state`.
- **Public projection:** one parent operation with expandable safe child summaries.
- **Invariant:** no nested Tool Program, arbitrary code, shell, filesystem, imports, network, or direct
  service access.

## User-only and host-only actions

These deliberately are not Commander tools:

| Action                                       | Owner and reason                                                                                                                   |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Create/open/archive a Project                | Project Home user command; no cross-Project model authority                                                                        |
| Pick local files or folders                  | OS/UI file picker; local paths remain private                                                                                      |
| Direct candidate Select/Reject/Undo          | UI decision command with `actor=user`                                                                                              |
| Answer a question                            | Exact user interaction event                                                                                                       |
| Approve a protected operation                | Dispatcher confirmation response; Commander cannot self-approve                                                                    |
| Stop/pause/resume/retry a root Run           | User Run control; descendant cancellation may also be requested through `agent.cancel`; retry only when exact recovery seed exists |
| Connect accounts or enter credentials        | Settings and secure storage                                                                                                        |
| Install/remove providers, Skills, or plugins | Settings and trust management                                                                                                      |
| Expand permission or budget                  | Settings or exact protected confirmation                                                                                           |
| Choose export destination                    | OS/UI destination picker                                                                                                           |
| Permanently purge Project/Chat/media         | Protected user command with impact preview                                                                                         |

The underlying domain command services may be shared with model tools, but actor, scope, confirmation,
and event provenance are assigned at the trusted UI/Dispatcher boundary.

## Current tool cutover

There are no compatibility aliases. A current tool either maps to one target authority or is deleted.

| Current family/path                                  | Target                                                                                                                               |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Asset browsing/import/link tools                     | `media.query`, `media.attach`, `media.link`                                                                                          |
| Character, entity, equipment, location, script tools | `production.query`, `production.mutate`                                                                                              |
| Canvas node/layout/edge tools                        | `canvas.query`, `canvas.mutate`; domain content leaves Canvas                                                                        |
| Canvas meta/question tools                           | `interaction.ask`; protected confirmation remains Dispatcher-owned                                                                   |
| Canvas generation tools                              | `generation.quote/submit` plus `operation.get/cancel`; results become GeneratedResults                                               |
| Provider inspection                                  | `provider.capabilities`                                                                                                              |
| Provider/account mutation                            | Delete from model catalog; Settings only                                                                                             |
| Snapshot tools                                       | Delete; use domain events, immutable evidence, and explicit undo/restore commands                                                    |
| Meta tools                                           | Keep `tool.get`; delete model-facing `tool.compact` because compaction is a host-derived view; replace `guide.get` with `skill.load` |
| `prompt.get`, `prompt.setCustom`                     | Delete with PromptStore/product surface                                                                                              |
| `preset.manage`, Color Style, Shot Template tools    | Delete; bound result provenance remains; reviewed expertise may become Skills                                                        |
| Fixed TaskList production/media/audio/delivery tools | Delete; use domain/generation/delivery tools plus optional `task.manage`                                                             |
| `runChecklist.manage`                                | Delete; `task.manage` owns optional progress only                                                                                    |
| Copywriting and text transform/prompt-polish tools   | Delete; Commander writes text directly, may load a relevant Skill, and commits durable story text through `production.mutate`        |
| Vision/analyze tools                                 | `evaluation.run` or direct configured model observation bound to the accepted reference; no hidden result selection                  |
| Existing Subagent and Tool Program tools             | Converge to continuable `agent.*` with durable inbox/activation and `tool.program` under Project/Dispatcher contracts                |

Storage, IPC, UI, docs, tests, catalogs, and registration for deleted tools are removed in the one-time
cutover. No legacy IDs remain callable, discoverable, or loadable from a new Run.

## Acceptance-scenario trace

| Runtime scenario       | Exact tools or trusted action                                                             | Authority and visible result                                                  |
| ---------------------- | ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Simple factual request | `project.get/search`, `production.query`, `media.query`, or no tool                       | Answer cites current Project facts                                            |
| Small reversible edit  | Matching `*.mutate` tool                                                                  | Mutation receipt, ProjectEvent, object link, undo when valid                  |
| Complex brief          | Optional `task.manage`; any domain tools Commander chooses                                | One inline TaskList and real object/results                                   |
| Parallel analysis      | Optional `agent.spawn/send/wait/result/cancel`; trusted UI child pause/resume/stop        | Nested visible, redirectable, controllable child Runs and validated summaries |
| Understand a reference | `media.query/inspect`; `media.derive` plus `operation.get/cancel` for a long derivative   | Hash-bound frames/audio/pages/text and visible derivative provenance/progress |
| Reference generation   | `media.query/inspect`, `generation.quote/submit`, `operation.get`                         | Exact request provenance and all result cards                                 |
| Candidate comparison   | `result.query`, optional `evaluation.run`; `operation.get/cancel` when asynchronous       | Evidence/recommendation and visible progress; no hidden filtering             |
| User selects a result  | UI decision command or `decision.record` with Commander actor/causal Message              | One decision projection shared by Chat and Media                              |
| Protect a fact         | UI protection or `decision.protect` + exact confirmation                                  | Protection evidence and affected field                                        |
| CAS conflict           | Any write tool                                                                            | Structured `conflict` with current revision; no overwrite                     |
| Tool unavailable       | Any frozen tool                                                                           | Structured unavailable result; catalog stays unchanged                        |
| Provider unknown       | `generation.submit`, `operation.get`                                                      | Attempt remains unknown until receipt reconciliation; no duplicate            |
| Cost unavailable       | `generation.quote/submit`, `evaluation.run`, `delivery.preview/export`                    | Capped Run blocks before spending; otherwise unknown stays visible            |
| Review Cut             | `delivery.preview`, `operation.get/cancel`                                                | Playable artifact/progress or explicit retained/unknown state                 |
| Protected export       | `delivery.freeze`, `delivery.export`, `operation.get/cancel`, UI destination/confirmation | Exact manifest, receipt, artifact, progress, and cost                         |
| User redirects         | Trusted Message/run boundary                                                              | Exact user event; Commander changes method without fake system prose          |
| Restart                | Host recovery plus existing tools                                                         | Same catalog/manifest, no duplicate Message/tool/provider spend               |
| Skill use              | `skill.load`                                                                              | Exact Skill version/digest in execution evidence                              |
| Completion             | No special tool                                                                           | Final Assistant summary links only real objects/results/events                |

## Catalog acceptance checks

Before implementation approval:

1. Exactly 40 tool headings exist and every ID appears once in the canonical inventory.
2. Every tool has owner, purpose, strict input, strict success, effect/permission, CAS/idempotency,
   cost/cancel/recovery, public projection, and any necessary invariant.
3. Every write owner exists in the target data contract and writes current state plus ProjectEvent in
   one transaction where required.
4. Every external side effect has a prepared durable attempt and explicit unknown-state behavior.
5. Every Runtime acceptance scenario traces to an exact tool or trusted non-tool action.
6. No tool depends on a fixed phase, TaskList gate, prompt/preset/template resource, phrase classifier,
   hidden capability, direct service bypass, raw shell, arbitrary code, database, credential, or local
   path.
7. The catalog remains a capability surface. Nothing in it defines a tool order or required film
   workflow.
