# Ground-up Commander AI Video Production Harness Contract

## Status

Planning only. This document does not authorize source changes, database migration, deletion, real
provider calls, or release work.

This contract defines the only target Runtime for the ground-up Lucid Fin AI video production
Harness. It replaces current Commander orchestration, Canvas-scoped context, tool routing, continuation
policy, and UI activity plumbing; it is not a compatibility wrapper or a second Agent mode.

This contract is subordinate to the product model in
[`2026-08-15-project-first-lucid-fin.md`](./2026-08-15-project-first-lucid-fin.md) and the data ownership
model in
[`the archived data/history cutover`](../archive/target-transition/2026-08-15-project-data-history-memory-cutover.md).
Its public states are rendered by
[`../design/project-shell-screen-contract.md`](../design/project-shell-screen-contract.md) across the
workspace ownership defined in
[`../design/project-workspaces-contract.md`](../design/project-workspaces-contract.md).
The exact 40-tool target catalog that realizes this surface is frozen in
[`2026-08-15-film-tool-catalog-contract.md`](./2026-08-15-film-tool-catalog-contract.md).

## Purpose

Lucid Fin is a Codex- and Claude Code-style agent application for AI video creation. The host gives
Commander an exact Project context, capable AI video-production tools, optional Skills, and enforceable
safety boundaries. Commander chooses how to work.

The runtime must not become a host-authored video workflow engine. It must also not become an
unrestricted shell. Its single job is to let a capable model use typed Project tools repeatedly until
it has produced a useful, visible result or reached a real user, safety, provider, or resource
boundary.

## Harness architecture

```text
Project UI + Commander Dock
          │ immutable Message / selection / Run command
          ▼
Run Coordinator ──────────────── public Run state ───────────────┐
          │ accepts/schedules/cancels/recovers                    │
          ├── Context Builder ── exact model view                 │
          ├── Model Adapter ─── canonical stream/usage            │
          └── Agent Loop                                            │
                  │ model-selected typed call                       │
                  ▼                                                 │
             Single Dispatcher                                      │
                  │ guarded command / provider attempt               │
                  ▼                                                 │
        Project Domain Services + configured Providers              │
                  │                                                 │
                  └── Durable public events + encrypted recovery ───┘
```

This is one Harness composition root with one-way authority:

- **Run Coordinator** owns root/child Run acceptance, activation, same-Chat ordering, cross-Chat
  scheduling, pause/stop, resource-family assignment, terminalization, and recovery barriers.
- **Context Builder** derives a bounded model view from the immutable Context Manifest, Messages,
  events, frozen catalogs, cited Memory, and current authority reads. It never owns Project truth.
- **Model Adapter** converts a configured model API into canonical assistant deltas, typed tool calls,
  usage, checkpoints, and terminal provider failures. It does not execute tools, alter the catalog,
  inject a workflow, infer approval, or own conversation state. Model requests use the same resource,
  cancellation, provider-attempt, privacy, and durable-event kernel as other external operations.
- **Agent Loop** alternates canonical model output and canonical tool results until Commander finishes
  or a real boundary waits/stops it. It owns no domain data and contains no film-stage state machine.
- **Dispatcher** is the sole model-operation execution boundary. It validates and guards every tool,
  Subagent, Tool Program child call, and external side effect before reaching a domain service.
- **Project Domain Services** own Project, Production, Canvas, Media, Result/Choice, Delivery, History,
  and attempt state. Direct UI commands and Dispatcher calls share these services but retain trusted
  actor identity.
- **Durable Events and Recovery** are the only resumability surface. Renderer stores, stream buffers,
  context compaction, and private reasoning are not authorities.

The target application has no second loop, second Dispatcher, background-job database, Canvas runtime,
or renderer-owned execution state.

## One runtime, not a stack of agents

There is one Commander Agent Loop, one canonical Tool Catalog, one Dispatcher, one hierarchical
resource-accounting system, one append-only Run timeline model, and one public progress surface.

TaskList, Skills, Subagents, and Tool Program are optional capabilities used by that loop. They are not
separate workflow engines and do not own alternate permission, event, context, or execution paths.

```text
Project Chat message + exact UI selection
  -> accept Run and freeze Context Manifest + Capability Catalog
  -> model observes the accepted context
  -> model may retrieve facts, load Skills, create a TaskList, delegate, or call tools
  -> one Dispatcher validates and executes every operation
  -> model observes canonical results and public facts
  -> repeat while Commander chooses and boundaries permit
  -> visible result, material question, protected confirmation, blocker, stop, or final summary
```

