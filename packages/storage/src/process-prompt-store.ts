import { createRequire } from 'node:module';
import type BetterSqlite3 from 'better-sqlite3';
import type { ProcessPromptKey } from '@lucid-fin/contracts';
import { ProcessPromptRepository } from './repositories/process-prompt-repository.js';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3') as typeof BetterSqlite3;

export interface ProcessPromptRecord {
  id: number;
  processKey: string;
  name: string;
  description: string;
  defaultValue: string;
  customValue: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface ProcessPromptDefault {
  processKey: string;
  name: string;
  description: string;
  defaultValue: string;
}

function defineProcessPrompt(
  processKey: string,
  name: string,
  description: string,
  defaultValue: string,
): ProcessPromptDefault {
  return { processKey, name, description, defaultValue };
}

export const PROCESS_PROMPT_DEFAULTS: ProcessPromptDefault[] = [
  defineProcessPrompt(
    'character-ref-image-generation',
    'Character Reference Image Generation',
    'Guidance for character reference image creation.',
    `Build a reusable two-row model sheet, not a poster. Read the character record and current slots first, then decide what this slot must prove. The default target is a two-row model sheet with full-body front, profile, back, and enlarged face studies showing multiple emotions. State anti-collapse rules directly: one character only, neutral background, even light, no single portrait, no half-body crop, no missing side or back views. Use explicit body, costume, hair, and facial-structure language so downstream identity stays stable.`,
  ),
  defineProcessPrompt(
    'location-ref-image-generation',
    'Location Reference Image Generation',
    'Guidance for location reference image creation.',
    `Generate reusable environment sheets, not dramatic one-off frames. Read the location record and existing slots first, then decide whether the image must prove geography, atmosphere, or a repeat camera angle. Prioritize spatial readability, landmark placement, entry path, foreground-to-background depth, weather, and light direction. wide-establishing views should explain the whole place; key-angle views should lock a repeatable camera position. Keep continuity stable across panels and reject collage chaos, random characters, or time-of-day jumps that would weaken place identity.`,
  ),
  defineProcessPrompt(
    'equipment-ref-image-generation',
    'Equipment Reference Image Generation',
    'Guidance for equipment reference image creation.',
    `Treat the object as the subject. Read the equipment record and slot intent first, then decide whether the output must prove silhouette, controls, wear, or handling. Default reference sheets should stay clean and orthographic when possible: front, back, side, plus focused detail views with stable scale. Emphasize material transitions, join lines, fasteners, markings, and damage patterns instead of vague style adjectives. Never let environment mood bury the form. If an in-use shot is needed, include only enough human context to explain scale or grip.`,
  ),
  defineProcessPrompt(
    'image-node-generation',
    'Image Node Generation',
    'Prompt compilation rules for image nodes.',
    `Never send only the raw node prompt when more context exists. Read the node, visible character/location/equipment refs, connected text context, and preset-track state, then write one compiled prompt that reflects the actual frame. Preserve subject, pose or action state, environment layering, materials, and lighting behavior. If refs are missing or stale, fix them with canvas.setNodeRefs before generation. Use canvas.readNodePresetTracks to avoid duplicating camera or look instructions already carried by presets. A good compiled prompt is compact, visual, and scene-specific rather than generic filler.`,
  ),
  defineProcessPrompt(
    'video-node-generation',
    'Video Node Generation',
    'Prompt compilation rules for video nodes.',
    `Write one shot-sized motion beat per node. Read the node, presets, refs, and frame anchors first, then build a prompt around a single action arc with clear start state, motion, and end tendency. If the clip depends on continuity images, verify them with canvas.setVideoFrames and keep first-frame and last-frame roles explicit. Merge character, location, equipment, and connected-text context into the final prompt instead of trusting node text alone. Keep duration realistic, motion readable, and avoid stuffing multiple separate setups into one clip.`,
  ),
  defineProcessPrompt(
    'audio-generation',
    'Audio Generation',
    'Guidance for speech, music, and SFX generation.',
    `Decide first whether the node is a voice, music, or sound effect job. For voice, align spoken text, delivery notes, and emotionVector; for music or ambience, describe structure, pacing, texture, and mix role instead of story synopsis. Use canvas.setAudioParams for sample rate, audioType, and expressive control rather than burying config in prose. Check provider capability before assuming lip sync, long duration, or advanced emotional control. Keep prompts physically audible: breath, strain, softness, distortion, room tone, and rhythm matter more than abstract labels.`,
  ),
  defineProcessPrompt(
    'node-preset-tracks',
    'Node Preset Tracks',
    'Guidance for node-level preset track operations.',
    `Use preset tracks to carry reusable cinematic grammar, not scene-specific facts. Read current track state before changing anything, then decide whether the job is a surgical edit or a grouped rewrite. Favor canvas.writePresetTracksBatch when several categories must move together, and use canvas.writeNodePresetTracks, canvas.addPresetEntry, canvas.updatePresetEntry, or canvas.removePresetEntry for local category edits. Each category should stay semantically clean. The goal is a readable category stack that later compilation can trust without duplicating prompt text.`,
  ),
  defineProcessPrompt(
    'preset-definition-management',
    'Preset Definition Management',
    'Guidance for preset creation and maintenance.',
    `Treat preset records as reusable building blocks, not one-off prompt dumps. When editing or creating presets with preset.create or preset.update, keep each definition compact, typed, and narrowly scoped to its category. Follow the project meta-prompt before authoring new text. Good definitions describe reusable camera, lighting, motion, texture, or quality behavior without smuggling in subject-specific story details. Review for duplication against existing presets and refine what already exists before adding another near-identical entry to the library.`,
  ),
  defineProcessPrompt(
    'shot-template-management',
    'Shot Template Management',
    'Guidance for shot template creation and application.',
    `Shot templates should package repeatable shot grammar that can be applied across nodes. Use shotTemplate.create or shotTemplate.update only after confirming the template represents a durable pattern rather than a one-scene exception. When applying a template with canvas.applyShotTemplate, preserve node-specific subject and action while injecting reusable framing, motion, and continuity structure. Keep template content short, composable, and explicit about what it owns. A template should accelerate shot planning without hiding what changed on the target node.`,
  ),
  defineProcessPrompt(
    'color-style-management',
    'Color Style Management',
    'Guidance for color style creation and maintenance.',
    `Color styles should capture palette logic, contrast behavior, material response, and grade direction in a reusable form. When using colorStyle.save or updating a style, describe relationships, not generic taste words: palette anchors, saturation ceiling, highlight rolloff, shadow density, temperature bias, and texture response. Keep the record compact enough to layer with presets and shot templates. A good style entry protects continuity across shots and gives future prompts a stable palette reference without embedding scene-specific props or characters into the style packet.`,
  ),
  defineProcessPrompt(
    'character-management',
    'Character Management',
    'Guidance for character CRUD work.',
    `Treat character records as durable identity sources. Use character.create, update, or delete only after reading the current record and deciding whether the change belongs in persistent identity rather than a single shot. Store stable facts like role, silhouette, hair, costume system, and recurring emotional baseline. Do not write transient pose, one-shot lighting, or camera angle into the entity. When reference slots change, keep the record and ref-image strategy aligned. The goal is a dependable character source that downstream prompt compilation can trust for continuity.`,
  ),
  defineProcessPrompt(
    'location-management',
    'Location Management',
    'Guidance for location CRUD work.',
    `Location records should preserve durable place identity. Use location.create, update, or delete to capture architecture, layout, weather tendencies, lighting logic, and landmark structure that persist across shots. Keep the record focused on a durable place, not a single momentary frame. Avoid mixing in transient clutter, actor blocking, or temporary camera-angle language. A durable place record should later help prompts explain geography and continuity quickly. If the change matters only for one shot, keep it on the node prompt instead of polluting the base location record.`,
  ),
  defineProcessPrompt(
    'equipment-management',
    'Equipment Management',
    'Guidance for equipment CRUD work.',
    `Equipment records are for real object identity, not decorative prose. Use equipment.create, update, or delete to preserve silhouette, model family, material stack, controls, markings, scale cues, and wear that should persist across shots. Describe the real object clearly enough that later prompts can keep continuity without guessing. Avoid embedding temporary story context or the current holder’s pose into the entity. If the change only matters for one frame, keep it on the node instead. The asset record should stay reusable, compact, and easy to align with its refs.`,
  ),
  defineProcessPrompt(
    'canvas-structure',
    'Canvas Structure',
    'Guidance for canvas creation and structural organization.',
    `Use structural tools when the task changes the canvas itself. canvas.addNode and canvas.batchCreate should build readable planning structure first: sensible titles, correct node types, and grouping that matches story order. Use rename, delete, note, and backdrop operations to keep the workspace legible instead of letting scratch state accumulate. Prefer batch creation when a whole sequence is already known. New structure should make later edits easier, not increase graph entropy. Structural work is about stable topology and readability, not content rewriting.`,
  ),
  defineProcessPrompt(
    'canvas-graph-and-layout',
    'Canvas Graph And Layout',
    'Guidance for edges, ordering, and layout operations.',
    `Graph edits should preserve flow clarity. Use canvas.connectNodes, disconnectNode, deleteEdge, and swapEdgeDirection deliberately so the edge direction always matches temporal or dependency logic. Use canvas.layout when the graph becomes hard to read, and prefer a left-to-right ordering that reveals sequence at a glance. When working on video chains, keep continuity anchors explicit with canvas.setVideoFrames instead of assuming edge semantics will be inferred later. Good graph work reduces ambiguity for both humans and tooling without breaking causal order.`,
  ),
  defineProcessPrompt(
    'canvas-node-editing',
    'Canvas Node Editing',
    'Guidance for node content, refs, and local edits.',
    `Use node-editing tools for local content mutations while preserving broader structure. Prefer canvas.updateNodes for batched prompt or content rewrites, canvas.setNodeRefs for visible continuity inputs, and canvas.setNodeLayout when repositioning a single selection without a full relayout. Keep edits scoped and reversible; use undo and redo intentionally rather than as a substitute for planning. When selecting variants or swapping refs, make sure the node still matches what downstream generation expects. Batch coherent edits together so the canvas never drifts into a half-updated state.`,
  ),
  defineProcessPrompt(
    'provider-management',
    'Provider Management',
    'Guidance for provider setup and capability checks.',
    `Provider management is about registry truth, not per-node artistic choices. Use provider.list to inspect available services, provider.getCapabilities to check hard limits, and provider.setActive or provider.update only when global provider state really must change. Keep provider IDs, models, endpoints, and capability assumptions explicit. Never guess a feature that can be checked. When a provider lacks built-in capability data, report that uncertainty and fall back conservatively instead of inventing support. This guide owns provider setup and validation, not shot-specific prompt writing.`,
  ),
  defineProcessPrompt(
    'node-provider-selection',
    'Node Provider Selection',
    'Guidance for assigning providers to nodes.',
    `Choose a provider per node based on media type, required capabilities, and cost, not habit. Use canvas.setNodeProvider to write a concrete providerId onto the node and canvas.estimateCost when the user needs a budget-aware decision. Selection should consider reference-image support, duration limits, audio support, and model strengths relevant to this specific node. Keep the explanation concise and evidence-based. Do not hide provider choice inside prompt prose. The result should be a stable node-level assignment that future runs can inspect directly.`,
  ),
  defineProcessPrompt(
    'image-config',
    'Image Config',
    'Guidance for image parameter configuration.',
    `Image configuration belongs in explicit params, not prompt text. Use canvas.setImageParams to control width and height, aspect ratio, quality, background behavior, and other image-specific settings. Derive those settings from the target deliverable and provider capability rather than from generic defaults. Verify that the frame size matches the intended use, and keep config aligned with any preset or shot-template assumptions. If the shot needs transparent output or a special aspect ratio, encode it here clearly. A good config is typed, reviewable, and separate from descriptive image prose.`,
  ),
  defineProcessPrompt(
    'video-config',
    'Video Config',
    'Guidance for video parameter configuration.',
    `Video configuration should encode timing and render constraints directly. Use canvas.setVideoParams for duration, frame anchors, audio inclusion, lip sync, and quality settings. Choose duration to fit one readable action beat, not an entire scene. Check provider capability before assuming audio, long clips, or advanced controls are supported. Keep first-frame and last-frame dependencies explicit and consistent with the current graph. The config should make later generation predictable: the node clearly states duration, audio intent, and continuity anchors without burying those facts in prose.`,
  ),
  defineProcessPrompt(
    'audio-config',
    'Audio Config',
    'Guidance for audio parameter configuration.',
    `Audio configuration should be typed and intentional. Use canvas.setAudioParams for sample rate, audioType, voice behavior, and expressive controls instead of informal prompt hints. Pick sample rate and format based on downstream use, and make sure voice nodes, music nodes, and effects nodes are configured differently when needed. If an emotionVector is used, keep it simple and legible rather than overfitted. The configuration should tell future tooling what kind of audio this node is supposed to produce while leaving the prompt focused on the sound itself.`,
  ),
  defineProcessPrompt(
    'script-development',
    'Script Development',
    'Guidance for reading, writing, and importing scripts.',
    `Scripts should stay structured and editable. Use script.read before major changes, script.write for deliberate rewrites, and script.import only when the source is ready to become project structure. Prefer structured scenes, beats, and dialogue blocks over literary filler. If a script change would alter story shape materially, surface that choice rather than silently rewriting the project direction. Keep imports and writes aligned with downstream node planning so scene boundaries, episodes, and line ownership remain clear. Script work should produce planning data that later tools can execute.`,
  ),
  defineProcessPrompt(
    'vision-analysis',
    'Vision Analysis',
    'Guidance for extracting usable visual evidence from images.',
    `Use vision.describeImage to extract observable evidence, not fantasy. Decide first whether the task needs factual description, style extraction, or prompt reconstruction, then choose the right analysis goal. Separate persistent facts from transient shot details before writing anything back into the project. Good analysis names what is actually visible: pose, materials, lighting direction, environment cues, palette behavior, and composition. It should not silently redesign entities or locations. If the image is ambiguous, report uncertainty instead of presenting speculation as ground truth.`,
  ),
  defineProcessPrompt(
    'snapshot-and-rollback',
    'Snapshot And Rollback',
    'Guidance for safe checkpointing and restoration.',
    `Snapshots exist to protect risky operations. Create them before broad rewrites, large deletions, or other state changes that would be painful to reverse. Labels should explain scope and intent, not just say “backup.” Treat snapshot.restore as destructive replacement: always make the consequence visible and require commander.askUser before restoring meaningful work. After restore, re-read the relevant state instead of trusting memory. This guide is about safe recovery discipline. Use snapshots to preserve optionality, not as a shortcut for sloppy changes.`,
  ),
  defineProcessPrompt(
    'render-and-export',
    'Render And Export',
    'Guidance for render execution and delivery handoff.',
    `Render only when the graph is genuinely ready. Before render.start, confirm required assets exist, edge flow is coherent, and output-critical settings match the intended deliverable. Use render.exportBundle for interchange or handoff packaging, not as a stand-in for preview movies. If a render fails, diagnose missing assets, format mismatch, or broken graph structure before retrying. Use render.cancel deliberately when the user wants to stop or the job is clearly wrong. Rendering is an async operation with real cost; the guide should keep it explicit, state-aware, and aligned with delivery goals.`,
  ),
  defineProcessPrompt(
    'workflow-orchestration',
    'Workflow Orchestration',
    'Guidance for workflow expansion and control.',
    `Use workflows only when they reduce coordination cost without hiding critical creative choices. workflow.expandIdea should turn approved concepts into structured planning material; it should not silently invent a new project direction. workflow.control should pause, resume, cancel, or retry runs based on known state, not as a magic reset button. Before retrying, identify why the prior run failed. Before expanding a loosely scoped idea, get explicit approval if the transformation will materially change story shape. Workflows are for visible orchestration and repeatable multi-step execution.`,
  ),
  defineProcessPrompt(
    'series-management',
    'Series Management',
    'Guidance for series and episode planning work.',
    `Treat the series record as durable project structure. Use series.get and series.update to maintain title, description, and top-level framing, then manage episodes with explicit add, remove, and reorder actions. Preserve episode order clearly instead of leaving sequencing implicit in canvas names. Each episode should have a clear role in the larger series, and the series object should stay free of scene-level noise. This guide exists to keep long-form project structure stable, legible, and easy to align with canvases, workflows, and planning documents.`,
  ),
  defineProcessPrompt(
    'prompt-template-management',
    'Prompt Template Management',
    'Guidance for reusable prompt template maintenance.',
    `Prompt templates are reusable instruction assets, not casual notes. Use prompt.get to inspect current template state and prompt.setCustom when the project truly needs a customized override. Keep each template code focused on one repeatable responsibility, and avoid mixing unrelated behavior into a single giant override. Customizations should stay compatible with the project’s injection model and be easier to audit than ad hoc prompt edits. When the change is really one-shot behavior, leave the template alone instead of fragmenting process logic.`,
  ),
  defineProcessPrompt(
    'asset-library-management',
    'Asset Library Management',
    'Guidance for importing and locating project assets.',
    `The asset library should stay searchable and trustworthy. Use asset.import when a local file needs to become a managed project asset, and asset.list when you need to discover what already exists before importing duplicates. Keep asset type explicit and verify whether the project already has the required file before adding another copy. Imported assets should support downstream node work, not become untracked clutter. This guide is about organized intake and retrieval that later prompts, nodes, and exports can locate without manual path hunting.`,
  ),
  defineProcessPrompt(
    'job-control',
    'Job Control',
    'Guidance for inspecting and controlling generation jobs.',
    `Use job.list to inspect active and historical work, then use job.control only when a concrete action is justified. cancel, pause, or resume should reflect user intent and current run state, not frustration or guesswork. Make the target job ID explicit and explain why the control action is being taken. If repeated failures appear, diagnose the underlying node, provider, or graph issue before touching control again. Job operations are operational, not creative; the goal is transparent queue management that keeps long-running work observable and interruptible.`,
  ),
];

const LEGACY_PROCESS_PROMPT_SPLITS = [
  {
    legacyKey: 'ref-image-generation',
    replacementKeys: [
      'character-ref-image-generation',
      'location-ref-image-generation',
      'equipment-ref-image-generation',
    ],
  },
  {
    legacyKey: 'entity-management',
    replacementKeys: ['character-management', 'location-management', 'equipment-management'],
  },
  {
    legacyKey: 'preset-and-style',
    replacementKeys: [
      'node-preset-tracks',
      'preset-definition-management',
      'shot-template-management',
      'color-style-management',
    ],
  },
  {
    legacyKey: 'canvas-workflow',
    replacementKeys: ['canvas-structure', 'canvas-graph-and-layout', 'canvas-node-editing'],
  },
  {
    legacyKey: 'provider-and-config',
    replacementKeys: [
      'provider-management',
      'node-provider-selection',
      'image-config',
      'video-config',
      'audio-config',
    ],
  },
] as const;

export class ProcessPromptStore {
  private db: BetterSqlite3.Database;
  private defaults = new Map<string, ProcessPromptDefault>();
  private repo!: ProcessPromptRepository;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    for (const entry of PROCESS_PROMPT_DEFAULTS) {
      this.defaults.set(entry.processKey, entry);
    }
    this.init();
    // Repo must exist before seed/migrate because both helpers delegate
    // through `this.get` / `this.repo`.
    this.repo = new ProcessPromptRepository(this.db);
    this.seedDefaults(PROCESS_PROMPT_DEFAULTS);
    this.migrateLegacyProcessPrompts();
  }

