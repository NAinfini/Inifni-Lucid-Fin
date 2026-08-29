# Current versus historical capability matrix

## Evidence boundary

- Historical pre-redesign baseline: `0a50b9b`, package version `0.0.8`.
- Current committed baseline: `a901255`, package version `0.1.0`.
- The working tree contains uncommitted exploratory Sequence, desktop-shell, OpenAI adapter, and
  planning changes. They are not counted as completed current capability.
- A file or UI surface proves only that code exists. A capability is considered functional only when
  its authority, adapter, user path, and relevant tests are connected.

Disposition terms:

- **Retain** — current durable authority is correct.
- **Selectively port** — recover useful historical logic into current contracts.
- **Redesign** — preserve the product value but replace the old ownership or interface.
- **Delete** — do not restore obsolete, duplicated, misleading, or conflicting behavior.

## Matrix

| Area                                       | Historical support and evidence                                                                                                                                                                                       | Current committed support and evidence                                                                                                                                                                             | Disposition                                                                                                                           | Important caveat                                                                                                                                                      |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Desktop shell and navigation               | `apps/desktop-renderer/src/components/layout/AppShell.tsx`, `LeftToolbar.tsx`, `RightToolbar.tsx`, and historical `App.tsx` supplied custom title bar, logo, status, Canvas/Settings/Tasks/Audio/Export/Series routes | `apps/desktop-main/src/electron.ts`; `apps/desktop-renderer/src/App.tsx`, `GlobalRail.tsx`, `ProjectHome.tsx`, `ProjectShell.tsx`                                                                                  | **Redesign**; retain logo, branded shell, shortcuts, and useful status                                                                | Committed HEAD still uses native-overlay behavior rather than a verified fully frameless shell. Settings is not a complete global control plane.                      |
| Project, Chat, and Run                     | Historical agent orchestrator/tool registry and application workflow engine supported planning, pause/resume, approvals, and retry; Series UI/repository added a forced hierarchy                                     | `packages/contracts/src/{project,conversation,run}.ts`; storage Project/Conversation/Run authorities; `packages/runtime/src/index.ts`; renderer Commander surfaces                                                 | **Retain** current durable authorities; **selectively port** useful planning/approval/recovery behavior; **delete** forced Series     | CRUD and durable Run foundations are real. Default Ollama cannot prove the autonomous tool-calling production journey.                                                |
| Canvas                                     | Historical `CanvasPage.tsx`, `CanvasWorkspace.tsx`, XYFlow nodes/edges, search, notes, inspectors, entity panels, repository, and service                                                                             | Current `packages/contracts/src/canvas.ts` and storage Canvas authority; committed wire is limited                                                                                                                 | **Redesign** as semantic Canvas; **selectively port** graph interaction, grouping, zoom, inspectors, and candidate UX                 | Historical Canvas relied heavily on renderer/Redux state and media nodes. Current committed Canvas lacks the complete multiple-Canvas lifecycle/API.                  |
| Sequence and timeline                      | Historical `packages/contracts/src/dto/timeline.ts` and media/NLE code modeled tracks, clips, duration, in/out, and transitions                                                                                       | No committed Sequence contract/authority. `packages/contracts/src/delivery.ts` still owns editable order/reorder                                                                                                   | **Redesign** around one Sequence authority; **selectively port** useful clip/edit semantics                                           | Delivery order and Sequence cannot coexist as editable truths. Uncommitted Sequence files are exploratory, not complete.                                              |
| Character, Location, World, and Assets     | Historical Character/Location/Asset DTOs, repositories, handlers, editors, entity tools, and reference-image workflows                                                                                                | Current Production types include character/location/world_fact/shot; Media contracts/storage provide GlobalMediaAsset and ProjectMediaRef                                                                          | **Selectively port** rich entity fields/reference generation; **redesign** a versioned cross-Project Asset library                    | Current `world_fact` is not a complete World entity. Current Global Media manages files/blobs, not reusable structured continuity entities.                           |
| Provider Settings, Keychain, and OAuth     | Historical provider contracts/catalogs, keychain storage, OAuth manager/broker, Provider Settings UI, host allowlist, health checks, and tests                                                                        | Current ProjectSettings exposes a default profile ID; provider capability summaries exist; main process has recovery-key Keychain and local Ollama                                                                 | **Selectively port** security/OAuth/health behavior; **redesign** one global ProviderConnection/Profile authority                     | A Settings button or provider list does not prove credentials, connection, profile, or model role is usable.                                                          |
| LLM, image, video, and audio adapters      | Historical `packages/adapters-ai` contained registries and OpenAI/Google/Runway/Replicate/ElevenLabs/Stability and other adapters                                                                                     | Current `ModelAdapter` contract is durable; production composition creates only Ollama; generation, transcription, and assessment host ports throw `ProviderNotConfiguredError`; local media/FFmpeg paths are real | **Selectively port** adapters one at a time into the canonical lifecycle                                                              | Historical adapter count is not readiness. Some old poll/cancel/quote behavior is incomplete or API-dependent. Uncommitted OpenAI code is not wired into composition. |
| Generation, evaluation, and focused repair | Historical generation pipeline, Canvas generation handlers, prompt/video chains, vision analysis, workflow planner, recovery, and repair logic                                                                        | Current Generation, ResultAssessment, MediaDerivation contracts and storage support quote/submit/reconcile, receipts, validation, assessments, and provenance                                                      | **Retain** current authorities; **selectively port** planner, vision rubric, and repair; **redesign** the end-to-end autonomous chain | Data/storage capability is substantial, but default host providers are not configured, so the real media-production journey cannot run.                               |
| Script, Story, Scene, and Shot             | Historical script parser/repository/handlers, copywriting/prompt tools, story-to-video/shot-list guides, templates, and presets                                                                                       | Current Production types contain story/scene/beat/shot and typed domain tools                                                                                                                                      | **Selectively port** parser and story tools; **redesign** Story -> Scene -> Beat -> Shot -> Sequence workflow                         | Current generic Production storage is not a finished story-production interface or orchestration pipeline.                                                            |
| Review cut, export, and NLE                | Historical media engine provided render/stitch/NLE/CapCut/subtitle/proxy behavior; Export UI and final-export approval existed                                                                                        | Current media engine review cut, Delivery contracts/storage, local renderer/exporter, and immutable manifest behavior                                                                                              | **Retain** FFmpeg/review-cut foundation; **selectively port** subtitles/proxy/NLE; **redesign** Sequence-derived Delivery             | Current Delivery still maintains order. It cannot remain an independent editor once Sequence is introduced.                                                           |
| Skills, presets, and templates             | Historical 216 presets, about 19 shot templates, renderer/process guidance, repositories, and management UI                                                                                                           | Current capability catalog, immutable Skill documents, registration, `skill.load`, and `skill.propose` confirmation foundation                                                                                     | **Retain** Skill version/hash/proposal lifecycle; reclassify presets as Creative Catalog and templates as Shot Recipes                | Current production composition starts from `const skills: []`; generated 287-item artifacts do not prove the live root catalog is registered or useful.               |