## Run coordination and concurrency

- A Chat has at most one active root Run activation so its public transcript remains ordered. Child
  Runs may execute concurrently under that root within the accepted structural/resource limits.
- Sending another Message to an active Chat never fails merely because a Run exists. The Message is
  persisted immediately with its user identity. At the next technically safe model boundary the Run
  Coordinator either delivers it to the active Run as an ordered inbox item or, if that Run is already
  terminalizing/cannot safely accept input, queues a request for the next root Run; that Run is
  accepted only when it can be scheduled. The UI shows `delivered`, `queued`, or `waiting`; it never
  fabricates a system instruction.
- Different Chats in the same Project may run in the background concurrently. They share Project
  authority only through revision/CAS-protected domain commands; they do not share transcripts or
  mutable model context.
- Different Projects may run concurrently subject to configured global/provider resource limits.
- Pause stops new model/tool scheduling at a safe boundary. Stop requests cancellation of the root and
  active descendants while preserving events, usage, valid results, and any external operation that
  remains `unknown` or non-cancellable.
- Restart enumerates nonterminal Runs, verifies catalogs/manifests/private recovery, restores resource
  families once, and resumes eligible Runs in parent-before-child order. It never converts missing
  evidence into success or repeats an accepted Message/provider submission.
- A completed/failed/blocked/cancelled Run is immutable. Retry or continuation creates a related Run
  from a verified seed; it never reactivates the terminal row.

Run coordination is technical scheduling, not creative routing. It does not decide whether a user
request should use a TaskList, Skill, Subagent, generation tool, or production phase.

## Model Adapter protocol

Every configured Commander model implements one target protocol. The Agent Loop supplies a canonical
request containing the Run/model operation ID, minimal system prompt, derived model messages, the
currently materialized subset of the frozen catalog, output/context limits, reasoning-strength value
when the provider supports it, and cancellation signal.

The adapter emits only the canonical stream union:

- `assistant_delta { publicText }`
- `tool_call { providerCallId, toolId, canonicalArguments }`
- `usage { known|estimated|unknown token and cost amounts }`
- `model_checkpoint { provider-safe continuation metadata }`
- `model_completed { finishReason }`
- `model_failed { typedCode, retrySafety, providerState }`

Provider-specific reasoning payloads, thought signatures, raw bodies, headers, credentials, stack
traces, and error text do not cross into public events or Project evidence. A provider-safe checkpoint
may enter encrypted recovery only when its schema explicitly permits it.

The adapter does not append Messages, mutate Run state, call tools, choose a workflow, compact context,
settle budget, or perform opaque retries. The Run Coordinator prepares the model attempt and resource
reservation; the Agent Loop consumes canonical events; the Dispatcher executes tool calls. A transport
retry is allowed only when the model-attempt contract proves that no accepted billable operation can
be duplicated. Missing usage/cost stays unknown.

## Responsibility boundary

### The host owns

- Project, Chat, Run, UserChoice, Media, Production, Canvas, Delivery, and History authority.
- Exact accepted user input, attachments, selections, revisions, hashes, locale, and timezone.
- Tool definitions, schemas, versions, side-effect declarations, and public projections.
- Project scope, permission, privacy, budget, provider-truth, CAS, idempotency, and recovery checks.
- Credential isolation and provider submission receipts.
- Durable public evidence, private encrypted recovery data, and persist-before-broadcast ordering.
- Showing every valid creative result and recording explicit user choices.

### Commander owns

- Interpreting the user's desired outcome.
- Deciding what facts to inspect and which Skills to load.
- Deciding whether a plan or TaskList is useful.
- Choosing tools, ordering work, revising its method, and stopping when the requested outcome is met.
- Writing and refining generation prompts from the current request, references, and Project facts.
- Deciding whether scoped or parallel work benefits from a Subagent or Tool Program.
- Explaining progress, presenting results, asking material questions, and writing the final summary.

### The host must never decide for Commander

- A fixed film-production phase order.
- Which creative tool must be used next.
- Whether every request requires a plan, TaskList, Skill, or Subagent.
- Approval intent from a local phrase table.
- A creative answer, visual direction, candidate ranking, or subjective regeneration policy.
- Provider-facing prompt wording beyond explicit provider validation and limits.

## Accepted Run contract

Run acceptance is one transaction. It freezes:

