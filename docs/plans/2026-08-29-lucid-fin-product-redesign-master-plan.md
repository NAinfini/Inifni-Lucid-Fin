# Lucid Fin product redesign master plan

## Status

Planning only. This plan does not authorize source implementation, schema changes, commits, pushes,
releases, paid provider calls, or access to prior application data. The user will explicitly approve
implementation after the product model and capability disposition are final.

This plan supersedes the product assumptions in the completed 2026-08-28 development cutover. That
cutover remains historical engineering evidence, but its five-workspace navigation, one-Canvas
constraint, Ollama-only runtime, and all-287-items-as-Skills classification are not target behavior.

The repository currently contains uncommitted exploratory implementation started before the user
clarified that planning must continue. Those changes are not approved product work and must be
reviewed against this plan before they are kept, rewritten, or discarded.

## Product outcome

Lucid Fin is a project-based desktop AI film-production workspace. It should feel as direct as a
project/chat coding assistant: the user opens a Project, starts one or more Chats, describes the film
or production task in ordinary language, and lets the AI operate the application's production tools.

The target outcome is the shortest reliable path from intent to a reviewable cut while preserving:

- creative control and undo;
- character, location, style, and world continuity;
- exact generation provenance and assessment evidence;
- cost visibility and hard budget ceilings;
- durable parallel execution and restart recovery; and
- reusable version-pinned Assets across Projects.

The product does not promise a fixed number of videos per day. It measures time to first review cut,
manual interventions, useful candidates per attempt, focused-regeneration efficiency, provider cost,
and parallel utilization.

## Decisions already fixed

1. A **Project** is a user-defined workspace. It can hold one clip, one film, multiple episodes, or
   any scope the user chooses. There is no mandatory Series, Service, Film, or Episode level above or
   below Project.
2. A Project owns multiple durable **Chats** and one or more named **Canvases**.
3. A Chat owns conversation and execution history. It never owns film facts, Assets, Canvas layout,
   or editorial order.
4. A Canvas is a semantic production map and intervention surface. It is not a provider-node or
   model-pipeline editor.
5. Canvas nodes represent stable creative intentions such as Story, Scene, Shot, Character, or
   Location. A generated file or provider attempt is not its own node.
6. One semantic node contains multiple image, video, audio, or assessment candidates. Candidates are
   derived from existing generation results, assessments, and decisions; there is no second
   CandidateSet database.
7. **Sequence** is the only editable order authority. Canvas x/y position, semantic relations, and
   Delivery cannot independently reorder the film.
8. **Global Assets** separately manages reusable media, Characters, Locations, Worlds, Styles, Props,
   Wardrobe, and other continuity material across Projects.
9. Cross-Project reuse pins immutable Asset revisions. Publishing a new global revision never
   silently changes an existing Project.
10. **Settings** is global and owns provider connections, credentials, profiles, model roles, Skills,
    Creative Catalogs, storage/privacy, execution defaults, budgets, and usage.
11. Skills are reusable procedures. Camera values, shot vocabulary, styles, presets, and templates
    are typed Catalog or Shot Recipe data rather than hundreds of individual Skills.
12. AI may propose a Skill, Catalog record, or Shot Recipe when the user asks. Exact durable
    confirmation is required, and the new version becomes available only to a later root Run.
13. The desktop uses the real Lucid Fin logo, a custom frameless title bar, one global Settings entry,
    one Project overflow menu, visible hover/focus states, safe text insets, and accessible custom
    scroll affordances.

## Information architecture

### Global shell

The left global rail contains only:

- **Projects** — active and archived Project discovery;
- **Assets** — cross-Project reusable library; and
- **Settings** — providers, policies, Skills/Catalogs, storage, privacy, and usage.

The title bar contains the real logo, active context, drag region, and custom minimize/maximize/close
controls. Interactive controls must not be inside the drag region.

### Project shell

The Project sidebar contains:

- Project title and one overflow menu: Rename, Project settings, Archive;
- **Chats** — create, select, rename, archive, restore, and display live Run state;
- **Canvases** — create, select, rename, archive, and restore; and
- a compact Project usage/budget status.

