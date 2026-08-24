import { createRequire } from 'node:module';
import type BetterSqlite3 from 'better-sqlite3';
import { COMMANDER_GUIDE_LIMITS, type ProcessPromptKey } from '@lucid-fin/contracts';
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
    'entity-ref-image-generation',
    'Entity Reference Image Generation',
    'Guidance for entity (character, location, equipment) reference image creation.',
    `Entity reference images are durable identity assets, not scene frames. Entity records own identity; node prompts own a requested view or layout; generated assets become reusable only when bound through \`entity.setRefImageFromNode\`.

Character \`full-sheet\` uses consistent full-body and expression coverage; location \`bible\` and \`fake-360\` describe empty-space continuity; equipment \`ortho-grid\` describes front, back, and profile views. Neutral backgrounds, stable scale, and explicit panel separation are useful anti-collapse vocabulary. \`extra-angle\` represents a view-specific asset rather than a replacement identity sheet.

\`canvas.generation\` exposes prepared Prompt Assembly inputs, provider starts, and refinements. Assembly sources carry entity facts, references, presets, user intent, and provider constraints independently; the submitted final prompt is the provider-facing creative decision.`,
  ),
  defineProcessPrompt(
    'image-node-generation',
    'Image Node Generation',
    'Prompt compilation rules for image nodes.',
    `Image nodes describe visible frames. The five elements are subject, action, environment, lighting, and composition. Entity records and attached refs own durable identity; node text owns shot-specific action and visible geography; preset tracks own reusable camera and look grammar. \`canvas.setNodeRefs\` changes reference attachment, while text alone is not a durable identity substitute.

Prompt Assembly is immutable evidence, not a provider prompt fragment: \`canvas.generation\` preparation returns source IDs and hashes for node text, connected context, refs, presets, policies, and provider limits. An assembly submitted to generation contains one resolved decision per applicable source and a finalPrompt/negativePrompt. Provider text is sent byte-for-byte, with no host-authored creative append.

Useful image language names concrete light direction, materials, framing, and landmarks. Generic adjective piles, duplicated reference facts, and conflicting style prose reduce control.`,
  ),
  defineProcessPrompt(
    'video-node-generation',
    'Video Node Generation',
    'Prompt compilation rules for video nodes.',
    `A video node represents one visible shot with a legible action arc, camera idea, and landing moment. A three-part description can hold phase, on-screen action, and resolution in flowing provider prose. Concrete verbs, one dominant move, duration-aware action, and a named focal subject preserve motion clarity.

First-frame and last-frame images are continuity facts. \`canvas.setVideoFrames\` records their explicit roles; first-frame input supports image-to-video, paired anchors describe interpolation, and no anchor leaves text-to-video. Entity refs own continuity identity, preset tracks own reusable camera and look grammar, and node text owns the motion visible in this shot.

Prepared Prompt Assembly sources include script context, anchors, refs, presets, provider limits, and user intent. The submitted finalPrompt/negativePrompt is the exact provider input; refinement carries a parent-linked correction rather than inventing a new source history.`,
  ),
  defineProcessPrompt(
    'audio-generation',
    'Audio Generation',
    'Guidance for all audio generation (voice, music, SFX).',
    `Audio nodes use \`audioType\` values \`voice\`, \`music\`, or \`sfx\`; \`canvas.setMediaParams\` holds typed media settings and \`provider.manage\` exposes provider capability facts. Duration, sample rate, loop support, emotion vectors, variants, and voice features vary by provider.

Voice prompt text is the spoken line. Bracketed delivery cues can describe performance, while \`emotionVector\` stores structured intensity across happy, sad, angry, fearful, surprised, disgusted, contemptuous, and neutral values. Character records own recurring voice identity.

Music vocabulary includes a Genre anchor, BPM, key, instrumentation, structure, texture, and mix role. SFX vocabulary includes object, action, surface, layers, and Environment acoustics such as dry, small-room, hall, outdoor, or underwater. A seamless loop is an ambience property; short physical events and continuous environments have different temporal shapes.`,
  ),
  defineProcessPrompt(
    'node-preset-tracks',
    'Node Preset Tracks',
    'Guidance for node-level preset track operations.',
    `Preset tracks are reusable cinematic grammar attached to a node. \`canvas.presetTracks\` reads and changes typed category entries: \`camera\`, \`lens\`, \`look\`, \`scene\`, \`composition\`, \`emotion\`, \`flow\`, and \`technical\`. The tool supports entry changes, track writes, batch writes, and template application according to its schema.

Category ownership separates concerns: camera is viewpoint and movement; lens is focal behavior; look is grade and tonal behavior; scene is recurring environmental grammar; composition is framing; emotion is shot-level anchor; flow is continuity and pacing; technical is hard rendering constraint. Entity identity belongs to refs, shot action belongs to node text, and palette ownership belongs to color styles.

Track stacks are most legible when each entry has a distinct concern. Generated assets retain their existing output after a track record changes.`,
  ),
  defineProcessPrompt(
    'preset-definition-management',
    'Preset Definition Management',
    'Guidance for preset creation and maintenance.',
    `Preset definitions are durable, typed library records. \`preset.manage\` exposes creation, reading, updates, deletion, and built-in reset behavior through its schema. A preset category is one of \`camera\`, \`lens\`, \`look\`, \`scene\`, \`composition\`, \`emotion\`, \`flow\`, or \`technical\`.

Good presets name one reusable cinematic concern: a camera viewpoint, lens behavior, grade, recurring scene grammar, framing pattern, emotional anchor, pacing cue, or hard technical constraint. Character names, plot events, and one-shot action belong to entities or node text instead. Color palettes and material-grade behavior belong to color-style records.

Library records affect later prompt assembly when referenced by node tracks; generated assets remain historical outputs. Delete and reset semantics, including built-in versus user-created distinctions, are defined by the tool and execution guard.`,
  ),
  defineProcessPrompt(
    'shot-template-management',
    'Shot Template Management',
    'Guidance for shot template creation and application.',
    `Shot templates package recurring shot grammar for reuse. \`shotTemplate.manage\` exposes template records, and \`canvas.presetTracks\` applies their typed track bundle to one or more nodes. Templates commonly own camera, lens, composition, and flow; node text owns subject action, and refs own identity.

Template names describe readable screen grammar such as framing, lens feel, or camera direction rather than episode or scene labels. Look, emotion, scene, and technical categories remain composable layers when a template does not own them. A local node track entry can express a shot-specific variation without changing durable template meaning.

Template application changes future assembly inputs. It does not rewrite an existing generated asset, a reference image, or a canvas graph edge.`,
  ),
  defineProcessPrompt(
    'color-style-management',
    'Color Style Management',
    'Guidance for color style creation and maintenance.',
    `Color styles are reusable visual-continuity records. \`colorStyle.manage\` exposes catalog operations through its schema. A style owns palette relationships, contrast behavior, material response, grade direction, and exposure character; camera movement, subject identity, and scene action belong to other layers.

A palette can name dominant, accent, shadow, skin-tone, and neutral behavior instead of a loose list of colors. Useful style vocabulary includes hue bias, saturation range, black level, highlight rolloff, mixed-light response, texture, film emulation, and surface material behavior. Node preset \`look\` entries can reference a color style without duplicating its body.

Style records contribute facts to later Prompt Assembly. Existing renders preserve the provider output that produced them.`,
  ),
  defineProcessPrompt(
    'entity-management',
    'Entity Management',
    'Guidance for entity (character, location, equipment) CRUD work.',
    `Entity records are durable identity sources. \`entity.list\`, detail reads, and mutation tools expose character, location, and equipment records under their typed schemas. Records own names, structured identity fields, reusable reference assets, and continuity metadata; canvas nodes own scene-specific use of those facts.

Characters can carry appearance, wardrobe, voice, and loadout facts. Locations can carry geography, architecture, atmosphere, and recurring conditions. Equipment can carry silhouette, material, function, and scale. Reference images are evidence linked to an entity, not generic assets implied by a prompt.

Entity changes alter future assembly sources and may reveal continuity differences in downstream work. CAS, ownership, and destructive constraints are enforced at execution time rather than encoded as conversational routes.`,
  ),
  defineProcessPrompt(
    'canvas-structure',
    'Canvas Structure',
    'Guidance for canvas creation and structural organization.',
    `A canvas contains typed nodes, graph edges, notes, backdrops, settings, and generated assets. \`canvas.createNodes\` represents atomic node-and-edge creation; \`canvas.duplicateNodes\`, \`canvas.importDocument\`, and \`canvas.exportDocument\` work with reusable structure; \`canvas.manage\` and note/backdrop tools expose canvas metadata.

Text nodes carry scene context, image nodes carry visual frames, video nodes carry clips, and audio nodes carry sound. Edges express context or media relationships rather than visual proximity. Backdrops and notes are human organization facts and do not become generation context by themselves.

Canvas deletion and bulk structural mutation are destructive facts. The execution guard validates current scope, CAS state, permission, cost, and authenticated user confirmation where the action requires it.`,
  ),
  defineProcessPrompt(
    'canvas-graph-and-layout',
    'Canvas Graph And Layout',
    'Guidance for edges, ordering, and layout operations.',
    `Canvas edges express data relationships: text-to-image supplies a scene brief, image-to-video can supply a first frame, and video-to-image can expose a final frame. \`canvas.connectNodes\` and \`canvas.manageEdge\` expose edge changes; \`canvas.setVideoFrames\` records explicit first-frame and last-frame roles; \`canvas.layout\` exposes layout computation.

Left-to-right placement communicates temporal or production flow, while coverage clusters communicate alternate views of the same beat. A video chain can make image-video-image continuity visible. Layout is presentational data; edge direction and explicit frame roles are the generation facts.

Changing edges, anchors, or layout affects future assembly and rendering context. Existing media retains its historical provider result.`,
  ),
  defineProcessPrompt(
    'canvas-node-editing',
    'Canvas Node Editing',
    'Guidance for node content, refs, and local edits.',
    `Canvas node editing covers local content, prompt, reference, layout, variant, and preview records. \`canvas.updateNodes\`, \`canvas.setNodeRefs\`, \`canvas.setNodeLayout\`, and \`canvas.selectVariant\` expose their typed mutation shapes. A node can be locked, bypassed, positioned, or color-tagged without changing its semantic role.

Reference attachment is explicit: character, equipment, and location refs carry durable identity for entities visible in the intended frame. Node prompt text carries scene-specific content. Selected variant index determines the downstream primary output when a node has variants.

\`canvas.previewPrompt\` and generation preparation expose the immutable Prompt Assembly source snapshot, including source hashes and authority facts. A final provider prompt exists only in a submitted assembly. CAS validation and write authorization are execution-time facts.`,
  ),
  defineProcessPrompt(
    'provider-management',
    'Provider Management',
    'Guidance for provider setup and capability checks.',
    `Provider management is project-wide infrastructure. \`provider.manage\` exposes registered providers, active capability routes, capability manifests, and active-provider selection according to its schema. Provider facts include supported media types, resolution and duration ranges, variants, emotion vectors, loop support, cost tiers, and model-specific limits.

The active provider is the default for nodes without a \`providerId\` override. A node override is a local routing record and does not alter the project default. Provider swaps can change visual or audio behavior because model capabilities and rendering priors differ.

API keys, OAuth credentials, provider settings, and custom endpoint registration belong to Settings and secret storage, not prompts, notes, tool results, or chat output. Credentials are secrets. Permission, cost, and admin boundaries are enforced by the execution guard.`,
  ),
  defineProcessPrompt(
    'node-provider-selection',
    'Node Provider Selection',
    'Guidance for assigning providers to nodes.',
    `Node provider selection is local routing and budgeting. \`canvas.configureNode\` records a node \`providerId\` override and optional provider-specific settings; the global active provider remains the fallback for nodes without that override. \`canvas.generation\` estimation exposes a provider-side cost estimate for the node's current media parameters.

Capability manifests describe the valid resolution, duration, variant, emotion, loop, and model features for a candidate provider. A providerId change can make prior node parameters unsupported or visually inconsistent with neighboring output. Seed and parameter ownership remain on the node record.

Cost estimates are facts about a specific provider and parameter snapshot, not a promise of total project cost. Execution-time cost and permission guards remain authoritative.`,
  ),
  defineProcessPrompt(
    'media-config',
    'Media Config',
    'Guidance for media parameter configuration (image, video, audio).',
    `Media configuration is typed node state. \`canvas.setMediaParams\` exposes shared and audio parameters, while image and video configuration tools expose their schema-specific fields. Image facts include width, height, aspect ratio, seed, and variant count. Video facts include duration, frame rate, aspect ratio, seed, and continuity anchors. Audio facts include duration, sample rate, audioType, voice identity, loop behavior, and emotionVector.

Provider manifests constrain valid ranges and supported features. Media parameters describe generation mechanics; creative wording belongs to node prompts, reusable look belongs to presets or color styles, and durable subject identity belongs to entity refs.

Parameter changes alter future provider requests. Existing assets retain their historical parameters and output. Cost and destructive safeguards remain execution-time policy.`,
  ),
  defineProcessPrompt(
    'script-development',
    'Script Development',
    'Guidance for reading, writing, and importing scripts.',
    `Scripts are narrative source records. \`script.manage\` exposes script text and metadata, and \`script.import\` accepts supported external documents through its schema. Fountain is the screenplay interchange vocabulary: scene headings, action, character cues, dialogue, parentheticals, transitions, and notes can be represented as readable script text.

The script owns story structure, dialogue, and scene intent. Canvas nodes own production decomposition, shot prompts, and generated media. Entity records own durable characters, locations, equipment, and references. A screenplay is not a provider prompt or a canvas graph.

Script edits change later reading and analysis context. File paths, imported content, and user-authored text remain data governed by tool validation and project permissions.`,
  ),
  defineProcessPrompt(
    'vision-analysis',
    'Vision Analysis',
    'Guidance for extracting usable visual evidence from images.',
    `Vision analysis uses \`text.analyze\` for image description and stateless text transformation under a declared intent. Useful intents include visual evidence extraction, composition description, palette or material observation, prompt reconstruction, and concise transformation of user-provided text.

Analysis results are observations, not durable identity. Entity records, node prompts, color styles, and preset tracks own the facts that later generation uses. Image source references, asset hashes, and canvas node relationships identify the evidence being discussed.

Descriptions can distinguish visible subject, action, environment, lighting, composition, camera cues, palette, texture, and continuity details. Capability, privacy, and source-access boundaries are validated by the analysis tool and execution guard.`,
  ),
  defineProcessPrompt(
    'snapshot-and-rollback',
    'Snapshot And Rollback',
    'Guidance for safe checkpointing and restoration.',
    `Snapshots are point-in-time project state records. \`snapshot.create\` stores a labeled checkpoint, \`snapshot.list\` exposes checkpoint metadata, and \`snapshot.restore\` requests restoration through its typed schema. A restore rewinds durable project state; generated binary recovery depends on the underlying provider and storage facts.

Snapshot labels communicate scope and intent, such as a production milestone or a change boundary. Snapshot history is evidence for recovery and does not replace current canvas, entity, or asset reads.

Restoration is destructive. The execution guard requires authenticated user confirmation, validates current permissions and CAS state, and records the resulting event history. Conversation prose cannot bypass that guard.`,
  ),
  defineProcessPrompt(
    'prompt-template-management',
    'Prompt Template Management',
    'Guidance for reusable prompt template maintenance.',
    `Prompt templates are reusable stored text selected by code. \`prompt.get\` resolves a template's effective value and \`prompt.setCustom\` stores a user customization. Examples include \`agent-system\`, \`domain-canvas-tools\`, \`novel-to-script\`, \`character-extract\`, and \`script-breakdown\`.

The prompt-template catalog is separate from the process-prompt store. Process guides are on-demand reference facts; a template can be customized or reset through its storage API without changing the stable process-key catalog. Custom text belongs to the user who saved it and is not inferred from a current run.

Template resolution affects newly assembled context according to runtime lifecycle rules. Permission, storage limits, and destructive reset semantics are validated by the relevant tool.`,
  ),
  defineProcessPrompt(
    'asset-library-management',
    'Asset Library Management',
    'Guidance for importing and locating project assets.',
    `The asset library stores project binaries and metadata. \`asset.list\` exposes searchable asset records and \`asset.import\` accepts supported files through its schema. Assets can be images, video, audio, or other files referenced by canvas nodes, entity reference slots, and render outputs.

Asset metadata can include type, name, tags, source, hashes, dimensions, duration, and relationships. Asset identity is distinct from entity identity: an entity reference slot links a durable character, location, or equipment record to a selected asset.

File paths and binary content are untrusted inputs until tool validation completes. Import, deletion, ownership, storage, and destructive constraints are execution-time facts.`,
  ),
  defineProcessPrompt(
    'canvas-settings',
    'Canvas Settings',
    'Guidance for reading and updating canvas-scoped settings.',
    `Canvas settings are canvas-wide defaults exposed through \`canvas.getInfo\` and \`canvas.setSettings\`. Relevant fields include default providers, aspect ratio, visual style policy, layout preferences, and compatibility fields such as \`stylePlate\`.

\`visualStylePolicy\` is the canonical manual style draft; \`stylePlate\` is a compatibility mirror. Node-level provider and media records remain local overrides. Entity records and reference assets remain independent durable sources rather than canvas-setting text.

Settings changes alter later node creation and prompt assembly according to their field semantics. Current values, CAS state, authorization, and any destructive impact are validated at execution time.`,
  ),
];

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
    // Default seeding delegates through the repository.
    this.repo = new ProcessPromptRepository(this.db);
    this.seedDefaults(PROCESS_PROMPT_DEFAULTS);
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

  list(): ProcessPromptRecord[] {
    return this.repo.list().rows.filter((prompt) => this.defaults.has(prompt.processKey));
  }

  get(processKey: string): ProcessPromptRecord | null {
    return this.repo.get(processKey as ProcessPromptKey);
  }

  getEffectiveValue(processKey: string): string | null {
    return this.repo.getEffectiveValue(processKey as ProcessPromptKey);
  }

  setCustom(processKey: string, value: string): void {
    if (value.length > COMMANDER_GUIDE_LIMITS.maxProcessPromptChars) {
      throw new Error(
        `Process prompt must be at most ${COMMANDER_GUIDE_LIMITS.maxProcessPromptChars} characters`,
      );
    }
    this.repo.setCustom(processKey as ProcessPromptKey, value);
  }

  resetToDefault(processKey: string): void {
    this.repo.resetToDefault(processKey as ProcessPromptKey);
  }

  close(): void {
    this.db.close();
  }
}