- Project ID and revision.
- Chat ID and accepted user Message ID/hash.
- Explicit attachments and selected references.
- UI selection with object IDs, revisions, hashes, and minimal snapshots.
- Current Project History watermark.
- Project Memory version and watermark, or an explicit unavailable/stale state.
- Project settings, configured provider capabilities, permission mode, and resource budget.
- An immutable, content-addressed Capability Catalog Snapshot containing the complete tool definitions,
  versions, schemas, public projection contracts, and Skill catalog digests, plus its canonical hash.
- Model, locale, and timezone.

The resulting Context Manifest is immutable. Later Project edits do not alter what the Run originally
received. New writes still re-read current authority and use expected revisions through CAS.

An active Run never silently gains, loses, or replaces a tool, Skill version, provider, permission, or
budget. A changed environment creates a new Run or an explicit retry with a visible manifest diff.

## Minimal system prompt

The system prompt contains only stable runtime rules:

1. **Identity** — Commander is Lucid Fin's AI video-production agent working inside one Project.
2. **Truth** — distinguish observed facts, tool results, recommendations, and unknowns; never claim
   unperformed work or unseen media.
3. **Scope** — use the accepted Project context and retrieve additional authoritative facts as needed.
4. **Authority** — tools may be proposed freely, while the Dispatcher enforces permissions, budget,
   CAS, privacy, and provider truth.
5. **Discovery** — use the frozen Tool and Skill catalogs; load detailed schemas or Skill content only
   when useful.
6. **Communication** — give concise public progress, ask only material questions, present real
   artifacts, and end with an evidence-backed summary.
7. **Locale** — follow the user's language and Project conventions.

It does not contain:

- Video-production stages, phase gates, approval scripts, response phrase tables, or a required tool
  order.
- A copy of every tool schema, Skill, provider manual, or Project fact.
- Prompt templates, style presets, negative-prompt formulas, or mandatory quality rubrics.
- Instructions to always plan, always use a TaskList, always delegate, or always ask before acting.
- Host implementation details for CAS, storage, recovery, event persistence, or credentials.

## Context and retrieval

The initial model view is intentionally small:

- The accepted user Message and attachment/reference summaries.
- Exact current UI selection.
- Relevant recent Chat Messages.
- A compact Project summary and Memory index with citations and freshness.
- The frozen Capability Catalog index.
- Current resource and permission summaries.

Commander queries full authoritative objects only when needed. Retrieval returns object IDs,
revisions, hashes, source citations, and bounded content. Project Memory is a cited retrieval aid, not
authority; conflicts are resolved by current Project objects and ordered user evidence.

Compaction creates a derived model view. It never edits Messages, Run events, Project History, user
choices, or provider receipts. Private reasoning remains transient and is never exposed as an event,
Message, Memory item, or execution detail.

## Stable Capability Catalog

The catalog is generated from the canonical Tool and Skill registries at Run acceptance. It is sorted,
versioned, canonicalized, stored as an immutable content-addressed snapshot, and linked to the Run by
ID and hash. Storing only the hash is insufficient because cold recovery must reconstruct the exact
definitions without consulting a changed live Registry.

Every installed tool relevant to the product is visible for the whole Run, including tools that may
require confirmation or be blocked by current policy. Permission is an execution result, not a method
of steering the model by hiding capabilities.

The initial catalog is compact: name, purpose, domain, effect class, version, schema digest, and current
availability summary. `tool.get` loads exact schemas and examples from the frozen snapshot, never the
live Registry. It does not add tools or change availability. A small catalog may be sent natively in
full. A large catalog uses the same deterministic index plus on-demand schema materialization. The set
of schemas materialized to the model may grow, but the Capability Catalog never changes. In both modes
the Dispatcher permits only definitions in the frozen snapshot.

Tool grouping follows authority, not UI buttons. One cohesive authority may expose a strict
discriminated action union, but unrelated effects are not collapsed into a generic command blob.

## Canonical ToolDefinition

Every callable operation has one definition and one implementation boundary:

- `name`, `version`, `description`, `domain`, and `category`.
- Strict canonical input and output schemas.
- Read, reversible-write, destructive, external, and credential effects.
- Project scope and cross-Project behavior.
- Required permission and confirmation class.
- Cost quote, usage measurement, unknown-cost behavior, and budget dimension.
- Expected revision/CAS requirements.
- Idempotency key, retry safety, provider submission state, timeout, and cancellation behavior.
- Secret fields and public input/result projection.
- Artifact references and public progress projection.
- Context facts and recovery/replay behavior.

