# Commander-owned Prompt Assembly

Image and video providers receive one persisted prompt authored by Commander. The host no longer concatenates user text, presets, templates, style rules, or Task List instructions onto that prompt.

## Data flow

1. The host prepares an immutable `PromptAssemblyInputV1` before any media-provider call.
2. The input contains separately identified and hashed sources: user intent, node and connected text, active preset instructions and effective parameters, shot templates, entity/style facts, Task List guidance, approved Production Plan and Visual Constitution documents, and parent prompt/repair lineage when applicable.
3. Commander reconciles those sources into one `PromptAssemblyOutputV1`, including `finalPrompt`, optional `negativePrompt`, and exactly one decision for every source.
4. The host validates the assembly ID, input hash, source IDs/hashes, required-source decisions, prompt limits, provider capabilities, references, resolution, budget, retry bounds, and Plan Approval revisions.
5. The validated prompt is persisted before submission and sent to the media provider byte-for-byte. The same strings are recorded in asset metadata and generation history.

Presets and shot templates remain reusable creative controls. They are inputs to Commander, not host-owned suffixes.

## Manual Canvas generation

- An active Commander turn calls `canvas.generation` with `action: 'prepare'`, reconciles the returned input in the same outer tool loop, then calls `action: 'start'` with `assemblyId` and `assembly`.
- The Inspector Generate button uses the Canvas-selected Commander LLM in a tool-free completion. If that LLM is unavailable or not authenticated, generation fails visibly before media-provider spending.
- `canvas.previewPrompt` is a compatibility alias for preparing the source snapshot; it does not return a host-composed final prompt.

## Persistent production Task List

`task.media` and `task.mediaFeedback` are two-phase operations:

- The first call persists approved sources and returns `awaiting_prompt_assembly`. It does not reserve budget or call a media provider.
- Commander submits the assembly in the second call. Only then does the host reserve cost, persist the Generation Spec, generate, grade, and apply bounded repair policy.
- Evaluation repair and user feedback create parent-linked revisions from the exact prior final prompt. They never rebuild from the node or append feedback strings.

The Task List's Production Plan, Visual Constitution, provider, reference assets, resolution, budget, retry limits, and approval state remain host-owned and cannot be changed by model output.

## Visual auditions and reference images

- `task.visual` uses the same prepare/submit boundary. Preparing one or more candidate directions within the tool's explicit host budget creates one durable assembly for the current candidate without spending provider budget. Submitting sends only Commander's persisted final and negative prompts.
- Preview generation is followed by a durable background visual evaluation. Repair creates a child assembly containing the exact parent prompt, generated asset, grade evidence, and repair delta; the host never appends repair prose.
- Character, location, and equipment reference sheets are ordinary entity-bound Canvas image nodes. Generate them through `canvas.generation` for manual work or `task.media` for persistent production, inspect the result, then attach the accepted asset with `entity.setRefImageFromNode`.
- Raw image/video job submission and standalone reference-image provider shortcuts are disabled. Every supported image/video submission therefore has a `promptAssemblyId` before it reaches an adapter.

## Persistence and recovery

The `prompt_assemblies` table is the durable source of truth for prepared, assembled, submitted, failed, and cancelled revisions. Assets and Task Attempts store `promptAssemblyId` as lineage.

Recovery replays the exact persisted Assembly and Generation Spec. It does not ask Commander to assemble again after context compaction, chat clear, restart, or an interrupted submission.

Commander context carries only recent assembly IDs and hashes. Full inputs and outputs are loaded on demand through generation history, preventing prompt text from repeatedly consuming the context window.

## Inspection

- `canvas.generation { action: 'history' }` returns durable revisions for Commander.
- The Inspector generation-history section shows the exact final and negative prompts plus the Prompt Assembly revision ID for the user.
- Source decisions and hashes make missing, stale, omitted, or conflicting inputs diagnosable without guessing what the provider received.