There are no separate top-level Project pages named Overview, Production, Library, Media, and
Delivery. Their useful behavior is placed in Chat, Canvas, Inspector, Sequence, Assets, or Settings.

### Main work surfaces

The main area has two first-class modes:

- **Chat focus** — the default direct instruction experience, with messages, live activity, approval
  requests, artifacts, costs, and a composer;
- **Canvas focus** — semantic graph, right Inspector/Commander, and bottom Sequence Lane.

Opening a history item, Project change, candidate comparison, Inspector, or Settings never traps the
user. Every contextual surface has a close/back action, `Esc` behavior, and focus return.

## Canonical user journey

```text
Intent
  -> Project + first Chat
  -> Story / style / world plan
  -> Character + Location continuity assets
  -> Scene + Shot graph
  -> Image candidates + assessment + selection
  -> Video/audio candidates + assessment + selection
  -> Sequence assembly
  -> Review cut
  -> Explicit local export / NLE interchange
```

### Project creation

The form has one description input. There is no redundant optional name field. The complete text is
the first Chat instruction. The Project title is derived deterministically from the first meaningful
line, shortened to a safe display length, and remains editable. Using an arbitrarily long full prompt
as the literal sidebar title is rejected because it makes Project navigation unreadable.

### Planning and production

The Commander creates or updates typed Production facts and uses child Runs for independent work.
For example, story expansion, Character design, and Location design may run concurrently. All Chats
write through the same authorities with revision/content-hash checks; there is no per-Chat shadow
copy of a Character, Scene, or Shot.

### Candidate handling

Each target and generation slot can have many results. A Shot Inspector groups them by purpose such
as storyboard image, first frame, final frame, shot video, dialogue, music, or sound effect. It shows:

- provider, model, seed, parameters, references, receipt, and cost;
- technical validation and visual/continuity assessments;
- AI score, reason, confidence, and limitations;
- current selected and approved decisions;
- compare, select, approve, reject, refine, regenerate, undo, and promote/fork actions.

AI selection is a durable, explainable, supersedable decision. A result becomes a new semantic node
only when the user explicitly forks or promotes it into a separate creative intention.

### Sequence and review cut

The bottom Sequence Lane is the only place that changes Scene, Shot, and Clip order. It also owns
basic clip duration, trim, transition, and audio preference. Canvas selection and Sequence selection
cross-highlight the same Production object without duplicating it.

Review cut generation freezes an exact Sequence revision and exact selected results. Later changes
mark the old manifest stale but never mutate it. Lucid Fin provides basic assembly and common NLE
interchange; it does not attempt to replace a professional nonlinear editor, compositing suite,
color suite, or DAW.

## Authority model

| Fact                                  | Single authority                            | Important prohibition              |
| ------------------------------------- | ------------------------------------------- | ---------------------------------- |
| Workspace identity and defaults       | Project / ProjectSettings                   | No editorial order or secrets      |
| Conversation and execution            | Chat, Message, Run, Task List               | No film-data ownership             |
| Story and production facts            | Typed ProductionObject + semantic relations | No spatial or editorial order      |
| Spatial layout and annotations        | CanvasDocument                              | No candidate or sequence ownership |
| Scene/Shot/Clip order and edit values | SequenceDocument                            | No inference from Canvas geometry  |
| Provider attempts and artifacts       | GenerationRequest/Attempt/GeneratedResult   | No duplicate creative node         |
| Assessment and selection              | Assessment/UserChoice/ResultDecision        | No silent replacement              |
| Reusable continuity material          | Versioned Global Assets                     | No floating latest reference       |
| Project reuse                         | ProjectAssetBinding                         | Must pin exact Asset revision      |
| Provider authentication               | ProviderConnection + OS Keychain            | Renderer never receives secret     |
| Model/capability configuration        | ProviderProfile + role binding              | No silent provider fallback        |
| Export input                          | Frozen DeliveryManifest from Sequence       | No independent reorder list        |

Detailed invariants remain in
[`../architecture/target-authorities.md`](../architecture/target-authorities.md).

## Global Assets and continuity

Global Assets has typed categories for Media, Character, Location, World, Style, Prop, Wardrobe, and
Collection. Collections are organizational views and never duplicate bytes or entity ownership.

