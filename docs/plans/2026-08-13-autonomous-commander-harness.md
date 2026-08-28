# Autonomous Commander Harness

## Product contract

Commander is a capable model operating inside Lucid Fin's typed media-production playground. The host provides facts, tools, permissions, budgets, CAS and durable state; it does not prescribe the model's creative method or infer intent from hard-coded phrases.

Every autonomous execution unit is represented by the existing Commander Run model. This includes the root agent, model-directed subagents and typed Tool Programs. The implementation must not create a second agent-state database, a second event bus or a second monitoring UI.

The user must be able to inspect and manage autonomous work. Public UI may show objectives, public plans, progress summaries, current steps, tool calls, redacted arguments, normalized results, artifacts, blockers, elapsed time, token usage and available cost data. It must never expose private chain-of-thought, credentials, authorization headers or unreviewed provider payloads.

## Implementation status

| Phase                                      | Current worktree                                   |
| ------------------------------------------ | -------------------------------------------------- |
| Replay and safety baseline                 | Implemented and covered by focused regressions     |
| Thin prompts and model autonomy            | Implemented                                        |
| Stable Run capability catalog              | Implemented                                        |
| Unified dispatcher and public projections  | Implemented                                        |
| Event-sourced context and resource budgets | Implemented                                        |
| User Control Plane                         | Implemented                                        |
| Typed Tool Program mode                    | Implemented                                        |
| Model-directed subagents                   | Implemented and covered by integration regressions |

## Invariants

- SQLite domain records, CAS content and append-only Commander events are authoritative facts.
- Compaction creates a model view; it never rewrites or deletes source events.
- A Run receives one frozen, user-visible capability catalog derived from its authorized runtime registry.
- TaskList phase, Canvas scope, permission, cost, confirmation, CAS and idempotency checks run at execution time. They do not silently hide tools from the model.
- Every tool invocation follows one pipeline: model choice -> schema validation -> scope and policy guards -> cost and confirmation guards -> execution -> normalized public result -> durable event.
- Prompt Assembly remains the only persisted provider prompt, with exact source hashes and lineage.
- Provider preflight remains host-owned and fail-closed.
- Destructive, credential and cross-Canvas mutations remain explicit user decisions.
- Root chat contains root-agent conversation only. Child-run events remain isolated and are opened through the control plane.

## Delivery phases

### Replay and safety baseline

Record behavioral fixtures for approvals, TaskLists, Prompt Assembly, Canvas authorization, cost controls, recovery, compaction and tool execution before changing orchestration.

Acceptance:

- Existing safety boundaries have focused regression coverage.
- Replay produces the same public state from the same persisted events.

### Thin prompts and model autonomy

Keep the system prompt to identity, factual-data rules, permission and cost boundaries, and tool discovery. Move production methods to discoverable domain guides or typed tool results. Remove hard-coded phrase classifiers, forced response tables, dormant prompt injectors and duplicated workflow prose.

Acceptance:

- No local phrase table decides whether feedback means approve, revise, ask or continue.
- Model decisions use typed tools; the host validates durable state and exact approval identity.
- Built-in guides are discoverable on demand and are not silently auto-injected.

### Stable Run capability catalog

Freeze the complete authorized tool directory at Run start, persist it as a public event and expose it in Commander. Keep provider-visible tools stable throughout the Run. Consolidate runtime schema, metadata and execution into one canonical ToolDefinition source.

Acceptance:

- Phase changes, `tool.get`, compaction and long runs do not alter provider-visible tool names or schemas.
- User and model see the same catalog.
- Denied tools remain visible and return structured execution-time denials.
- No parallel static ToolCatalog remains.

### Unified dispatcher and public projections

Route every domain-tool invocation through one dispatcher. Give each ToolDefinition explicit public argument, result and artifact projection rules. Persist only redacted public events; retain private execution data only for the duration required to perform the call.

Acceptance:

- Secret sentinels, API keys, headers, raw provider bodies and private reasoning never reach SQLite, IPC or the DOM.
- Tool calls and results remain useful through normalized summaries and artifact references.
- Model and tool resource usage is recorded by stable operation identifier without double counting.
- All callers, including UI, orchestration, Tool Programs and subagents, use the same dispatcher.

### Event-sourced context and resource budgets

Build model context from immutable events and authoritative domain projections. Replace the fixed step ceiling with explicit time, token, cost and tool-call budgets plus cancellation and safe pause boundaries.

The persisted model context is a public semantic projection, not a provider transcript. It contains user inputs and bounded references to authoritative Canvas, TaskList, Prompt Assembly and CAS records. Raw tool arguments and results, provider continuation metadata, thought signatures and private reasoning remain process-local. In-process pause and resume may continue the same Run; after a process crash, the interrupted Run is closed as recovery-required and a related retry Run rebuilds its context from public facts and current authoritative state. The host must never claim that a lost provider continuation was restored exactly.

Acceptance:

- Compaction only replaces the transient model projection.
- Restart can reconstruct public state and the next valid model view.
- Cache hits, suffix replay and cold replay produce the same public semantic model view.
- A cache never contains authoritative object bodies or private provider data; every referenced authority is reread before use.
- Budget exhaustion produces a durable, user-visible blocked or paused state rather than an arbitrary loop failure.
- Users can inspect remaining or unavailable budget facts.

### User Control Plane

Extend Commander Runs into a parent-child execution tree. Reuse the existing timeline and hydration path. Add public progress and resource events, then provide a compact Agent Activity panel suitable for the default narrow Commander.

User capabilities:

- Browse the root, subagent and Tool Program tree.
- Open any execution unit's objective, public plan, current work, tools, results, artifacts, blocker, elapsed time, tokens and cost.
- Send a message to a selected unit.
- Send a message, pause, resume or cancel as permitted by state; parent pause/cancel applies to active
  descendants, while messages target one selected unit.
- Retry a reconstructible root Run as a related Run. Subagents and Tool Programs deliberately have no
  generic Retry action because their private instruction/program payload is not persisted; the model or
  user starts fresh delegated work with new input instead of pretending to replay lost private state.

Acceptance:

- User control and model control use the same dispatcher and guards.
- Pause stops scheduling new work after the current non-interruptible call reaches a safe boundary.
- A permitted root retry creates a related new Run; it never mutates the old history.
- Unknown cost is displayed as unavailable, not zero.
- No private chain-of-thought is persisted or rendered.

### Typed Tool Program mode

Allow the model to write a short program against a restricted Lucid Fin SDK for media queries, validation, ordering, batching and bounded parallel analysis. Do not expose an operating-system shell or arbitrary network access.

Acceptance:

- The program can only call catalog tools within inherited Run scope and budget.
- Every child call passes through the same dispatcher and produces the same public events.
- Runtime, loop, concurrency and output limits are explicit and user-visible.
- Cancellation and pause propagate to pending program calls.

### Model-directed subagents

Expose the stable model tools `agent.spawn`, `agent.wait` and `agent.result`. The model decides when
delegation is useful, supplies the child name, objective and private instruction, and receives only
bounded public results. The existing Run tree/control APIs give the user list, inspect, message,
pause, resume and cancel actions; the host enforces inherited scope, budget and permission subsets.

Acceptance:

- Subagents cannot widen Canvas, tool, credential, permission or cost authority.
- All descendants share the root token, tool-call and cost account; a child lease may only narrow its
  subtree budget, while wall-time and pause clocks remain independent per Run.
- Parent and child public histories are isolated and replayable.
- Users can enter every child record and control the subtree.
- Concurrent Canvas mutations are serialized by target and protected by CAS.
- Private child instructions are process-local and never enter SQLite, IPC, logs or the DOM; only the
  public objective, progress, normalized results, artifacts and authority references are durable.
- External clients cannot forge a subagent or Tool Program start; child creation is an internal,
  parent-scoped operation.
- The durable session TaskList appears inside the root Run's existing Activity Control only while the
  Run tree and TaskList are active. Host-authored labels localize; model-authored labels remain exact.

## Prompt and guide cleanup rules

Keep:

- Typed evaluator prompts with strict output schemas.
- Provider invocation requirements and preflight limits.
- Prompt Assembly sources, hashes and lineage.
- Domain creative references that are explicitly requested or discovered.

Merge or remove:

- Repeated TaskList, approval, recovery and production-order prose already enforced by host state.
- Dormant process-prompt injection specifications and serializer support.
- Duplicate guide registries and references to missing guide files.
- Runtime recovery messages that prescribe a particular model action; return structured facts instead.
- Contextual tool hiding, schema eviction and tool-discovery activation state.

Any prompt sanitizer that is not wired into a real boundary must either be connected with tests or removed; its mere presence is not a safety guarantee.

## Validation strategy

Each phase must pass focused behavior tests before the next phase is enabled. Cross-cutting final validation includes:

- Contracts and parser exhaustiveness.
- Storage integrity, event ordering and restart reconstruction.
- Agent tool parity, guard denial and privacy sentinel tests.
- Desktop-main persistence-before-broadcast tests.
- Renderer hydration, accessibility, localization and secret-absence tests.
- Package builds, generated IPC drift checks and scoped diff checks.

A phase stops after one evidence-driven repair if the same focused validation remains red. Later features must not be enabled by fallback or hidden compatibility paths.

Current integration evidence: 35 focused files / 441 tests, all eight affected package builds, and
generated preload validation pass. UI detector and privacy/phrase scans report no findings in the
changed control surface and agent runtime.

## Reference direction

The design borrows the useful separation demonstrated by DeepSeek Harness: a thin agent loop, stable tools, a unified guarded tool pipeline, append-only compaction inputs, typed multi-step programs and model-directed delegation. Lucid Fin keeps its own stronger media-specific authorities: Canvas scope, TaskList durability, Prompt Assembly provenance, CAS, approvals and cost controls.

Reference: [DeepSeek Harness compaction](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/docs/subsystems/compaction.md)