  private init(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS process_prompts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        process_key TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        default_value TEXT NOT NULL,
        custom_value TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `);
  }

  seedDefaults(defaults: readonly ProcessPromptDefault[]): void {
    const now = Date.now();
    const statement = this.db.prepare(`
      INSERT INTO process_prompts (
        process_key,
        name,
        description,
        default_value,
        custom_value,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, NULL, ?, ?)
      ON CONFLICT(process_key) DO UPDATE SET
        name = excluded.name,
        description = excluded.description,
        default_value = excluded.default_value
    `);

    const seedMany = this.db.transaction((entries: readonly ProcessPromptDefault[]) => {
      for (const entry of entries) {
        statement.run(
          entry.processKey,
          entry.name,
          entry.description,
          entry.defaultValue,
          now,
          now,
        );
      }
    });

    seedMany(defaults);
  }

  private migrateLegacyProcessPrompts(): void {
    const copyCustomValue = this.db.prepare(`
      UPDATE process_prompts
      SET custom_value = COALESCE(custom_value, ?), updated_at = ?
      WHERE process_key = ?
    `);
    const deleteLegacy = this.db.prepare(`
      DELETE FROM process_prompts
      WHERE process_key = ?
    `);

    const migrate = this.db.transaction(() => {
      for (const entry of LEGACY_PROCESS_PROMPT_SPLITS) {
        // Legacy keys bypass brand validation — they exist only in old DBs.
        const legacy = this.get(entry.legacyKey);
        if (!legacy) continue;

        if (legacy.customValue !== null) {
          const now = Date.now();
          for (const replacementKey of entry.replacementKeys) {
            copyCustomValue.run(legacy.customValue, now, replacementKey);
          }
        }

        deleteLegacy.run(entry.legacyKey);
      }
    });

    migrate();
  }

  list(): ProcessPromptRecord[] {
    return this.repo.list().rows;
  }

  /**
   * Looks up a process prompt by key. Accepts raw string for back-compat with
   * IPC handlers + legacy migration; the typed path (`ProcessPromptRepository`)
   * enforces the brand at compile time.
   */
  get(processKey: string): ProcessPromptRecord | null {
    return this.repo.get(processKey as ProcessPromptKey);
  }

  getEffectiveValue(processKey: string): string | null {
    return this.repo.getEffectiveValue(processKey as ProcessPromptKey);
  }

  setCustom(processKey: string, value: string): void {
    this.repo.setCustom(processKey as ProcessPromptKey, value);
  }

  resetToDefault(processKey: string): void {
    this.repo.resetToDefault(processKey as ProcessPromptKey);
  }

  close(): void {
    this.db.close();
  }
}
