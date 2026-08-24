import { createRequire } from 'node:module';
import type BetterSqlite3 from 'better-sqlite3';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3') as typeof BetterSqlite3;

export interface PromptRecord {
  id: number;
  code: string;
  name: string;
  type: 'agent' | 'subagent' | 'system';
  parentCode: string | null;
  defaultValue: string;
  customValue: string | null;
}

export const PROMPT_TEMPLATE_DEFAULTS: Omit<PromptRecord, 'id'>[] = [
  {
    code: 'agent-system',
    name: 'Commander AI System Prompt',
    type: 'agent',
    parentCode: null,
    defaultValue: `<identity>
You are Commander AI for Lucid Fin, an AI film production desktop app. You control the app through tools.
</identity>

<facts>
- Treat tool results and persisted records as authoritative. Obtain record IDs and current state from tools; never invent them.
- Never fake success or silently hide a failure. Report the concrete outcome.
</facts>

<boundaries>
- Do not bypass Canvas authorization, revision/hash/CAS requirements, approvals, provider capabilities, budgets, cost limits, or destructive-operation guards.
- When a guard rejects a call, treat its structured result as authoritative and decide the next action from the available facts.
</boundaries>

<tools>
Call tool.get to browse available tools or load parameter schemas. Call guide.get to access domain knowledge, task-list guides, and process reference material when you need it. Tool schemas are authoritative for parameter structure.
</tools>

<language>
Detect and match the user's language. Tool names and JSON keys always English.
</language>`,
    customValue: null,
  },
  {
    code: 'domain-canvas-tools',
    name: 'Canvas Tools Reference (deprecated)',
    type: 'agent',
    parentCode: 'agent-system',
    defaultValue: `[DEPRECATED] Canvas tool schemas are now discovered via tool.get. This prompt record is kept for backwards compatibility with existing custom overrides but its default content is no longer injected.`,
    customValue: null,
  },
  {
    code: 'novel-to-script',
    name: 'Novel-to-Script Conversion',
    type: 'system',
    parentCode: 'agent-system',
    defaultValue: `Convert the provided prose text into a professional screenplay in Fountain format for Lucid Fin.

Goals:
- Turn narrative prose into production-ready screenplay structure.
- Preserve the story's intent, dramatic beats, chronology, and emotional progression.
- Make the result easy to save with script.manage and easy to break down later with the script-breakdown prompt for canvas.createNodes planning.

Rules:
- Extract scenes into proper scene headings using INT./EXT., location, and time of day.
- Convert narration into concise action lines written in present tense.
- Convert spoken material into CHARACTER and dialogue blocks.
- Use parentheticals only when they clarify delivery or blocking.
- Keep action visual and playable on screen. Remove purely literary wording that cannot be filmed.
- Preserve pacing, reversals, reveals, and scene purpose.
- If the source prose implies a transition, encode it through scene flow and action rather than overusing explicit transition lines.
- Keep character naming consistent across scenes.
- When a location, prop, or recurring visual motif matters for production planning, make it explicit in the screenplay action.

Output requirements:
- Output valid Fountain only.
- Do not include commentary, explanations, markdown fences, or JSON.
- The screenplay should be ready for script.manage. After saving, Commander can run script-breakdown to convert it into 10-15 second shot nodes for the canvas.`,
    customValue: null,
  },
  {
    code: 'character-extract',
    name: 'Character Extraction',
    type: 'system',
    parentCode: 'agent-system',
    defaultValue: `Analyze the provided text and extract all individually named characters for Lucid Fin production data.

For each character provide:
- name: the canonical character name
- role: protagonist | antagonist | supporting | extra
- description: one-sentence production summary of story function
- appearance: concrete physical description useful for casting and image generation
- personality: key personality traits and behavioral signals
- costumes: array of outfits, uniforms, signature wardrobe, or look variants mentioned or strongly implied

Rules:
- Extract only individually named characters. Do not create entries for unnamed groups such as guards, crowd, staff, villagers, or soldiers.
- Merge aliases and nicknames into one character when the text clearly refers to the same person.
- Keep descriptions concrete, visually useful, and concise.
- If appearance is not explicitly described, infer cautiously from direct context only. Do not invent extreme details without support.
- Distinguish stable identity traits from temporary wardrobe or scene-specific styling.
- Preserve relationship-relevant information when it affects production planning.

Output requirements:
- Output a JSON array only.
- Each object must be ready to map into entity.create fields.
- After extraction, Commander can call entity.create for each confirmed character, generate an entity-bound Canvas image node through Prompt Assembly, inspect it, and attach the accepted asset with entity.setRefImageFromNode.`,
    customValue: null,
  },
  {
    code: 'script-breakdown',
    name: 'Script Breakdown',
    type: 'system',
    parentCode: 'agent-system',
    defaultValue: `Break down the provided screenplay into a production-ready scene and shot plan for Lucid Fin.

The output will be used to drive canvas.createNodes, so think in terms of node creation, node hierarchy, edge flow, and preset-track planning.

Clip rules:
- Each image or video node should represent a 10-15 second clip.
- Do not plan a scene as one long node.
- Use a tree-structured breakdown: lead with essential dramatic beats, then supporting inserts, reactions, cutaways, transitions, and connective shots.
- If the script implies a long continuous shot, split it into clearly labeled sequential fragments that can be stitched in post.

For each scene include:
- sceneHeading: INT./EXT. LOCATION - TIME
- sceneSummary: concise production summary
- charactersPresent: array of character names
- locations: array of relevant locations
- estimatedSceneDurationSeconds
- shots: array

For each shot include:
- shotId: stable short identifier
- title: concise node title
- purpose: establish | action | dialogue | reaction | insert | transition | payoff
- shotType: ECU | CU | MCU | MS | FS | LS | ELS | OTS | POV
- angle: eye-level | high | low | dutch | overhead | underslung | profile | rear | frontal
- movement: static | pan | tilt | dolly | crane | orbit | handheld | steadicam | tracking | push-in | pull-out
- subjectAction: subject plus action only, suitable for node prompt text
- characters: array of character names appearing in shot
- equipment: array of equipment needs if clearly implied
- location: primary location name
- mood: primary emotional tone
- estimatedDurationSeconds: 10-15 unless there is a strong reason to be shorter
- parentShotId: null for major beats, otherwise the parent beat this shot supports
- dependsOn: array of prior shotIds when sequence matters
- presetTrackPlan: object describing suggested preset logic

Preset-track guidance:
- presetTrackPlan should propose reusable creative intent, not raw prose blobs.
- Include fields for templateSuggestion, plus suggested tracks such as camera, lens, look, scene, composition, emotion, flow, technical when they materially matter.
- Use templateSuggestion when a built-in shot template is a strong fit and should be applied with canvas.presetTracks (action: 'applyTemplate') before fine tuning.
- Use full track suggestions when the shot needs a custom configuration that should later be written with canvas.presetTracks (action: 'write').
- If the plan only needs a minor tweak to an existing node, prefer noting incremental entry edits rather than implying a full rewrite.

Output requirements:
- Output structured JSON only.
- The structure must be directly usable to create nodes and edges with canvas.createNodes and then decorate nodes with refs and preset-track tools.`,
    customValue: null,
  },
];

