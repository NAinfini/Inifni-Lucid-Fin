# Product

## Platform

Electron desktop application for Windows, macOS, and Linux.

## Users

Lucid Fin is for filmmakers, creative directors, and small production teams who want an AI production
partner to plan, generate, evaluate, organize, and deliver video material without turning the product
into a nonlinear editor.

The user remains the creative director. Commander performs durable work and presents evidence and
options; the user supplies intent, answers questions, approves protected operations, and chooses the
creative result.

## Product purpose

Lucid Fin turns a brief and reference media into an auditable Project containing production facts,
generated candidates, creative decisions, and an exportable delivery package. Professional editing,
mixing, effects, and finishing remain in dedicated editing software.

The product succeeds when a user can:

1. create a Project from a short brief;
2. direct Commander in one or more Project Chats;
3. see durable progress, questions, confirmations, and results inline;
4. compare and select generated media without losing alternatives or provenance;
5. correct or protect Project facts through typed operations; and
6. export an explicit, frozen delivery manifest and its local media.

## Canonical product model

### Project

Project is the top-level production boundary. It owns settings, Chats, production objects, Project
Media links, Canvas organization, decisions, history, memory, Runs, results, and delivery state.

Each Project exposes five views over the same facts:

- **Overview** — current status, recent results, blockers, and the next meaningful action.
- **Canvas** — spatial organization of production objects and linked media.
- **Media** — the Project library and candidate comparison surface.
- **Production** — the structured film model, including sequences, scenes, shots, and their relations.
- **Delivery** — selected results, validation, frozen manifests, review cuts, and exports.

Changing a fact in one workspace updates the same authoritative object everywhere. A workspace may
own transient interaction state, but never a parallel copy of product data.

### Commander, Chats, Runs, and Task Lists

Commander is the single AI interaction surface. It appears as a dock beside the current workspace and
may enter Focus mode without creating a second conversation or activity model.

- A **Chat** owns its transcript and accepts user messages and attachments.
- A root **Run** accepts one frozen capability catalog and Skill set, then owns durable execution.
- A **Task List** communicates real work state; it does not own approvals or product facts.
- Child Runs are private execution units whose results return to their parent through the runtime.
- Public Run events expose progress, questions, confirmations, results, and terminal summaries without
  exposing private reasoning.

Interrupted work resumes from durable boundaries. Ambiguous external work is never blindly repeated.

### Media and results

Global Media owns imported bytes and technical metadata. A Project links media by canonical reference
instead of duplicating the source. Generated Results retain their request, target, artifact, provider,
references, validation, assessments, and decision history.

The user can select, reject, refine, reference, protect, and undo a result through explicit typed
actions. These actions preserve the result and its evidence rather than deleting creative history.

### Delivery

Delivery uses an exact frozen manifest. Export requires an explicit user-selected destination and a
durable confirmation bound to the immutable input hash. A local review cut is derived output; it does
not replace the source results or frozen manifest.

Lucid Fin is not a professional editor. It does not expose a multitrack timeline, keyframes,
transitions, compositing, color grading, or final audio mixing as product authorities.

## Skills

The product provisions 287 checked-in built-in Skills as direct canonical records:

- 216 presets;
- 19 shot templates;
- 26 renderer Skills;
- 21 process prompts; and
- 5 prompt templates.

Skills guide the model within the same typed capability boundary; they do not grant filesystem,
network, credential, paid-service, or hidden tool authority.

When a user asks Commander to add a Skill, `skill.propose` creates an exact proposal. Registration
requires durable confirmation and becomes visible to the next root Run. The active Run's frozen Skill
set never changes underneath it.

## Runtime and trust boundaries

- The React renderer communicates only through the generated typed desktop API.
- Electron main owns storage, filesystem capabilities, Keychain access, model calls, media tools,
  export grants, and lifecycle.
- Storage uses Node's built-in `node:sqlite` and a fresh `lucid-fin-v1` profile.
- Keychain access is limited to the canonical recovery-key service and account; the application does
  not enumerate a person's credentials.
- Ollama is the sole configured model provider. It must use unauthenticated loopback HTTP and defaults
  to `qwen3:8b`; failure is explicit and never falls through to a cloud provider.
- FFmpeg and ffprobe provide local media inspection, derivation, review rendering, and export.
- Every persistent or destructive mutation is validated by the owning contract and authority.

## Product principles

1. **One fact, one owner.** Contracts, storage, runtime, renderer projections, and host capabilities
   have clear, non-overlapping authority.
2. **Creative control stays with the user.** Commander can propose and execute, but subjective choices
   and protected changes remain visible and reversible.
3. **Durability is product behavior.** Accepted inputs, work boundaries, evidence, confirmations, and
   results survive interruption without fabricated success.
4. **Source media stays intact.** Linking, selecting, trimming, comparing, and rendering are
   non-destructive.
5. **Internal machinery stays internal.** Ordinary users direct a production; they do not administer
   prompts, providers, tool graphs, or agent internals.
6. **Export for the next tool.** Lucid Fin hands off clear source media and manifests for professional
   finishing elsewhere.

## Confirmed terminology

- **Project** — the top-level video production.
- **Workspace** — Overview, Canvas, Media, Production, or Delivery view of one Project.
- **Commander** — the AI production partner and its single dock/focus surface.
- **Chat** — one Project conversation.
- **Run** — one durable accepted execution.
- **Task List** — visible durable work state within a Run.
- **Global Media** — imported source assets and metadata.
- **Project Media** — canonical links from a Project to Global Media.
- **Result** — generated candidate plus evidence, validation, and decision state.
- **Delivery manifest** — the frozen authoritative export input.
- **Review Cut** — optional local preview derived from a Delivery manifest.
- **Skill** — versioned reusable model guidance governed by the runtime catalog.

## Evidence and claims

Repository contracts, tests, generated artifacts, and the validation ledger are the evidence for
implemented behavior. No customer testimonial, adoption metric, quality benchmark, or external
provider capability may be claimed without corresponding verified evidence.