## Final retention set

The strongest current foundations to preserve are:

- typed contracts and generated wire boundary;
- Project, Chat, Message, Run, Task List, and child-Run durability;
- revision/content-hash checks and content-addressed media;
- private recovery, confirmation, permissions, budgets, receipts, and restart reconciliation;
- typed Production object identity and semantic relations;
- Generation Request/Attempt/Result and Result Assessment evidence;
- UserChoice/ResultDecision provenance and protection;
- Project media references and immutable Delivery manifests;
- local import, inspection, derivation, FFmpeg review rendering, and local export grants;
- immutable Skill/catalog snapshots and durable proposal confirmation.

## Historical behavior to selectively recover

- rich Character, Location, World, Style, Prop, Wardrobe, and Equipment facts;
- multi-angle reference images and entity media selection;
- script import/parser and Story/Scene/Shot authoring logic;
- Canvas graph ergonomics, search, grouping, Inspector, comparison, and candidate history;
- Provider Settings, Keychain credentials, OAuth, endpoint allowlisting, health, and model selection;
- individually audited Commander/image/video/audio/vision adapters;
- visual quality and continuity rubrics, assessment, focused repair, and regenerate flows;
- subtitle, proxy, stitch, review-cut, FCPXML/EDL, and other verified NLE interchange behavior;
- useful approval, recovery, planning, and parallel-work semantics that do not duplicate the current
  Harness.

## Behavior not to restore

- Redux/browser-local state as a production authority;
- one media/provider attempt per Canvas node;
- Canvas coordinates or edge direction as editorial order;
- both Timeline/Sequence order and Delivery order;
- Series/Service as a mandatory hierarchy;
- renderer-owned provider credentials or duplicate settings stores;
- silent provider fallback, incomplete adapters displayed as ready, or fake success;
- the rigid historical workflow UI as the only way to make a film;
- hundreds of camera values, presets, or templates represented as independent Skills;
- legacy schema, compatibility branches, migration, or backward-compatibility code.

## Relevant current validation entry points

- `apps/desktop-renderer/src/project-shell.test.tsx`
- `apps/desktop-renderer/src/workspaces.test.tsx`
- `apps/desktop-renderer/src/commander-dock.test.tsx`
- `apps/desktop-renderer/src/production-boundary.test.ts`
- `apps/desktop-main/src/production-adapters.test.ts`
- `apps/desktop-main/src/production-composition.test.ts`
- `apps/desktop-main/src/runtime-controller.test.ts`
- `packages/contracts/src/contracts.test.ts`
- `packages/contracts/src/wire.test.ts`
- `packages/contracts/src/production-wire.test.ts`
- `packages/contracts/src/capability-catalog.test.ts`
- `packages/storage/test/i2h/full-film-journey.test.ts`
- `packages/storage/test/recovery-journey.test.ts`
- `packages/storage/test/tamper-privacy-boundary.test.ts`
- `packages/media-engine/src/review-cut.test.ts`
- `tests/e2e/canvas-create.spec.ts`
- `tests/e2e/frontend-audit.spec.ts`
- `tests/e2e/smoke.spec.ts`

These tests are evidence inputs, not proof that the redesigned product exists. The implementation
plan defines the new required suites and packaged/live-provider boundaries.