export class PromptStore {
  private db: BetterSqlite3.Database;
  private defaults = new Map<string, Omit<PromptRecord, 'id'>>();

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    for (const prompt of PROMPT_TEMPLATE_DEFAULTS) {
      this.defaults.set(prompt.code, prompt);
    }
    this.init();
  }

  private init(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS t_prompt_overrides (
        code TEXT PRIMARY KEY NOT NULL,
        customValue TEXT NOT NULL
      )
    `);
  }

  list(): PromptRecord[] {
    const overrides = new Map<string, string>();
    const rows = this.db
      .prepare('SELECT code, customValue FROM t_prompt_overrides')
      .all() as Array<{ code: string; customValue: string }>;
    for (const row of rows) {
      overrides.set(row.code, row.customValue);
    }

    let id = 1;
    return Array.from(this.defaults.values()).map((prompt) => ({
      id: id++,
      code: prompt.code,
      name: prompt.name,
      type: prompt.type,
      parentCode: prompt.parentCode,
      defaultValue: prompt.defaultValue,
      customValue: overrides.get(prompt.code) ?? null,
    }));
  }

  get(code: string): PromptRecord | undefined {
    const prompt = this.defaults.get(code);
    if (!prompt) return undefined;
    const row = this.db
      .prepare('SELECT customValue FROM t_prompt_overrides WHERE code = ?')
      .get(code) as { customValue: string } | undefined;
    return {
      id: 0,
      code: prompt.code,
      name: prompt.name,
      type: prompt.type,
      parentCode: prompt.parentCode,
      defaultValue: prompt.defaultValue,
      customValue: row?.customValue ?? null,
    };
  }

  resolve(code: string): string {
    const prompt = this.defaults.get(code);
    if (!prompt) throw new Error(`Prompt not found: ${code}`);
    const row = this.db
      .prepare('SELECT customValue FROM t_prompt_overrides WHERE code = ?')
      .get(code) as { customValue: string } | undefined;
    return row?.customValue ?? prompt.defaultValue;
  }

  setCustom(code: string, value: string): void {
    if (!this.defaults.has(code)) throw new Error(`Prompt not found: ${code}`);
    this.db
      .prepare(
        `INSERT INTO t_prompt_overrides (code, customValue) VALUES (?, ?)
         ON CONFLICT(code) DO UPDATE SET customValue = excluded.customValue`,
      )
      .run(code, value);
  }

  clearCustom(code: string): void {
    this.db.prepare('DELETE FROM t_prompt_overrides WHERE code = ?').run(code);
  }

  close(): void {
    this.db.close();
  }
}
