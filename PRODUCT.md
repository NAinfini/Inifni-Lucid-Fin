# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Lucid Fin is for filmmakers, creative directors, and small production teams who want AI to help
plan, generate, evaluate, organize, and deliver video material without turning the application into
a professional nonlinear editor.

The user remains the creative director. AI proposes options, performs durable work, and reports
results; the user decides the direction, approves important creative facts, and chooses the material
that will be delivered.

## Product Purpose

Lucid Fin is an AI-native video production workspace. It turns a creative brief into an auditable
production plan, consistent generated media, an ordered shot package, and an optional review video.

Success means that a user can move from an idea to a clearly ordered, production-ready collection of
source files and then continue professional editing in Premiere Pro, DaVinci Resolve, Final Cut Pro,
CapCut, or another dedicated editor.

Lucid Fin is not a full video editor. It does not need a professional multitrack timeline, keyframes,
transitions, effects, color grading, or final audio mixing.

## Positioning

Lucid Fin applies a Codex-style project and chat workflow to video creation:

- one Canvas is one video project and one chat group;
- a Canvas can contain multiple independent Commander chats;
- each chat owns its transcript, runs, and Task Lists;
- the global Media library owns source files;
- Canvas nodes reference and organize Media for the project;
- an ordered delivery sequence determines which selected video belongs to each shot and in what
  order it should be handed off.

The product's differentiated work is creative direction, durable AI execution, media generation and
evaluation, continuity, organization, and ordered delivery. Professional editing remains in the
user's editing software.

## Operating Context

### Workspace model

- The application contains a global Media library and any number of Canvases.
- A Canvas is the project boundary, not a folder inside another project hierarchy.
- The left sidebar is the sole chat manager. It shows an Unassigned section first, followed by one
  folder-like group per Canvas.
- Users can create multiple chats under a Canvas. A globally created chat is Unassigned until the
  user assigns it.
- Canvas rows provide project settings and a new-chat action.
- A chat has one default Canvas. Access to another Canvas is explicit and does not silently change
  the default Canvas.
- A Canvas added as context applies only to the accepted Run started by that message. Reading that
  Canvas is allowed for the Run; each attempted write outside the default Canvas requires its own
  confirmation and never upgrades the Run to blanket write access.
- A chat may be moved to another Canvas only when it has no active run and no unfinished Task List.
  Moving it changes future default context; historical runs, artifacts, and audit records keep their
  original ownership.

### Creative and production flow

1. The user starts an Unassigned chat or a chat under a Canvas.
2. Commander decides whether the request benefits from a question, alternatives, a plan,
   delegation, or direct action. Structured options and free-text answers are available when useful;
   the host does not prescribe an option count or infer intent from fixed phrases.
3. Commander creates a durable production plan and treats ordinary chat as model input. The model
   expresses approve-or-revise decisions through a typed tool, while the host applies that decision
   only to the exact pending revision bound to the authentic user message.
4. The user locks the visual direction through the visible approval workflow.
5. Commander and the user create shot specifications, entities, references, images, videos, text,
   and audio. Generated files enter global Media and are linked to the Canvas.
6. The user selects the preferred video for each shot and arranges the ordered delivery sequence.
7. The user may set a non-destructive trim-in, trim-out, and embedded-audio preference for each
   selected video.
8. The approved batch package is exported with order-prefixed filenames and machine- and
   human-readable manifests.
9. Lucid Fin may also create a lightweight Review Cut by trimming and hard-joining the ordered
   videos. This is a derived preview, never the authoritative deliverable.
10. The user imports the ordered source package into professional editing software for final editing,
    mixing, subtitles, effects, and finishing.

## Capabilities and Constraints

### Authoritative product objects

- **Media content** owns immutable image, video, audio, and document bytes and technical metadata.
- **Media entries and folders** organize those global contents without duplicating the bytes.
- **Canvas** owns project settings, linked-media references, its node graph, notes, and its ordered
  delivery sequence.
- **Commander session** owns one transcript and the runs initiated from it.
- **Run** owns one accepted execution and its event stream.
- **Task List** owns durable work state, attempts, decisions, artifacts, recovery, and approvals for
  one Commander session.
- **Ordered delivery sequence** owns shot order, selected video identity, trim-in, trim-out, and the
  embedded-audio preference used by the Review Cut.