Inputs reject unknown or invalid fields at the trust boundary. Successful outputs are fully validated,
canonicalized, cloned, and frozen before Commander sees them. Raw provider responses, file paths,
credentials, private prompts, and stack traces never enter public results.

The normalized result union includes:

- `succeeded`
- `validation_failed`
- `permission_required`
- `permission_denied`
- `budget_blocked`
- `cost_unknown`
- `conflict`
- `provider_unavailable`
- `provider_state_unknown`
- `retryable_failure`
- `non_retryable_failure`
- `cancelled`
- `recovery_required`

The model receives structured facts and safe messages, not host-written behavioral instructions about
what it must do next.

## Single Dispatcher

All built-in tools, provider adapters, plugin tools, Tool Program child calls, and Subagent operations
use this exact pipeline:

```text
model choice
  -> resolve definition from frozen catalog
  -> strict input schema validation
  -> bind exact Project and Run scope
  -> permission policy + cost quote + CAS / provider-state preflight
  -> if protected: persist exact confirmation, wait, then re-read and revalidate
  -> persist operation fingerprint + idempotency key + budget reservation
  -> persist ProviderAttempt as prepared before any external submission
  -> execute with cancellation and timeout
  -> strict output schema validation
  -> settle resource usage exactly once
  -> derive public projection, artifact refs, and context facts
  -> persist public event + encrypted recovery supplement atomically
  -> broadcast public event
  -> return canonical result to Commander
```

There is no direct service bypass for “special” tools. UI commands use the same domain command
services and invariants but remain user-authored actions. The Dispatcher enforces safety; it does not
select the next tool, rewrite prompts, create film stages, or decide whether a result is creatively
good.

A protected confirmation is Dispatcher state, not a model-callable tool and never something Commander
can approve for itself. Its immutable request binds the exact input, target revision, Context Manifest,
operation fingerprint, and cost quote. After the user responds, the Dispatcher re-reads authority and
revalidates the whole request before execution. A changed input, revision, policy, catalog, or quote
invalidates the confirmation.

Protection is owning-domain state, not a hard-coded tool list. Before any Production, Result-choice,
or Delivery mutation, the Dispatcher reads the exact targeted field/relationship protection. If the
change would alter protected state, it upgrades that immutable call to `PROTECTED`, records a pending
confirmation, and performs no mutation. After confirmation it re-reads protection and all expected
revisions, then atomically commits the domain change, UserChoice evidence, and ProjectEvent. The
confirmation is `actor=user`; a Commander-originated domain operation remains `actor=commander` and
cites that confirmation. A direct UI mutation is `actor=user` for both action and evidence.

## Agent Loop

The loop continues while Commander chooses to work and the accepted resource boundaries permit it. It
has no product-level fixed step count. Context-window limits, provider timeouts, bounded retries for
technical failures, cancellation, exact duplicate-operation detection, and a hard watchdog remain
safety boundaries. The host does not judge whether a creative method is “productive” or force a
replan; it may stop only a technically identical operation loop or a structural resource violation.

The loop ends or waits when:

- Commander provides a final answer and useful result.
- The user stops or pauses the Run.
- A material question or protected confirmation needs the user.
- Budget, context, permission, privacy, provider, CAS, or recovery returns a structured blocker.
- A provider operation has unknown submission state and cannot be safely repeated.
- The same canonical operation fingerprint repeats beyond the technical loop limit without new state.

A user follow-up while a Run is active is either delivered at a safe model boundary as a clearly
identified user Message or queued as the next Run. It is never disguised as a system instruction.

## Runtime state machines

Run state is explicit and persisted:

```text
accepted -> running
running -> waiting_question | waiting_confirmation | paused
waiting_question | waiting_confirmation | paused -> running | cancelled
running -> completed | blocked | failed | cancelled
recovering -> running | blocked | failed
```

`blocked`, `failed`, `completed`, and `cancelled` are terminal. A changed permission, budget, provider,
or catalog cannot mutate and resume the old Run; the user or Commander creates a related continuation
or retry with a visible Context Manifest diff.

Every external provider submission has its own durable state machine:

```text
prepared -> submitted -> succeeded | failed
prepared | submitted -> unknown
unknown -> submitted | succeeded | failed only after receipt-based reconciliation
```