Structured entities require rich typed facts rather than a generic title/description/traits blob.
The initial target fields are:

- **Character:** identity, role, age presentation, body, face, hair, wardrobe, colors, voice,
  personality, movement, continuity rules, negative constraints, and multi-angle reference media;
- **Location:** identity, geography, architecture, layout, materials, weather/time variants, lighting,
  atmosphere, continuity anchors, negative constraints, and reference media;
- **World:** era, technology, culture, physical rules, visual rules, recurring motifs, forbidden
  contradictions, and linked Characters/Locations/Styles;
- **Style:** visual language, palette, rendering medium, line/texture, lighting, camera language,
  motion language, exclusions, and reference media;
- **Prop/Wardrobe:** ownership, appearance, state variants, scale/material, continuity rules, and
  references.

Generated results remain Project candidates until explicitly promoted. Promoting creates a stable
Asset identity and immutable first revision. Editing publishes another revision. Existing Project
bindings remain pinned until explicitly upgraded or forked.

## Provider and model plan

### Boundary

- `ProviderConnection` owns provider kind, endpoint, auth strategy, Keychain handle, OAuth state,
  health, and last verified time.
- `ProviderProfile` owns one model/capability, default parameters, context/output limits, quote or
  pricing support, and readiness.
- Projects bind roles: Commander LLM, Image, Video, Vision/Evaluation, Speech, Music/SFX, and
  Transcription.
- A Run freezes exact allowed Profiles and never follows later Settings changes.

### Initial integration order

This is a reversible implementation ordering, not a permanent product restriction:

1. OpenAI Responses for tool-calling Commander, GPT Image for stills, and Sora for video;
2. Google Gemini for Commander/vision/image and Veo for video;
3. Runway for an additional production-video path;
4. local Ollama only when the selected model proves canonical tool calling, not merely text output;
5. additional historical adapters only after individual API, quote, receipt, cancellation, and
   packaged smoke review.

The old broad provider catalog is an audit source, not a promise that every historical adapter is
ready. A provider is visible as available only when its connection, profile, capability, and health
are real. Unknown cost is shown as unknown and blocks unattended paid execution.

## Execution authorization

Automation is a frozen `RunExecutionPolicy`, not `auto: boolean`.

| Preset             | Paid operations                         | Candidate choice                       | Automatic continuation                         |
| ------------------ | --------------------------------------- | -------------------------------------- | ---------------------------------------------- |
| Review every spend | Confirm each quoted operation           | Manual by default                      | Only after approvals                           |
| Approve for me     | Automatic inside Run grant and hard cap | Assessed auto-select                   | Pause on low confidence or policy gate         |
| Full auto          | Automatic inside hard cap               | Assessed auto-select and focused retry | Continue to review cut when dependencies allow |

All presets expose current spend, remaining budget, next estimated cost, attempt ceilings, and
parallel-operation limits. No preset bypasses credentials, hard budget, destructive delete,
overwrite, upload/external sharing, or an ungranted export destination.

“Skip stages” means auto-approve or visually collapse intermediate decisions. It never skips story,
asset, generation, evaluation, persistence, or dependency work required for a valid downstream
result.

## Skills, Catalogs, and Recipes

The historical 287-source inventory is reclassified exactly once:

- 216 presets -> typed Creative Catalog records;
- 19 shot templates -> Shot Recipes;
- 26 renderer Skills -> retain only genuine procedural methods after deduplication;
- 21 process prompts -> typed tool instructions or a small set of domain Skills;
- 5 prompt templates -> runtime/Skill resources.

Every source must map to one target record or an explicitly documented deduplication group. Useful
content cannot disappear. The target does not preserve 287 as a Skill-count invariant.

## UX quality contract

- custom frameless desktop border and working window controls;
- real `asset/Logo.png`;
- one global Settings entry and one Project overflow menu;
- archived Projects, Chats, and Canvases are searchable and restorable;
- visible hover, selected, pressed, focus-visible, disabled, loading, error, offline, budget, and
  approval states;
- no raw event JSON or naked internal IDs in user-facing history;
- no default browser/OS scrollbars, while wheel, touchpad, keyboard, drag thumb, and high-contrast
  scroll affordances remain functional;