- **Batch export manifest** is the authoritative handoff record.
- **Review Cut** is reproducible derived output and can always be regenerated from the approved
  sequence and source Media.

### Delivery boundary

The authoritative output is an ordered batch of original source media. Video filenames include a
zero-padded order prefix and stable shot identity. The package includes a readable manifest and a
machine-readable manifest containing hashes, provenance, selection, trim, and audio preferences.
The first delivery contract is intentionally video-only. Audio and text remain global source Media
and may gain dedicated handoff manifests later without changing the authoritative video sequence.

The optional Review Cut may:

- trim the start and end of each selected video;
- enable or disable that video's embedded audio;
- normalize basic output compatibility;
- hard-cut the videos in approved order;
- show progress and support cancellation.

The Review Cut does not add transitions, multitrack audio, subtitle timing, effects, speed changes,
keyframes, overlays, or professional finishing controls.

### Safety and durability

- Provider submission, Task List state, approvals, and resulting artifacts are durable and
  recoverable.
- Prompt Assembly is the single provider-facing prompt authority for generated media.
- Restarts must not blindly resubmit ambiguous provider work.
- A chat with an active run or unfinished Task List cannot be moved or deleted.
- Loading a historical chat is atomic: failure to hydrate it leaves the current chat unchanged.
- Deleting a chat never deletes global Media.
- Deleting a Canvas first archives it. Permanent deletion is a separate confirmed action that is
  blocked while related work is active, moves its chats to Unassigned, and preserves global Media.
- Referenced Media cannot be silently destroyed.
- Logs are diagnostic information; Commander events and Task events are the durable business record.
- SQLite has one canonical schema. A fresh database is created directly from it, and an existing
  database with structural drift is rejected before bootstrap writes rather than silently migrated.

## Product Principles

1. **Direct the AI; do not rebuild an NLE.** Spend product complexity on creative decisions,
   generation, continuity, evaluation, and recovery rather than professional editing controls.
2. **One fact, one owner.** Media, Canvas, Session, Run, Task List, and delivery state each have one
   authoritative owner and no shadow workflow.
3. **Source media stays intact.** Selection, ordering, trimming, and review rendering are
   non-destructive.
4. **Important work is visible and durable.** The user can see what Commander is doing, interrupt it,
   resume safely, and audit the result.
5. **Export for the next tool.** The primary handoff is a predictable, well-named source package that
   professional editors can import immediately.

## Confirmed Terminology

- **Media**: the global source library.
- **Linked Media**: Media referenced by one Canvas.
- **Canvas**: one video project and one chat group.
- **Commander chat**: one independent AI working session.
- **Task List**: durable execution state owned by one Commander chat.
- **Ordered delivery sequence**: the selected shots in export order.
- **Batch package**: the authoritative ordered source delivery.
- **Review Cut**: the optional merged preview derived from the batch manifest.

## Confirmed Product Decisions

- Cross-Canvas read access is explicit and lasts for one accepted Run. Every write outside the
  chat's default Canvas requires a separate confirmation for that tool call.
- Canvas deletion is archive-first. Permanent deletion unassigns its chats and preserves global
  Media.
- Each Canvas owns exactly one canonical ordered delivery sequence.
- The first batch-delivery contract is video-only. Dedicated audio and text handoff formats are later
  leaves, not parallel delivery models.
- Video Clone is skipped from the supported product path and should not receive further feature work.
- Semantic search is removed from the supported product path; filename, folder, tags, and ordinary
  filtering remain the Media-library retrieval model.
- Ken Burns, proxy generation, auxiliary stitching, subtitle burn-in, and the read-only API server
  are not supported product capabilities. The retained media-engine boundary is FFmpeg probing,
  evaluation support, and the narrow Review Cut path.
- Commander tuning, Guides and Skills, and Process Prompts remain available as Advanced settings;
  they are not default navigation for ordinary production work.
- Canvas document portability is deferred. The Delivery package remains the supported portable
  production handoff.
- Provider pruning is deferred until the initial explicitly supported provider list is approved.

## Evidence on Hand

- The current Electron/React/SQLite application and its feature surfaces are the incumbent product
  evidence.
- `docs/PRODUCT_TREE.md` records the current feature inventory, alignment assessment, and drift from
  this product root.
- No customer testimonials, production benchmarks, or adoption claims have been established and
  future work must not fabricate them.