`prepared` is written with the operation fingerprint, idempotency key, quote, reservation, target
revision, and request hash before network side effects. `unknown` is never treated as failed and never
automatically resubmitted.

## Target film-production tool surface

The names below explain authority families, not a workflow sequence. The normative IDs and contracts
are defined in
[`2026-08-15-film-tool-catalog-contract.md`](./2026-08-15-film-tool-catalog-contract.md).

### Project and context

- Query Project metadata, current settings, History evidence, cited Memory, Messages, and object
  revisions.
- Search across authoritative Project objects without exposing unrelated Projects.
- Read the exact accepted context and current resource state.

### Production

- Create, inspect, update, relate, reorder, archive, and restore Direction, Story, Sequence, Scene,
  Beat, Character, Location, Equipment, Wardrobe, Prop, and Shot objects.
- Attach field-level evidence and expected revisions.
- Preserve direct user edits and choices as evidence; use latest explicit evidence when revising.

### Canvas

- Place, move, size, group, ungroup, connect, annotate, arrange, and remove spatial references.
- Canvas tools change spatial facts only. They do not duplicate or overwrite Production or Media
  authority.

### Media

- Search Global Media and Project Media, attach references, inspect hash-bound images, video frames,
  audio windows/waveforms, and document evidence, and create traceable media derivatives.
- Compare candidates and repair missing references through authority IDs; transformations create new
  immutable derivatives rather than modifying source bytes.
- Never expose raw local paths or credentials to Commander.

### Generation

- Inspect configured provider capabilities and limits.
- Quote and submit image, video, and audio generation.
- Bind every request to the accepted Message, selected references, target object revision, complete
  provider-facing prompt, public parameters, seed, idempotency key, and budget reservation.
- Return every valid result as a GeneratedResult; technical retries cover only timeout, empty/corrupt
  output, explicit provider failure, or other non-subjective contract failure.

### Asynchronous operations

- Read/reconcile and cancel long-running Generation, Media Derivation, Evaluation, Review Cut, and
  Delivery Export operations through one `OperationRef` control projection.
- Keep the real attempt and receipt in its owning domain; `operation.get/cancel` never creates a
  second job database or retry engine.
- Preserve `unknown` until receipt-based reconciliation and never infer failure, zero cost, or retry
  safety from missing state.

### Results and choices

- Inspect candidates, technical assessments, comparisons, provenance, and prior user feedback.
- Present recommendations and prepare refinements.
- Record selection, rejection, refinement, use-as-reference, protect, unprotect, and undo only when the
  action is causally linked to an accepted user Message or direct UI action. A direct UI action is
  recorded with `actor=user`; an action executed by Commander is recorded with `actor=commander` and
  its causal Message/Run. No phrase classifier guesses intent, and Commander cannot fabricate or label
  its own action as user-authored. Actor identity is assigned by the host, never accepted as a tool
  argument.

### Delivery

- Inspect and prepare Delivery Sequences, place selected results, reorder, trim, set audio policy,
  prepare Review Cuts, validate readiness, freeze manifests, and export.
- Sequence drafting is reversible. Permanent publication, sending, irreversible export, or expanded
  spending remains protected.

### Evaluation

- Perform technical integrity, reference similarity, continuity, coverage, and delivery validation.
- Return visible evidence and recommendations. Evaluation never hides candidates or silently chooses
  the creative winner.

### Capability management

- Read configured provider/model capabilities, available Skills, plugins, permissions, and budget.
- Commander may choose among already configured providers/models within Project policy and budget.
- Credential entry, provider installation/removal, account connection, permission expansion, and
  budget expansion remain user-managed Settings or protected actions.

### Control capabilities

- `tool.get`, `skill.load`, optional `task.manage`, optional
  `agent.spawn/send/wait/result/cancel`, material questions, protected confirmations, and typed Tool
  Program.

## Capabilities that do not exist

- Raw shell, PowerShell, arbitrary JavaScript, unrestricted filesystem, arbitrary network, or direct
  database access.
- Direct ProjectEvent or ProjectMemory mutation.
- Prompt, Style, Preset, Template, Process Prompt, Guide Injection, or Tool Injection managers.
- Local approval phrase classifiers or hidden workflow controllers.
- Raw credentials, provider responses, logs, stack traces, or private reasoning access.
- A tool that marks a subjective creative result selected without explicit user evidence.

## Skills

At Run acceptance Commander receives a compact catalog of enabled built-in, installed, and Project
Skills. It loads exact immutable versions on demand. Loaded Skill IDs, versions, and digests are
recorded in the Run.