- at least 12px text-to-border inset and no clipped action labels;
- responsive behavior at 1024x720, 1280x720, 1440x900, and 1920x1080;
- keyboard exits and focus return for menus, drawers, comparisons, Inspectors, and Settings;
- no dead buttons or fake provider success.

The implementation reference is
[`../design/2026-08-28-canvas-first-desktop-redesign.md`](../design/2026-08-28-canvas-first-desktop-redesign.md).

## Capability disposition rule

Historical code is not restored wholesale. Each capability is classified as:

- **retain as-is** — current durable authority is correct;
- **selectively port** — useful old behavior is adapted to current canonical contracts;
- **redesign** — product value is valid but old ownership/UX is wrong;
- **delete** — duplicated, misleading, obsolete, or contrary to the target model.

The evidence matrix is maintained in
[`2026-08-29-current-vs-historical-capability-matrix.md`](2026-08-29-current-vs-historical-capability-matrix.md)
so file-level archaeology does not obscure this product contract.

## Implementation gates after approval

Implementation must use one final architecture with independently verifiable gates. Completion of a
gate does not mean the overall product is finished.

### Gate 0 — clean planning cutover

- approve this plan and capability matrix;
- decide the disposition of current uncommitted exploratory source changes;
- make live docs point to the new goal and archive superseded execution guidance.

### Gate 1 — canonical data and order

- fresh schema only; no migration or compatibility path;
- typed Production facts, multiple Canvases, Sequence authority, generation slots, candidate
  projection, rich versioned Global Assets;
- remove `contains.ordinal`, Delivery reorder, and every replaced implementation;
- prove Canvas and Sequence hashes are independent.

### Gate 2 — providers, credentials, and Run policy

- ProviderConnection/Profile authority, Keychain/OAuth, redacted Settings API, role bindings;
- three Run policies, quote visibility, hard budget, confidence and attempt ceilings;
- packaged keychain/provider failure smoke.

### Gate 3 — autonomous production

- canonical tool-calling Commander;
- generation, assessment, selection, focused retry, child-Run parallelism, and Sequence population;
- deterministic fake-provider journey from intent to sequence-ready;
- opt-in live checks only with explicit user credentials and paid-call approval.

### Gate 4 — desktop experience

- replace the old five-workspace shell with Projects/Assets/Settings and Project Chats/Canvases;
- implement Chat focus, Canvas focus, candidate Inspector, Sequence Lane, archives, and real Settings;
- Electron click-through, responsive, visual, keyboard, and accessibility validation.

### Gate 5 — review cut and export

- Sequence-derived immutable Delivery manifests;
- review cut, exact local destination grants, MP4 H.264/AAC baseline, and FCPXML/EDL interchange;
- deterministic render, restart, cancellation, stale-manifest, and no-overwrite tests.

### Gate 6 — performance, KPI, documentation, and packaging

- large Canvas/candidate virtualization and provider backpressure;
- event-derived time-to-first-review-cut, interventions, attempt efficiency, cost, and parallelism;
- full unit/integration/Electron/package validation;
- final cross-PC runbook, goal record, verification evidence, and release decision.

## Required validation

The implementation is not complete until all relevant checks pass and evidence is recorded:

```powershell
pnpm run lint
pnpm run lint:contracts
pnpm run format:check
pnpm run test:types
pnpm test
pnpm run check:production-closure
pnpm run build
pnpm run test:e2e
pnpm run test:electron-smoke
pnpm run dist
```

Required behavior suites include sequence authority, candidate projection, Project/Chat/Canvas,
cross-Project Asset version pinning, provider settings/adapters, Run authorization/autonomy,
intent-to-review-cut, desktop usability, packaged keychain, and restart recovery.

## Stop conditions during implementation

Implementation must stop for user input only when:

- a decision materially changes the product boundary, cost, or external-service commitment;
- real credentials or paid provider authorization are required;
- deletion would affect real user data rather than disposable development state;
- upload, external sharing, production infrastructure, commit/push/release, or history rewriting is
  required without current explicit authorization; or
- the same evidenced root-cause repair fails three times.

Ordinary reversible technical details use the narrowest safe assumption and continue without asking.