A Skill contains reusable film expertise, examples, and evaluation considerations. It cannot add a
tool, grant permission, expand budget, bypass CAS, alter event persistence, force a stage order, or
inject hidden system instructions.

Users manage Skill installation, enablement, removal, and auditing. Commander decides whether a Skill
is useful. Old prompts are never bulk-converted; selected durable expertise is manually rewritten and
reviewed as a Skill.

## TaskList

TaskList is Commander-owned working memory and public progress for the current Assistant response.

- It is optional for simple work.
- Commander writes concise task names in the user's language and may add, rename, reorder, complete,
  block, or remove tasks as reality changes.
- It has no fixed production phases, approval gates, hidden tool policy, or authority over Chat
  deletion.
- Tasks may link to real Project objects, GeneratedResults, or child Runs.
- The TaskList terminalizes with the owning Run and is condensed into the final summary.

The UI shows it inline only while useful. A stale or terminal list never appears as running and never
blocks Chat archive or deletion.

## Subagents

Subagents are optional and normally unnecessary for ordinary single-chain work. The system prompt may
describe delegation as useful for independent or parallel work, such as simultaneous continuity
analysis and reference evaluation, but the host does not classify tasks or enforce that heuristic.
Commander decides whether to create one within structural depth, concurrency, and resource limits.

A child Run:

- Belongs to the same Project and Chat and has a concise public objective.
- Receives an explicitly selected context subset.
- Inherits equal-or-narrower Project scope, tools, permission, privacy, and budget.
- Uses the same Dispatcher, resource account, events, recovery, and output validation.
- Returns public facts, artifact references, and a summary to its parent; no private reasoning is
  exposed.
- Has an append-only public inbox and activation epoch so the parent or user can send bounded follow-up
  direction, resume it after restart, and preserve FIFO message identity without reconstructing private
  model state.

The user can expand a nested child row to see objective, public progress, results, usage, and blockers,
and can send feedback, pause, or stop it. No Subagent UI appears when no child exists. Depth and
concurrency are hard safety/resource limits, not a host-authored production topology.

## Typed Tool Program

Tool Program lets Commander express bounded data operations such as call, map, batch, filter, sort,
validate, and take over the frozen Lucid Fin Tool Catalog.

It is not arbitrary code. It has no shell, filesystem, dynamic imports, direct network, or hidden
state. Every child call still passes through the same schema, permission, budget, CAS, timeout,
idempotency, public projection, and persistence pipeline. The user sees one concise parent operation
with expandable child operations and aggregate usage.

## Permission and budget model

The model sees capabilities; the Dispatcher enforces authority.

Automatic within the accepted Project and visible budget:

- Read authoritative facts and cited Memory.
- Make reversible Project, Production, Canvas, Media-reference, and Delivery-draft changes.
- Use configured providers and generate the media explicitly requested.
- Create or update its TaskList and scoped Subagents.

Protected:

- Cross-Project read or mutation.
- Permanent deletion or privacy purge.
- External publish, send, or irreversible export.
- Credential, account, provider installation, or permission changes.
- Budget expansion.
- Any mutation that would change an explicitly user-protected Production field, selected result, or
  Delivery choice, discovered from current owning-domain state at Dispatcher preflight.

Permission modes may tune automatic reversible work and generation inside the current Project; they
never alter the catalog or creative behavior. Cross-Project access, permanent deletion/privacy purge,
external publish/send/irreversible export, credential/account changes, and budget expansion always
require exact confirmation or are denied. No `auto` or `danger` mode can globally waive them. A
confirmation applies to one immutable operation and never upgrades the whole Run.

If a cost cap exists, any paid operation without a finite safe upper bound is blocked before provider
submission. Without a cost cap, unknown cost may proceed only under the configured Project policy and
must display as unavailable, never `$0`. Reservations and settlement are idempotent per provider
attempt.

## User-visible execution

The Commander Dock shows one timeline. The current Assistant response may contain:

- A short public progress sentence.
- An optional inline TaskList.
- Optional nested Subagents only when they exist.
- Tool-purpose summaries and bounded resource usage in `Execution details`.
- Material questions or exact protected confirmations.
- Result cards linked to Media, Production, Canvas, or Delivery.
- Concise Project-change summaries with undo where supported.

The UI never shows raw tool arguments, provider payloads, secrets, stack traces, schema internals, or
chain-of-thought. `Execution details` explains what happened, what object changed, and what it cost; it
does not expose the model's private reasoning.

The Codex-style final summary is ordinary Assistant content backed by real objects and events:

1. Outcome and what was completed.
2. Created or changed Project objects with workspace links.
3. Generated results and their current user-choice state.
4. Validation performed and real limitations.
5. Anything still blocked or awaiting the user.
6. Resource usage when known.

There is no default activity modal, duplicate status card, global run dashboard, or permanent tool
catalog overlay. Run details are an inline disclosure; capability and Skill management live in
Settings.

## Recovery and retries

Public Run events are append-only and private recovery supplements are encrypted and schema-validated.
A recoverable Run resumes from its exact Manifest, Catalog, completed steps, deduplication seeds,
resource checkpoint, and provider receipts. It does not repeat the user Message, reinitialize budget,
or resubmit an unknown provider operation.

Retry is offered only when the exact accepted input and required private recovery seed can be
reconstructed. A retry creates a related Run with a visible manifest difference; it never mutates or
rewrites the failed Run.

## Current-to-target Harness replacement

The target Harness is specified from its contracts and receives a new target-only composition root.
The current symbols below are migration inventory, not a mandate to keep their interfaces, dependency
direction, state ownership, or implementation. A proven internal algorithm may be transplanted only
after target contract tests pass; otherwise the current implementation is replaced or deleted.

| Current seam                                                      | Target-only disposition                                                                                                                                                           |
| ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/agent/src/agent/agent-orchestrator.ts`                  | Replace current orchestration semantics with the target Agent Loop under Run Coordinator; no phase, prompt-injection, context-owner, or continuation behavior survives by default |
| `packages/agent/src/agent/tool-registry.ts`                       | Build the frozen Registry from the exact 40 target ToolDefinitions; no old ID, metadata owner, or live-visibility policy survives                                                 |
| `packages/agent/src/agent/tool-executor.ts`                       | Replace/converge at this seam into the single Dispatcher contract; delete every special execution and direct-service branch                                                       |
| `packages/agent/src/agent/tool-program.ts`                        | Transplant only the bounded typed AST/evaluator after every child call routes through the target Dispatcher                                                                       |
| `packages/agent/src/agent/subagent-tools.ts`                      | Reimplement target child Run commands through Run Coordinator, target events, Project scope, and shared resource/recovery contracts                                               |
| `packages/agent/src/agent/task-list-tool-policy.ts`               | Delete; target TaskList is optional progress and owns no authorization                                                                                                            |
| `packages/storage/src/prompt-store.ts`                            | Delete as a product/store authority; place the minimal fixed system prompt in the target Harness definition                                                                       |
| `apps/desktop-main/src/ipc/handlers/commander-context.service.ts` | Replace with target Context Builder over immutable Project Context Manifest, evidence, and authority retrieval                                                                    |

### Mechanisms eligible for contract-tested transplantation

- Provider stream parsing that emits the new Model Adapter protocol without old message/context state.
- Strict schema validation/canonicalization helpers with no old tool metadata or fallback behavior.
- Resource-account math, cancellation primitives, CAS/idempotency helpers, public/private event
  separation, and encrypted recovery codecs after target invariants and formats are verified.
- The bounded Tool Program expression evaluator, never its old registration/execution path.

Transplantation creates target-owned code and tests. It does not preserve an old composition root,
public interface, data schema, registry, IPC, handler, UI store, or runtime fallback.

### Remove or replace

- Replace Canvas-scoped Commander context with Project-scoped Context Manifests and retrieval.
- Replace `guide.get`, Process Prompt guides, guide auto-injection, and process/context tagging with
  immutable `skill.load` over the frozen Skill catalog.
- Delete `PromptStore`, `t_prompt_overrides`, Process Prompt storage/IPC/UI, prompt editing tools,
  Preset/Style/Template managers, and every Prompt/Guide/Tool Injection surface.
- Delete `ToolDefinition.process`/`contexts` visibility steering, phase bundles, adaptive capability
  eviction, and any TaskList-dependent tool hiding.
- Delete `TaskListToolPolicy`, fixed `task.*` production-stage tools, phase/dependency/approval gates,
  production graphs, TaskList continuation policy, and TaskList-based Chat lifecycle locks.
- Delete `runChecklist`, exit contracts that require a particular mutation commit, system scratchpad
  workflow instructions, and host-authored checklist enforcement.
- Delete action/tool-name risk guesses after every ToolDefinition declares canonical effects.
- Delete blanket transient retries. Each ToolDefinition must explicitly declare whether retry is safe;
  unknown provider submission state is never retried.
- Delete direct service bypasses once their operations use the single Dispatcher.
- Delete host-authored recovery, efficiency, replanning, or continuation prose injected as fake user or
  system messages; return structured facts instead.
- Remove model access to provider/account mutation while preserving configured-provider selection.

No compatibility layer exposes old resources to the new runtime. The cutover is one-time, verified,
and follows the separate data migration contract. The target Build must start with zero import or
runtime reference to the old Commander/Canvas/resource execution path.

## Acceptance scenarios

| Scenario                    | Required outcome                                                                 |
| --------------------------- | -------------------------------------------------------------------------------- |
| Simple factual request      | Commander answers without inventing a TaskList or Subagent                       |
| Small reversible edit       | One guarded tool call updates the exact object and reports the change            |
| Complex film brief          | Commander may create its own TaskList and adapt it without phase gates           |
| Independent analysis        | Commander may delegate scoped child Runs; user can inspect or stop them          |
| Reference-bound generation  | Request binds exact images, prompt, target revision, provider, and seed          |
| Valid candidate batch       | Every valid result appears; none is silently selected or discarded               |
| Explicit user selection     | Selection is recorded once and appears identically in Chat and Media             |
| Ambiguous subjective choice | Commander recommends or asks; it does not choose for the user                    |
| CAS conflict                | Stale write is rejected; Commander re-reads, adapts, or asks without overwriting |
| Tool unavailable mid-Run    | Catalog stays stable and Dispatcher returns a structured unavailable result      |
| Unknown provider submission | Run blocks safely and does not submit a duplicate request                        |
| Cost bound unavailable      | Capped Run blocks before spending; uncapped policy displays unknown cost         |
| Protected export            | Exact manifest and cost are confirmed before the irreversible operation          |
| User redirect while running | New Message is delivered at a safe boundary or queued with visible state         |
| Restart                     | Run resumes from exact evidence without duplicate tools, spend, or Messages      |
| Skill load                  | Exact Skill version is recorded and does not expand authority                    |
| Completion                  | Final summary links only real results, changes, validations, and blockers        |

## Implementation contracts after planning approval

The authoritative dependency order and stage gates are defined in
[`2026-08-15-project-first-implementation-program.md`](./2026-08-15-project-first-implementation-program.md).
The list below describes Runtime workstreams only; it does not authorize implementation or override
that program.

1. **Prompt and catalog cutover** — thin the system prompt; create immutable per-Run Tool/Skill
   catalogs; delete tool hiding and process-guide injection.
2. **Canonical Dispatcher** — route every operation through schema, permission, budget, CAS,
   idempotency, execution, output validation, projection, and persistence.
3. **Project video-production tools** — replace Canvas and legacy resource tools with Project, Production, Canvas,
   Media, Generation, Result/Choice, Evaluation, and Delivery authorities.
4. **Autonomous loop capabilities** — make TaskList, `skill.load`, Subagent, and Tool Program optional
   peers under the same Run.
5. **Commander Dock execution UX** — one inline progress/TaskList/Subagent/result/final-summary surface
   with no modal or duplicate console.
6. **Recovery and end-to-end verification** — exact restart, provider unknown state, CAS conflicts,
   budget boundaries, explicit choices, and Project delivery.

Each contract must define its own source scope, acceptance criteria, focused validation, testing policy,
and stop conditions before implementation. Contracts must be executed against the new Project data
model; no new feature should deepen the current Canvas/legacy resource architecture.

## Confirmed defaults

1. All tools in the accepted Product/Project catalog remain visible for the Run. Permission and
   temporary availability are execution-time structured results, not hidden capability changes. The
   complete content-addressed snapshot, not only its hash, is retained for recovery.
2. Direct UI choices are user-authored. A reversible choice performed by Commander in response to a
   Message remains a Commander action with that Message as causal evidence; the host never uses phrase
   classification or lets a tool claim `actor=user`.
3. Commander may select among already configured providers and models within Project policy and
   budget. Account connection, credentials, provider installation/removal, permission expansion, and
   budget expansion remain user-managed or protected.
4. TaskList, Skills, Subagents, and Tool Program are optional. None is required for every Run.
5. The target contains no Legacy Resources, no second runtime, and no unrestricted code or shell mode.
