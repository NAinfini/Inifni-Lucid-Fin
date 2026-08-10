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
    `Entity reference images are durable identity assets the whole pipeline trusts. They are not hero posters or dramatic one-off frames. Your job is to build sheets the generator and downstream prompts can reuse across every shot.

Shared workflow — always, in order:
1. Read the entity record and its existing reference images. Know whether the current sheet is usable before regenerating.
2. Call the entity's \`.generateRefImage\` tool with the entity ID and Canvas ID. The composite prompt (entity appearance/description + canonical Canvas visual-style draft + layout) is ALWAYS generated automatically. If you pass a custom \`prompt\`, it is appended as supplementary instructions after the composite — use it only for this-sheet-only guidance the entity record does not capture (e.g. anti-collapse language, scale indicator, specific camera tweak). Otherwise omit.
3. Call ONE at a time. Verify the returned asset before triggering any follow-up.

When to regenerate vs leave alone (all entity types):
- Identity mismatch (wrong costume, wrong architecture, wrong silhouette, panels collapsed) → regenerate.
- Record just changed (appearance, material, condition) → regenerate, then re-run downstream nodes.
- Need a custom angle not on the canonical sheet → generate an \`extra-angle\`, do NOT regenerate the primary sheet.
- Sheet reads clean → leave it alone. It is the identity anchor; gratuitous regeneration churns downstream consistency.

What to write (custom prompt) vs what to let the record carry:
- Durable identity → entity record fields. The \`buildPrompt\` function assembles them automatically.
- Custom prompt → this-sheet-only guidance: extra anti-collapse language, scale indicator, camera tweak.
- Do NOT repeat record fields in the custom prompt (doubled descriptions fight auto-compiled text).
- Do NOT write scene, environment, story context, or characters into ref images. Ref images are studio-neutral / empty-scene.

Quality language — prefer process vocabulary over adjective piles:
- Materials: "brushed wool", "oiled leather", "chipped enamel edge", "cracked plaster", "rain-darkened wood".
- Lighting: "even studio softbox", "3-point neutral setup", "overcast north-facing skylight".
- Framing: "head-to-toe, no cropped feet", "true orthographic, no vanishing points".
- Forbidden in all ref-image prompts: "cinematic", "dramatic", "epic", "masterpiece", "8k", "hyperdetailed".

--- Characters ---

Slots: \`full-sheet\` (primary identity anchor) and \`extra-angle\` (custom views).

Full-sheet layout — one landscape image, two rows, six panels:
- Top row (~70% height): three full-body panels at identical scale — front, left profile, rear. Head-to-toe, feet grounded, arms slightly away from the body.
- Bottom row (~30% height): three head-and-shoulders expression panels — neutral, happy, angry. Same face, same hair, same lighting.
- Solid white background, flat even studio lighting, single character only, no props unless part of the costume.
- Keep panel count at six. 10-panel layouts collapse and drop the full-body row.

Call: \`entity.generateRefImage\` with \`{ type: "character", id: characterId }\` (view defaults to \`full-sheet\`).
Promote: \`entity.setRefImageFromNode\` or \`entity.setRefImage\`.

Pitfalls: sheet collapses to only expressions (reinforce "two rows, TOP row full-body at 70%"), top row cropped at waist, face drifts between panels, random background appears, extra character in panel.

--- Locations ---

Slots: \`bible\` (primary identity anchor), \`fake-360\` (pseudo-panorama), \`extra-angle\`.

Bible layout — one image, five tiles:
- Top half: large wide-establishing panel. Bottom half: four equal tiles (interior detail, atmosphere study, key angle 1, key angle 2). Clearly separated by neutral gutters.
- All slots: empty scene, no characters, no people, no figures.

Fake-360 layout — one image, 2x4 grid (eight panels), compass order 0°-315° at 45° intervals. Matching eye-level, time-of-day, weather.

Call: \`entity.generateRefImage\` with \`{ type: "location", id: locationId }\` (defaults to \`bible\`) or \`{ type: "location", id: locationId, view: { kind: 'fake-360' } }\`.
Promote: \`entity.setRefImageFromNode\` or \`entity.setRefImage\`.

Pitfalls: bible collapses to a single wide shot, fake-360 drifts in time-of-day between panels, random character appears, atmosphere tile becomes a realistic wide.

--- Equipment ---

Slots: \`ortho-grid\` (primary identity anchor) and \`extra-angle\`.

Ortho-grid layout — two rows x two columns = four panels, plus optional fifth inset for detail close-up:
- True orthographic projection in every panel — no perspective vanishing points.
- Panels: top-left front, top-right back, bottom-left left profile, bottom-right right profile.
- Solid white background, flat even studio lighting, single object. No hand/body unless needed for scale (use anonymous neutral silhouette).
- Keep panel count at four (plus optional inset). Six+ panels collapses to a single hero render.

Call: \`entity.generateRefImage\` with \`{ type: "equipment", id: equipmentId }\` (defaults to \`ortho-grid\`).
Promote: \`entity.setRefImageFromNode\` or \`entity.setRefImage\`.

Pitfalls: sheet collapses to a single hero render, background leaks in, multiple objects appear, orthographic shots show perspective distortion, scale unclear.

After generation (all entity types):
- Promote the best result via the entity's \`.setRefImageFromNode\` or \`.setRefImage\`.
- If results miss, describe the failure in one line and regenerate with corrective language targeting that specific failure. Do not retry blindly.
- Never silently accept a broken sheet. Downstream identity across the project depends on the primary sheet reading correctly.`,
  ),
  defineProcessPrompt(
    'image-node-generation',
    'Image Node Generation',
    'Prompt compilation rules for image nodes.',
    `Image nodes produce the actual frames the film ships. Your job is to compile ONE prompt that reflects the real frame — subject, action, environment, lighting, composition — from every piece of context attached to the node. Never send only the raw node prompt when more context exists.

Workflow — always, in order:
1. Call \`canvas.getNode\` on the target node. Read the current \`prompt\`, attached \`characterRefs\`, \`equipmentRefs\`, \`locationRefs\`, and any incoming text edges.
2. Call \`canvas.getInfo\` (once per session, not per node) if you need the full edge map. Use that to find connected text nodes that feed context into this image node.
3. Call \`canvas.presetTracks { action: 'read' }\` on this node to see what camera, lighting, style, and quality direction the preset system is already carrying. Do not duplicate those into the compiled prompt text.
4. If character / location / equipment refs are missing, stale, or wrong entity, fix them with \`canvas.setNodeRefs\` before generation. Generating against missing refs produces identity drift that is hard to correct later.
5. Compile one unified prompt that covers the five elements below. Order them however the provider and scene read best — the five elements are the checklist, not a rigid sequence. Optionally call \`canvas.previewPrompt\` to inspect a reference draft (node prompt + refs + preset tracks + connected text, with synergy and conflict diagnostics) — use it as input, not as the final answer; YOU write the final prompt.
6. If the user has not clarified a significant creative choice (style direction, mood shift, alternate costume), call \`commander.askUser\` BEFORE calling \`canvas.generation\`. Technical execution proceeds autonomously; creative direction does not.
7. Call \`canvas.generation\` with \`{ canvasId, action: 'start', nodeId, nodeType: 'image', prompt: <creative scene body> }\`. \`canvasId\` and \`action: 'start'\` are REQUIRED. The host deterministically adds the Canvas visual-style draft, references, preset constraints, and negative prompt; do not duplicate or attempt to replace them. Always pass \`nodeType: 'image'\` for process routing. Omit \`prompt\` to compile the body from node fields. Set \`wait=false\` for fire-and-forget; set \`wait=true\` only when the next tool call depends on the output.
8. Verify result. If generation fails or drifts, correct the specific failure, do not retry blindly.

Five elements (every compiled prompt should cover all five; order by what the frame needs to communicate first):
- Subject: who or what is in the frame, identifying marks, current pose or state.
- Action: what is happening, directional intent — omit for pure portraits.
- Environment: concrete place, time, ground plane, surrounding props — only what is actually visible.
- Lighting: describe light as something that moves through and interacts with the scene. "Low-angle afternoon sun slicing through louvers, warm bounce off pale walls" beats "dramatic lighting".
- Composition: framing, camera distance, lens feel, focal anchor. "Medium close, 50mm feel, subject centered, midground doorway recedes left".

Provider ordering:
- Generally lead with the subject so it stays prioritized, then composition, then style modifiers. Adjust based on what the frame needs to communicate first.

What to put in the compiled prompt vs where else it lives:
- Subject identity, costume, face → already carried by attached character refs. Do not re-describe. Just call the character by name and state what is different this shot (pose, injury, expression).
- Location geography, architecture → already carried by location refs. State only the part actually in the frame.
- Camera style (lens, film grain, grade, tone) → preset tracks carry this. Check \`canvas.presetTracks { action: 'read' }\` first; do not duplicate into prompt text.
- Scene-specific context (what the character is doing, what just happened, where the light is coming from) → THIS is what the compiled prompt is for.

Decision tree — which context shapes the prompt most?
- Node has a single strong text edge → treat that text as the scene brief, then filter down to what is visible in this frame.
- Node has multiple text edges → merge into one prompt, keep the most frame-relevant; drop off-frame context (audio cues, monologue, etc).
- Node has no text edges but rich entity refs → let refs carry identity; focus compiled prompt on action + environment + lighting.
- Refs missing, no text edges → STOP. Call \`canvas.setNodeRefs\` or ask the user what they want. Do not generate blind.

Quality guidelines:
- Avoid piling adjectives ("epic cinematic masterpiece, 8k, hyperdetailed, breathtaking, award-winning"). These destroy control and push models toward generic output.
- Do not repeat identity fields already carried by refs. That creates conflicts.
- Do not write style words that collide with preset tracks.
- Use the negative prompt field for things you want to avoid — it is always passed through to the provider.

Prompt length: aim for clarity over brevity. A well-written 30-word prompt can outperform a 100-word one, but do not artificially truncate when the scene requires detail. Let the scene complexity drive the length.

Common pitfalls — stop and fix if you catch any:
- Subject drifts from ref → check \`canvas.presetTracks { action: 'read' }\` for a conflicting style preset that is overriding ref; remove or update with \`canvas.presetTracks { action: 'updateEntry' | 'removeEntry' }\`.
- Environment ignores location ref → ensure the location ref is attached AND the compiled prompt names at least one concrete landmark from the location record.
- Too-flat lighting → add directional light language.
- Style collapses to generic "digital art" look → apply a shot template or color style via \`canvas.presetTracks { action: 'applyTemplate' }\` instead of stuffing style words in the prompt.

After generation:
- If multiple variants, call \`canvas.selectVariant\` to promote the chosen one. Do not silently leave variant[0] if it is wrong.
- If the result will be reused as an entity reference, pull it via \`*.setRefImageFromNode\`.
- If it needs a second pass with corrective prompt, describe the specific failure in one sentence and regenerate — not a blind retry.`,
  ),
  defineProcessPrompt(
    'video-node-generation',
    'Video Node Generation',
    'Prompt compilation rules for video nodes.',
    `Video nodes produce one shot — one beat, one action, one camera idea. Your job is to write the shot as a short, readable paragraph that tells the model what the camera sees and what happens in the frame. Think in three parts (stage, describe, land) but write it as flowing prose.

Workflow — always, in order:
1. Call \`canvas.getNode\` on the target node. Read \`prompt\`, attached \`characterRefs\` / \`equipmentRefs\` / \`locationRefs\`, and the node's first-frame / last-frame anchors if present.
2. Call \`canvas.getInfo\` (if not already cached) to find incoming text edges and connected image nodes that might be first-frame or last-frame references.
3. Call \`canvas.presetTracks { action: 'read' }\` to see what camera, lens, and motion direction presets are already carrying.
4. If the clip depends on continuity images (first-frame image or last-frame image), verify them with \`canvas.setVideoFrames\`. First-frame and last-frame roles MUST be explicit — a video model that guesses direction from ambiguous anchors will drift.
5. Compile ONE shot using the three-part thinking model below (stage, describe, land). Write it as natural prose — no SCENE/ACTION/BEAT labels. Optionally call \`canvas.previewPrompt\` to inspect a reference draft (refs + preset tracks + connected text, with synergy and conflict diagnostics) — use it as input, not as the final answer; YOU write the final shot.
6. If the user has not approved a significant creative or motion choice (pacing, cut strategy, alternate action), call \`commander.askUser\` first.
7. Call \`canvas.generation\` with \`{ canvasId, action: 'start', nodeId, nodeType: 'video', prompt: <creative shot body> }\`. \`canvasId\` and \`action: 'start'\` are REQUIRED. The host deterministically adds the applicable Canvas preservation/style policy, references, presets, and negative constraints; do not duplicate or replace them. Pass \`nodeType: 'video'\` for process routing. Omit \`prompt\` to compile the body from node fields. Set \`wait=true\` only when the next call depends on the output.
8. Verify result. Short duration first — generate a 3-5s version to lock motion, then expand only when motion is right.

Three-part structure (think the shot this way; write it as natural prose without labels):

Part 1 — stage the shot: Location + time-of-day + mood anchor in one short sentence. This is your opening sentence. E.g. "A rain-streaked warehouse at dusk, tense, low sodium light bleeding through broken skylights."

Part 2 — describe the shot: What the camera shows and what performers do, in present tense, in the order the model should render it. 2-4 sentences.
- Lead with the camera: "Camera pushes in slow". Then the performer: "Anna steps into the shaft of light, coat dripping". Then the beat inside the shot: "she raises her head; eyes find the audience".
- Use concrete verbs (step, lift, turn, collide, drop, reach) not abstractions (move, interact, respond).
- One shot = one camera idea + one performer arc + one beat resolution. If you need more, split into two video nodes.

Part 3 — land the shot: The moment the shot resolves, written as the closing sentence. E.g. "The take lands on her steady gaze, holding for one beat." or "The shot ends on the door slamming shut behind her."

Example compiled prompt (flowing prose, no labels): "A rain-streaked cobbled alley at night, wet, with neon reflections coloring the puddles pink and blue. Camera tracks forward at waist height, following Anna from behind. She walks steadily toward the far archway, her coat trailing water. Her left hand trails along the wall; her right hand clenches a folded letter. The shot ends as she reaches the archway and pauses, the letter still held in her fist."

i2v vs t2v decision tree:
- Node has a first-frame image → i2v (image-to-video). Staging can stay short (anchor image carries environment); description focuses on what moves; closing defines resolution.
- Node has BOTH first-frame and last-frame images → video model interpolates; description covers what happens BETWEEN. Keep anchors consistent or the model fights you.
- Node has no image anchor → t2v. Staging has to carry full environment load; description carries identity load. Consider generating an image node first, then linking as first-frame.
- Node is continuation of prior clip → use the prior clip's last frame as this clip's first frame via \`canvas.setVideoFrames\`.

Camera vocabulary (one move per shot):
- Dolly in/out, pan left/right, tilt up/down, tracking / follow, crane / jib, handheld (specify "subtle" or it becomes shaky), static.
- Combining more than one camera move per shot produces floaty results. Pick one; the performer can do the rest.

Duration strategy:
- 3-5s — motion test, lock action arc.
- 5-8s — final shot for most cuts.
- 8-10s — only when a single continuous beat needs it (oner). Most models degrade beyond 8s.
- If the action is more than one beat, SPLIT into two video nodes and connect as last→first frame.

Prompt length: aim for one flowing paragraph that covers all three parts. Let the scene complexity drive the length — a simple tracking shot may need 40 words, a complex oner may need 120. Write what the shot needs, no more.

Common pitfalls:
- The shot description reads like a paragraph summary instead of what's on screen → rewrite with concrete verbs and camera-first sentences.
- Two camera moves in one shot → drop to one; if both are necessary, split the shot.
- Identity drifts mid-clip → name the character in the prompt; refs alone do not force identity across motion.
- Motion too ambitious for duration → drop a beat or extend duration by 2s.
- SCENE/ACTION/BEAT labels leak into the prompt text → rewrite as natural prose. Labels are for thinking, not for the model.

After generation:
- Review for motion coherence first (does the beat land), identity second, environment third.
- If the clip becomes a continuation source, set its last frame as the next clip's first frame before that node generates.
- If result needs a re-pass, describe the specific failure ("Anna's coat ignored motion") and regenerate — not blind retry.`,
  ),
  defineProcessPrompt(
    'audio-generation',
    'Audio Generation',
    'Guidance for all audio generation (voice, music, SFX).',
    `Audio nodes produce voice lines, music cues, or sound effects. The \`audioType\` field (\`voice\` / \`music\` / \`sfx\`) routes the entire generation pipeline, so set it first.

Shared workflow:
1. Call \`canvas.getNode\` on the target audio node. Read \`prompt\`, current \`audioType\`, duration, providerId, and any attached refs.
2. Call \`canvas.setMediaParams\` with the correct \`audioType\` if not already set.
3. Check provider capability via \`provider.manage { action: 'getCapabilities' }\` (emotion-vector support, sample rate, duration limits, voice cloning, seamless loops).
4. Write the \`prompt\` following the type-specific anatomy below.
5. Call \`canvas.generation\` with \`{ nodeId, nodeType: 'audio', audioType: '<type>' }\`. Pass \`audioType\` explicitly.
6. Always listen to the result — audio failures are silent in transcript.

--- Voice ---

Voice nodes produce a single spoken line. The prompt IS the line; emotion is structured data.

Prompt anatomy:
- Spoken text — verbatim, exactly as the character says it.
- Bracketed delivery cues inline: "[whispered] I know you're there. [louder, half-turning] You can come out now."
- NOT in the prompt: "she sounds sad", "angrily" — emotion goes in the \`emotionVector\`, not prose.
- NOT in the prompt: scene context, who is speaking to whom. The model voices the text.

Emotion vector (\`canvas.setMediaParams\`): eight fields (\`happy\`, \`sad\`, \`angry\`, \`fearful\`, \`surprised\`, \`disgusted\`, \`contemptuous\`, \`neutral\`), each 0-1.
- Calm delivery: one field 0.5-0.7, others 0. Intense: one field 0.7-0.9, neutral 0.1-0.2.
- Conflicted (most interesting): two mid values + neutral fill. Flat narration: neutral 0.9.
- Do NOT max all fields to 1.0 (manic). Keep sum under ~1.2.
- Some providers ignore the vector silently — check capabilities. When unsupported, pre-bake emotion via bracketed cues.

Character voice continuity: lock provider + voiceId on first clip, reuse across the project. Store recurring voice facts on the character record, not in every prompt.
Provider gates: voice cloning, long-form (>30s), and advanced emotion vary by provider.

--- Music ---

Music nodes produce structural audio — a bed, a theme, a transition. The prompt describes structure and role, not story synopsis.

Prompt anatomy:
- Genre anchor: "Indie folk", "Synth-heavy cinematic score". One tag, not five.
- Structure: "Intro pad 8 bars, vocal enters bar 9, chorus at bar 17, outro fades from bar 33".
- BPM + key when known: "85 BPM, A minor".
- Texture and mix role: "sparse, vocals forward, bed underneath" or "dense, wall-of-sound, no single lead".
- Instrumentation: "fingerpicked acoustic guitar, upright bass, brushed snare, no piano".
- Vocal direction if applicable: "breathy female vocal, lower register, no harmonies" or "instrumental only".
- Scene mood → hint only ("music for a quiet goodbye"), not a story synopsis.

Duration: 15-30s short cue, 30-60s standard, 60-120s multi-section (degrades), 120s+ split into sections. Set via \`canvas.setMediaParams\`, not prose.

--- SFX ---

SFX nodes produce physical sound events or ambience loops. Layers beat blobs.

Prompt anatomy:
- Object: "Heavy wooden door". Action: "Slams closed". Environment acoustics: "Stone corridor with long reverb tail".
- Layer list (optional but powerful): comma-separated sub-events in time order. "Metal on metal impact, short metallic ring, debris skitter aftermath".
- Mix role: "foreground hit, no music bed" or "background ambience bed, seamless loop".

Foley vs ambience: single event (hit, footstep) → foley (3-8s, layers matter). Continuous environment (room tone, forest) → ambience (15-30s, looped). Character-made sound → foley with character ref. Non-diegetic (whoosh, riser) → foley, dry environment.

Environment acoustics vocabulary: dry/anechoic, small room (~0.3s reverb), large room (~0.8-1.5s), cathedral (2-4s+), outdoor (no reflections, wind bed), underwater (muffled, high frequencies absent).
Duration: foley hits 1-5s, sustained 5-15s, ambience loops 15-30s. Over 30s most providers degrade — layer two clips.

Common pitfalls (all audio types):
- Voice: prompt describes the scene instead of the line → rewrite to verbatim spoken text. Emotion in prose instead of vector → move to \`emotionVector\`. Line exceeds provider duration → split across nodes.
- Music: prompt is a story synopsis → rewrite around structure, BPM, texture. Genre stacking → pick one primary genre + one texture hint. Requested vocals on instrumental-only provider → switch provider.
- SFX: one-word prompt ("footsteps") → expand with surface, weight, environment, layers. Emotional adjectives ("scary") → describe physical sound instead. Wrong acoustic environment → lock environment first.
- All: always listen. If delivery or mix is wrong, adjust params/prompt targeting the specific failure — do not retry blindly.

After generation:
- Promote selected variants via \`canvas.selectVariant\`.
- Voice failures → adjust \`emotionVector\` or bracketed cues before rewriting text.
- Music mix fights dialogue → regenerate with corrected mix-role language.
- SFX acoustic mismatch with neighboring shots → re-prompt with correct environment.`,
  ),
  defineProcessPrompt(
    'node-preset-tracks',
    'Node Preset Tracks',
    'Guidance for node-level preset track operations.',
    `Preset tracks carry reusable cinematic grammar on each node — camera, lens, look, scene, composition, emotion, flow, technical. The goal is a readable category stack downstream compilation can trust without duplicating prompt text. Scene-specific facts never belong on a preset track.

Workflow — always, in order:
1. Call \`canvas.presetTracks { action: 'read' }\` on the node first. Know what is already there before changing anything. Never overwrite blind.
2. Identify which of the 8 categories you need to touch: \`camera\`, \`lens\`, \`look\`, \`scene\`, \`composition\`, \`emotion\`, \`flow\`, \`technical\`. Stay inside these — any other category name is invalid.
3. Decide whether this is a surgical edit (one or two entries inside one category) or a grouped rewrite (multiple categories moving together).
4. Pick the right tool:
   - \`canvas.presetTracks { action: 'addEntry' }\` — add one entry to one category.
   - \`canvas.presetTracks { action: 'updateEntry' }\` — modify one existing entry inside a category.
   - \`canvas.presetTracks { action: 'removeEntry' }\` — remove one entry.
   - \`canvas.presetTracks { action: 'write' }\` — overwrite the full track set for one node, one or more categories at once.
   - \`canvas.presetTracks { action: 'writeBatch' }\` — overwrite track sets on multiple nodes at once with the same payload (use for sequence-wide decisions).
5. Execute. For batch operations, verify the node list is correct before calling — these writes are not easily reversed.
6. Call \`canvas.presetTracks { action: 'read' }\` again after write if downstream reasoning depends on the final state.

Category quick reference:
- \`camera\` — viewpoint, movement, direction (front, over-shoulder, tracking-behind, dutch-angle). Not lens details.
- \`lens\` — focal length, aperture, distortion, depth-of-field feel. Not composition.
- \`look\` — grade direction, tonal bias, contrast curve, film emulation. Not color palette (that is color-style).
- \`scene\` — staging facts that recur across shots (time-of-day tendency, weather, set-dressing style). Not one-shot specifics.
- \`composition\` — framing, rule-of-thirds anchor, balance, leading lines. Not subject description.
- \`emotion\` — emotional anchor for this shot or sequence. Not character personality.
- \`flow\` — pacing, rhythm, movement continuity with neighbors. Not camera move.
- \`technical\` — hard technical constraints (resolution override, aspect-ratio override, negative-prompt patches). Not style.

Surgical vs grouped decision tree:
- Fixing one wrong entry in one category → \`canvas.presetTracks { action: 'updateEntry' }\` or \`canvas.presetTracks { action: 'removeEntry' }\`.
- Adding a new preset reference inside an existing stack → \`canvas.presetTracks { action: 'addEntry' }\`.
- Rewriting a single category wholesale (e.g. swapping all camera entries) → \`canvas.presetTracks { action: 'write' }\` with just that category.
- Applying the same camera+lens+look decision to 12 shots in a row → \`canvas.presetTracks { action: 'writeBatch' }\`. Faster and atomic.
- Replacing the entire track set across categories → \`canvas.presetTracks { action: 'write' }\` with all affected categories.

What goes on tracks vs elsewhere:
- Reusable camera/lens/look/composition grammar → tracks. These are the point of the system.
- Subject identity (who, what they wear, their face) → character / location / equipment refs, not tracks.
- Scene-specific action (what happens in THIS shot) → the node prompt, not tracks.
- Color palette and grade behavior → color-style record, referenced by \`look\` track entry or \`colorStyle.manage\`.
- Shot structure (composition + camera + lens as a bundle) → shot template, not repeated per-node.

Category-stack hygiene — keep it readable:
- One dominant decision per category. Stacking 5 \`look\` entries with slightly different directions fights itself.
- No duplicate entries across categories. Do not put "cinematic rim light" in both \`look\` and \`composition\`.
- No scene-specific text. "Anna's emotional baseline: melancholic" goes on the character record or node prompt. \`emotion\` track carries shot-level emotional anchor only.
- Empty categories are fine. Do not stuff filler entries just to "complete" the stack.

Common pitfalls:
- Writing scene-specific facts into \`scene\` track → move to node prompt. \`scene\` track is for recurring stage grammar only.
- Overlapping \`look\` and color-style decisions → pick one layer; do not write the same grade in two places.
- Batch writing the wrong node list → always verify IDs; undo requires manual reversal.
- Track entries copied from node prompt → if it repeats the prompt, the downstream compile will double-write it. Remove.
- Forgetting to re-read after batch write → leads to stale reasoning. Always re-read before the next decision in the same session.

After writing:
- If the change affects downstream generation, regenerate affected nodes. Track edits do not retroactively change generated assets.`,
  ),
  defineProcessPrompt(
    'preset-definition-management',
    'Preset Definition Management',
    'Guidance for preset creation and maintenance.',
    `Preset definitions are reusable building blocks in the preset library — one record per preset, typed to one category, composable with other presets on any node. Treat them as durable cinematic grammar, not one-off prompt dumps.

Workflow — always, in order:
1. Call \`preset.manage\` to see existing presets in the relevant category before creating. Filter or scan the output so you do not duplicate an existing entry.
2. If editing, call \`preset.manage\` first to read the current state. Do not write blind.
3. Make the change:
   - \`preset.manage { action: 'create' }\` — add a new definition. Confirm the pattern is durable (recurs across shots), not a one-scene exception.
   - \`preset.manage { action: 'update' }\` — modify an existing entry. Keep the category stable; migrating a preset across categories is its own decision.
   - \`preset.manage { action: 'delete' }\` — remove an unused or superseded entry. Confirm no node currently references it (check preset track entries) before deleting.
   - \`preset.manage { action: 'reset' }\` — restore a built-in preset to its factory defaults. Use when a user has edited a built-in and wants the original back.
4. Verify by calling \`preset.manage\` on the edited preset, or \`preset.manage\` to confirm the library list is correct.

Good preset definitions share these traits:
- Compact. One focused intent per entry. "Morning-side 45-degree sun, warm bounce" beats "Cinematic morning feel with nice light".
- Typed to one category. A \`look\` preset talks about grade. A \`camera\` preset talks about viewpoint. Do not smuggle camera-direction instructions into a \`look\` entry.
- Reusable. The same preset should attach cleanly to 3+ nodes across the project. If it only fits one shot, it is not a preset — keep it on the node.
- Explicit about what it owns. "This preset sets the color grade only; composition and lighting are untouched." Prevents collision with other preset entries on the same node.
- Free of scene-specific story content. No character names, no scene numbers, no plot references inside the preset body.

Category placement table:
- Camera viewpoint, angle, movement direction → \`camera\`.
- Focal length, lens character, depth-of-field feel → \`lens\`.
- Grade, tonal curve, film emulation → \`look\`.
- Recurring stage grammar (time-of-day tendency, weather language) → \`scene\`.
- Framing, rule-of-thirds, balance pattern → \`composition\`.
- Shot-level emotional anchor (tense, melancholic, contemplative) → \`emotion\`.
- Pacing and movement continuity language → \`flow\`.
- Hard technical overrides (resolution, aspect ratio, negative-prompt additions) → \`technical\`.

Review-before-create checklist:
- Is there already a preset that captures 80% of this? Extend or duplicate-with-tweak rather than add another near-identical entry.
- Does this pattern recur across multiple shots or just one? If one, keep it on the node prompt instead.
- Does the wording read as cinematic grammar or scene narration? Rewrite until it is grammar.
- Is the category choice the cleanest fit? If two categories feel plausible, the preset is probably too broad — split into two focused presets.

Preset body length: keep presets focused on their category concern. Very short presets tend to be too vague; very long presets usually contain scene-specific content that should live in the node prompt instead.

Common pitfalls:
- Near-duplicate of an existing preset → refine the existing one instead of adding another; library bloat makes selection harder.
- Category drift (updating a \`look\` entry to include camera-direction text) → split into two presets.
- Scene-specific body text ("the warehouse scene's moody light") → rewrite into reusable grammar ("warehouse-style moody light: low-angle sodium source, long shadows, dust haze").
- Deleting a preset that is still referenced on nodes → broken node tracks; always check references first.
- Using \`preset.manage { action: 'reset' }\` on a user-created preset (the tool only resets built-ins) → wrong tool; use \`preset.manage { action: 'update' }\` to restore an older version.

After editing:
- If downstream nodes reference this preset, they will use the new version on next generation. Existing generated assets do NOT retro-update — regenerate if the change must land.`,
  ),
  defineProcessPrompt(
    'shot-template-management',
    'Shot Template Management',
    'Guidance for shot template creation and application.',
    `Shot templates package a bundle of preset grammar (camera + lens + composition, sometimes look and flow) that can be applied across nodes with one call. They accelerate shot planning by injecting reusable framing + motion structure while leaving node-specific subject and action untouched.

Workflow — always, in order:
1. Call \`shotTemplate.manage { action: 'list' }\` to see existing templates before creating. Confirm there is not already a template that covers 80% of this pattern.
2. If editing, call the list or detail read to see the current bundle.
3. Make the change:
   - \`shotTemplate.manage { action: 'create' }\` — add a new template. Confirm the bundle represents a durable, recurring pattern across shots.
   - \`shotTemplate.manage { action: 'update' }\` — modify an existing template's bundled tracks.
   - \`shotTemplate.manage { action: 'delete' }\` — remove a template. Verify it is not the only source of a recurring framing before deleting.
4. To apply: call \`canvas.presetTracks { action: 'applyTemplate' }\` on a single node or on a \`nodes\` array for batch application. The template's track set overlays onto the node; node-specific subject, action, and entity refs are preserved.
5. Verify by calling \`canvas.presetTracks { action: 'read' }\` on an affected node to confirm the template's tracks landed where expected.

Good shot templates share these traits:
- Bundle cinematic grammar, not subject identity. Camera angle, lens feel, composition pattern, flow into neighboring shots — yes. Character description, location specifics, scene context — no.
- Durable. The template should apply cleanly to 5+ shots across the project. If it only fits two, keep the pattern on individual nodes.
- Composable. A shot template should layer with color-style and per-node preset edits without fighting them. Avoid templates that try to own all 8 categories — they become blunt instruments.
- Explicit about what it changes. "This template sets camera, lens, and composition; look and emotion are left to the node." So users know what will be overwritten when they apply it.
- Free of scene story content. No character names, no episode numbers, no plot references.

What to bundle vs what to leave out:
- Bundle: \`camera\` (viewpoint, motion direction), \`lens\` (focal feel), \`composition\` (framing pattern), optionally \`flow\` (pacing cue).
- Leave out: \`look\` (usually owned by color-style), \`scene\` (usually owned by location record + node prompt), \`emotion\` (usually shot-specific), \`technical\` (usually provider-specific, not shot-specific).
- Exceptions are fine but flag them in the template name so users know what they get.

Template naming and discoverability:
- Name by shot grammar, not by scene. "Medium-close over-shoulder, 50mm, push-in" beats "Act 2 confrontation shot".
- Include the primary camera decision in the name so \`shotTemplate.manage { action: 'list' }\` is scannable.

Apply-vs-write decision tree:
- Same 4-5 shots share a framing pattern → one \`shotTemplate.manage { action: 'create' }\` + one \`canvas.presetTracks { action: 'applyTemplate' }\` per shot (or batch via \`nodes\` array).
- One-off shot with a unique framing → do not create a template. Write tracks directly with \`canvas.presetTracks { action: 'write' }\`.
- Need to tweak a template for one shot after applying → apply the template, then \`canvas.presetTracks { action: 'updateEntry' }\` on the node for the local change. Do not fork the template for one deviation.
- Template needs to replace a whole bundle across 12+ nodes → batch apply via \`canvas.presetTracks { action: 'applyTemplate' }\` with a \`nodes\` array is atomic and safer than 12 sequential calls.

Common pitfalls:
- Template bundles character or scene identity → strip to grammar-only; identity belongs on entity records.
- Template owns too many categories → split into two narrower templates or keep as node-level edits.
- Name is scene-specific → rename to grammar-first so it is reusable and discoverable.
- Applying a template that conflicts with a pre-existing node edit → the application overwrites matching categories; check \`canvas.presetTracks { action: 'read' }\` before applying if the node has custom edits you want to preserve.
- Deleting a template referenced in an active template-apply workflow → breaks that workflow; check usage first.

After applying:
- Affected nodes will use the new track set on next generation. Existing generated assets do NOT retro-update — regenerate if the change must land.`,
  ),
  defineProcessPrompt(
    'color-style-management',
    'Color Style Management',
    'Guidance for color style creation and maintenance.',
    `Color styles own palette logic, contrast behavior, material response, and grade direction in reusable form. They are the project's visual continuity layer — one style per look family, referenced by nodes via preset \`look\` entries or directly by generation pipelines that support it.

Workflow — always, in order:
1. Call \`colorStyle.manage { action: 'list' }\` to see existing styles before creating. Confirm there is not already a style that covers 80% of this look direction.
2. To create or update: call \`colorStyle.manage { action: 'save', style }\`. The \`save\` action upserts by id (create if new, update if existing).
3. To delete: call \`colorStyle.manage { action: 'delete', id }\`. Verify no active nodes or templates reference the style before removing.
4. Verify by listing again, or by applying to a test node and generating a single image.

Good color styles describe relationships, not taste words:
- Palette anchors: 2-4 key colors with roles. "Warm ochre highlights, cool slate shadows, one accent red on props". Not "moody colors".
- Saturation ceiling: where saturation peaks before it reads as cartoonish. "Highlights pushed to 70% saturation max, shadows desaturated toward neutral".
- Contrast curve: how the tonal range is shaped. "Crushed shadows with lifted blacks to retain detail, bright highlights without clipping" or "S-curve, punchy midtones, skin tones protected".
- Temperature bias: overall color-temperature lean. "Cool 5600K base with warm 3200K practicals layered in" or "Uniform warm daylight, 4200K".
- Highlight rolloff: soft vs hard. "Filmic soft rolloff, no digital clipping" or "Harsh clipped highlights intentional, video-camera aesthetic".
- Shadow density: deep vs lifted. "Deep inky shadows with hue bias toward cool teal" or "Lifted gray shadows for overcast-softness look".
- Material response: how common materials read under this grade. "Skin tones stay warm and natural; metals read cool; foliage leans yellow-green".
- Texture response: grain, softness, sharpness. "Light film grain in shadows only" or "Clean digital, no grain".

What belongs on the color style vs elsewhere:
- Reusable palette + grade behavior → color style record. This is the point.
- Scene-specific lighting decisions (this shot is a blue-hour exterior) → node prompt. Color style provides the grammar; the scene applies it.
- Camera-specific color characteristics (sensor-native green cast) → \`lens\` or \`technical\` preset, not color style.
- Character skin tone preferences → character record. Color style should not override character identity.

Style library hygiene:
- One style per durable look family. "Warehouse noir", "Sunlit kitchen", "Neon wet street" — each a distinct family.
- No scene-specific content in the style record. "Ben and Anna's confrontation" is a scene, not a style. Rename to "Warehouse noir" if that is what the scene needs.
- Layerable with presets and shot templates. Style carries grade + palette; shot template carries camera + lens + composition; node prompt carries action + subject. Three clean layers.
- Compact. 80-200 words per style body. Over 300 and scene content is leaking in.

Decision tree — new style vs extend existing?
- Look covers 80%+ of an existing style's description → extend the existing style via \`colorStyle.manage { action: 'save' }\` reusing its id (update path).
- Look is a variant of an existing style (warmer / cooler version) → create as new style; name it to reveal the relationship (e.g. "Warehouse noir — dawn variant").
- Look is a one-shot experiment not expected to recur → keep it on the node prompt instead. Do not clutter the library.
- Look is for a specific character (e.g. dream sequences) → create as new style; name it after the grammar, not the character or sequence.

Common pitfalls:
- Taste-word bodies ("warm cinematic vibes, beautiful shadows") → rewrite as relationships (palette anchors, saturation ceiling, contrast curve).
- Scene context leaking in → strip until only grammar remains.
- Too many near-duplicate styles → consolidate; library bloat makes downstream selection harder.
- Color style overwriting character skin tone → add explicit "skin tones stay natural" clause if skin was getting pushed.
- Deleting a style referenced by active nodes → their \`look\` preset references become orphans; re-check references before deleting.

After editing:
- Existing generated assets do NOT retro-update. Regenerate affected shots if the new style must land.`,
  ),
  defineProcessPrompt(
    'entity-management',
    'Entity Management',
    'Guidance for entity (character, location, equipment) CRUD work.',
    `Entity records are durable identity sources. The whole pipeline reads from them — ref-image generation, node prompt compilation, voice direction, continuity checks. Write them with care, because fixing identity drift after many generated assets is painful.

Shared workflow — always, in order:
1. Call \`entity.list\` with the appropriate \`type\` (character/location/equipment) to see what already exists. Look for near-duplicates by name, role, type, or subtype before creating.
2. For edits, read the current record first (via list or context-surfaced id). Never write blind.
3. Pick the right tool: \`.create\` (new entity), \`.update\` (modify existing — surgical field edits are fine; large rewrites need user direction), \`.delete\` (remove — verify no node or loadout references it first).
4. For reference images, use the entity's ref-image tools (\`.generateRefImage\`, \`.setRefImage\`, \`.deleteRefImage\`, \`.setRefImageFromNode\`) — see the entity-ref-image-generation process guidance.

Shared field-placement rules:
- Durable identity → entity record. One-shot pose, blocking, transient weather, or specific camera angle → node prompt. Never bake transient state into the record.
- Reference images → \`referenceImages\` array on the record, populated via ref-image tools.
- Fill structured fields whenever info exists — downstream ref-image compilation reads them. Empty structured fields weaken ref-image quality.
- Use explicit, concrete language. Process vocabulary beats taste words.

--- Character-specific ---

Key fields: role, description, appearance, personality, face, hair, skinTone, body, distinctTraits, vocalTraits, costumes, loadouts.
- \`description\` is who they are in the story; \`appearance\` is how they look. Do not mix.
- \`personality\` is behavior grammar ("stoic under pressure, dry humor"), not a backstory monologue.
- \`distinctTraits\` must be image-visible and stable. "Prosthetic left hand" yes; "believes in fate" no.
- Costumes → \`costumes\` array. Equipment loadouts → \`loadouts\` array. \`defaultLoadoutId\` applies when no specific loadout is set on a node.
- Recurring emotional baseline → \`personality\`. Shot-level emotion → node prompt.

--- Location-specific ---

Key fields: locationType (interior/exterior/int-ext), subLocation, description, architectureStyle, mood, weather, lighting, timeOfDay, dominantColors, keyFeatures, atmosphereKeywords.
- Set \`locationType\` — ref-image defaults read layout from it. (Do not use the top-level \`type\` field for this; \`type\` is the domain discriminator and must be \`location\`.)
- \`description\` is narrative role; \`mood\` is emotional grammar; \`atmosphereKeywords\` are short evocative tags. Keep them distinct.
- \`keyFeatures\` must be image-identifiable landmarks. "Stained glass window above the entrance" yes; "history of conflict" no.
- Repeat camera angles → captured as key-angle ref slots, not in presets.

--- Equipment-specific ---

Key fields: equipmentType, subtype, description, function, material, color, condition, visualDetails, tags.
- Set \`equipmentType\` — ref-image defaults read the object category from it. (Do not use the top-level \`type\` field for this; \`type\` is the domain discriminator and must be \`equipment\`.)
- \`function\` is mechanical ("fires via gas-operated bolt"); \`description\` is narrative ("the rifle Anna took from her father"). Do not mix.
- \`visualDetails\` must be image-identifiable and stable. "Chipped enamel on the bolt" yes; "hand-made by her father" no.
- \`condition\` is baseline wear, not a story beat. Per-shot damage goes on the node prompt.
- Character association → character record's \`loadouts\` array, not on the equipment record.

Common pitfalls (all entity types):
- Baking one-shot state into the record → move to node prompt.
- Vague taste-word fields → rewrite with concrete detail.
- Near-duplicates → check list output carefully; consolidate rather than fork.
- Deleting an entity referenced by active nodes or loadouts → orphan refs. Check first.
- Skipping structured fields when info exists → fill them; the ref-image system uses them.
- Missing \`locationType\` on locations or \`equipmentType\` on equipment → ref-image defaults misread; always set it.

After editing:
- Existing generated assets do NOT retro-update. If a change affects identity, regenerate affected nodes (or at minimum regenerate the entity's primary ref-image first).
- If a character costume/loadout changed, review node refs that use this character. If location lighting/weather changed, coordinate regeneration across dependent scenes. If equipment in a shared loadout changed, coordinate across shots.`,
  ),
  defineProcessPrompt(
    'canvas-structure',
    'Canvas Structure',
    'Guidance for canvas creation and structural organization.',
    `Canvas structure covers the canvas itself and the nodes on it — creating nodes, batch-creating whole subgraphs, duplicating, renaming, deleting, adding notes and backdrops, importing and exporting workflows. This is the skeleton of the film.

Workflow — always, in order:
1. Call \`canvas.getInfo\` once per session (metadata + edges) to orient. Use \`canvas.listNodes\` for paginated node scans (filterable by type or query). Use \`canvas.getNode\` for full detail, single id or batch \`nodeIds\` array.
2. Decide single-node vs batch before calling tools:
   - One node → \`canvas.createNodes\`.
   - Multiple nodes with edges → \`canvas.createNodes\` in one call (atomic, faster, fewer round-trips).
   - Copy an existing structure → \`canvas.duplicateNodes\` (returns new ids).
3. For canvas-level ops: \`canvas.manage\` (rename), \`canvas.deleteCanvas\` (destructive — verify before calling), \`canvas.importWorkflow\` / \`canvas.exportWorkflow\` (subgraph I/O).
4. For annotations: \`canvas.addNote\`, \`canvas.updateNote\`, \`canvas.deleteNote\`, \`canvas.manage { action: 'updateBackdrop' }\`.
5. Verify by re-reading \`canvas.getInfo\` or \`canvas.listNodes\` when downstream reasoning depends on the final state.

Single-node vs batch decision tree:
- Creating one image node for a quick test → \`canvas.createNodes\`.
- Creating a full scene (text brief + image + video chain) → \`canvas.createNodes\` with nodes + edges in one payload. Atomic. Fewer failure modes.
- Creating 12 shots with identical structure → \`canvas.createNodes\` once; do NOT loop 12 \`canvas.createNodes\` calls.
- Duplicating an existing shot structure for a new scene → \`canvas.duplicateNodes\` with the source \`nodeIds\`; faster than reconstructing.
- Importing a known workflow template → \`canvas.importWorkflow\`.

Scene assembly patterns (batchCreate):
- Text-driven scene: text node (scene brief) → image node (establishing frame) → video node (first shot). Edges: text→image, image→video (as first-frame anchor).
- Image-first scene: image node → image node (variant angle) → video node. Edges chain left-to-right.
- Video chain: first-frame image → video node → last-frame image → next video node → last-frame image ... Each video reads first-frame from its upstream image and exports a last-frame image for the next.
- Parallel coverage: one image node per coverage angle (wide / medium / close), all attached to the same text brief upstream.

Notes and backdrops:
- \`canvas.addNote\` — freeform text annotation; useful for director notes, reminders, TODO markers. Notes do NOT participate in generation.
- \`canvas.manage { action: 'updateBackdrop' }\` — visual grouping behind nodes; change color, padding, opacity, border, title size, lock-children. Use for act breaks, scene groups, workflow sections.
- Backdrops are structural grouping, not generation context. Nodes inside a backdrop are not automatically connected to each other.

Workflow import/export:
- \`canvas.exportWorkflow\` — save a subgraph as a reusable workflow template (structure + edges, no generated assets).
- \`canvas.importWorkflow\` — drop a saved workflow into the current canvas. Useful for repeatable shot patterns (e.g. "dialogue coverage template").
- Imported workflows inherit the canvas's provider defaults and preset tracks; re-apply shot templates or preset edits as needed.

Destructive-op gates:
- \`canvas.deleteCanvas\` → confirm with the user before calling. This removes the entire canvas, not a node.
- \`canvas.deleteNode\` with a node referenced by upstream/downstream edges → edges break; consider whether to delete the edges first or let the cascade happen.
- Mass batchCreate with wrong providerId or wrong refs → many broken nodes to clean up. Verify a smaller batch first if you are unsure.

Common pitfalls:
- Using \`canvas.createNodes\` in a loop when \`canvas.createNodes\` would do it in one call → slow, more failure modes, less atomic.
- Creating nodes without edges and then forgetting to connect them → orphan nodes the video pipeline cannot use. Prefer \`canvas.createNodes\` so edges are declared together.
- Forgetting to set refs after node creation → generation falls back to naive prompt-only; set refs with \`canvas.setNodeRefs\` as part of the setup pass.
- Deleting a canvas thinking it was a node → \`canvas.deleteCanvas\` is project-level; \`canvas.deleteNode\` is node-level. Do not confuse.
- Importing a workflow into the wrong canvas → verify you are on the correct canvas before importing.

After structural changes:
- Re-read state if downstream decisions depend on final node ids — \`canvas.createNodes\` returns ids, but multi-step flows should still confirm with \`canvas.listNodes\` or \`canvas.getInfo\`.
- If the change removes nodes that were referenced by character loadouts or entity refs, those refs may now be orphans — audit afterwards.`,
  ),
  defineProcessPrompt(
    'canvas-graph-and-layout',
    'Canvas Graph And Layout',
    'Guidance for edges, ordering, and layout operations.',
    `Canvas graph-and-layout covers edges between nodes, layout positioning, and video frame anchors. This is the wiring of the film — how shots connect, how footage flows, how the graph is arranged for human readability.

Workflow — always, in order:
1. Call \`canvas.getInfo\` or \`canvas.listEdges\` (paginated) to see the current edge set.
2. For edges: pick the right tool:
   - \`canvas.connectNodes\` — add an edge from source to target.
   - \`canvas.manageEdge { action: 'delete' }\` — remove one edge.
   - \`canvas.manageEdge { action: 'swap' }\` — flip the direction of an existing edge.
   - \`canvas.manageEdge { action: 'disconnect' }\` — remove all edges attached to one node in one call. Faster than multiple \`deleteEdge\` calls.
3. For video-specific frame anchoring: \`canvas.setVideoFrames\` locks the first-frame and last-frame image roles on a video node. Always use explicit roles — a video model that guesses direction from an ambiguous edge will drift.
4. For layout: \`canvas.layout\` runs the auto-layout on the canvas (or a subset). Call when the graph has grown disorganized or after a large \`canvas.createNodes\`.
5. Verify by re-reading \`canvas.getInfo\` or \`canvas.listEdges\` when reasoning depends on the final state.

Edge semantics — know what each direction means:
- Text → image: the text feeds scene brief into image generation.
- Image → image: the upstream image is a reference or edit source for the downstream image (pipeline-dependent).
- Image → video (first-frame): the image becomes the video's starting frame. Use \`canvas.setVideoFrames\` to lock the role explicitly.
- Video → image (last-frame): the video's final frame becomes a new image node. Again, lock with \`canvas.setVideoFrames\`.
- Audio edges: audio nodes can attach to image or video for timing; pipeline-specific.

Video frame anchor workflow:
- A video node with ONE upstream image → \`canvas.setVideoFrames\` locks that image as first-frame. Video model does i2v.
- A video node with TWO upstream images → \`canvas.setVideoFrames\` locks one as first-frame and the other as last-frame. Video model interpolates between them. Explicit role assignment is REQUIRED — ambiguous edges produce drift.
- Video chain (video → image → video): the middle image is the last-frame of the upstream video and the first-frame of the downstream video. Lock both roles via \`canvas.setVideoFrames\` on the respective video nodes.
- No upstream image → t2v (text-to-video). Frame anchors are not applicable; the video generates from prompt alone.

Layout patterns:
- Left-to-right story flow → scenes arrange horizontally, each scene's nodes stack vertically below the scene header.
- Coverage clusters → wide/medium/close nodes arranged in a tight cluster with edges fanning out.
- Video chains → horizontal chain of image-video-image-video, left to right, so the director can read the flow visually.
- Backdrops organize sections (act breaks, scene groups); layout should respect backdrop boundaries when running \`canvas.layout\`.

Connection hygiene:
- Every node should have a reason to exist on the canvas. Orphan nodes (no edges) that are not intentional drafts are noise.
- Edges carry context; missing edges mean the downstream node falls back to naive prompt-only generation. Audit edge coverage before generating a sequence.
- \`canvas.manageEdge { action: 'swap' }\` is rarely needed and often means the original edge was created in the wrong direction — prefer to delete and re-create cleanly.

Common pitfalls:
- Video node with ambiguous first/last frame roles → always call \`canvas.setVideoFrames\` explicitly even when the edge topology "looks obvious". Models do not see the edge semantics.
- Disconnecting one edge at a time when \`canvas.manageEdge { action: 'disconnect' }\` would clear all → slower, more failure modes.
- Running \`canvas.layout\` before the graph is structurally complete → layout re-runs can be needed after further edits; batch layout after major structural work.
- Leaving video chains without last-frame anchors → continuity breaks between clips.
- Creating edges between incompatible node types (audio → image, backdrop → anything) → pipeline ignores or errors; check the type pair before connecting.

After edge changes:
- Re-read \`canvas.getInfo\` if downstream generation depends on the edge topology.
- Changes to video frame anchors do NOT retroactively re-render existing video nodes. Regenerate affected video nodes after re-anchoring.`,
  ),
  defineProcessPrompt(
    'canvas-node-editing',
    'Canvas Node Editing',
    'Guidance for node content, refs, and local edits.',
    `Canvas node-editing covers per-node mutations: content and prompt updates, layout changes, entity refs, variant selection, preview, undo/redo. This is the surgical toolkit for tweaking individual nodes without rebuilding the graph.

Workflow — always, in order:
1. Call \`canvas.getNode\` first to read the current state. Never write blind.
2. Pick the right tool:
   - \`canvas.updateNodes\` — change title, prompt, or content. Supports per-node \`nodes\` array for different values across multiple nodes in one call.
   - \`canvas.setNodeLayout\` — change position, bypassed state, locked state, colorTag. Supports batch \`nodeIds\`.
   - \`canvas.setNodeRefs\` — set or clear character/equipment/location refs. Supports per-node \`nodes\` array. Pass an empty array to clear a ref type.
   - \`canvas.selectVariant\` — when a generated node has multiple variants, promote the selected index to the primary output.
   - \`canvas.previewPrompt\` — compile and preview the prompt that would be sent on the next generation, without triggering generation. Useful for validating refs + preset tracks + text before spending tokens.
   - \`canvas.undo\` / \`canvas.redo\` — step back or forward through the canvas edit history.
3. Verify by re-reading with \`canvas.getNode\` when downstream reasoning depends on final state.

Per-node vs batch decision tree:
- Editing one node's prompt → \`canvas.updateNodes\` with a single update.
- Editing 12 nodes to the same new value (e.g. adding a scene tag to title) → \`canvas.updateNodes\` with a \`nodes\` array, same value — one call.
- Editing 12 nodes to different values (each gets a tailored prompt) → \`canvas.updateNodes\` with a \`nodes\` array, different values — still one call, one atomic write.
- Moving a block of nodes → \`canvas.setNodeLayout\` with a batch \`nodeIds\` array plus a common delta.
- Attaching the same character ref to 8 nodes → \`canvas.setNodeRefs\` with \`nodes\` array, same characterRefs payload.

Variant selection:
- Generation produces one primary output plus optional variants (when \`variantCount > 1\`). The node's \`selectedVariantIndex\` determines which variant the pipeline uses downstream.
- \`canvas.selectVariant\` promotes a specific index. Do this proactively — leaving \`selectedVariantIndex = 0\` silently is fine only if variant[0] is actually the chosen one.
- If none of the variants are acceptable, regenerate rather than selecting a bad variant.

Ref attachment rules:
- Attach refs for entities that are actually present in the intended frame. Do not attach a character ref "just in case" — it fights the prompt when the character is off-screen.
- Clear stale refs explicitly with an empty array when the scene changes.
- Use \`canvas.setNodeRefs\` rather than writing character/location/equipment names into the prompt — refs carry identity more stably than prose.

Preview before generate:
- \`canvas.previewPrompt\` compiles the final prompt from node prompt + refs + preset tracks + connected text edges. Use it to validate the compile before burning tokens on a failed generation.
- Catch compile-time problems here: missing refs, preset conflicts, truncated prompts from missing context.

Layout edits (setNodeLayout):
- \`position\` — move a node to specific canvas coordinates.
- \`bypassed\` — skip this node during generation runs (useful for A/B testing, temporarily disabling shots).
- \`locked\` — prevent accidental edits; lock a finalized node so downstream work does not clobber it.
- \`colorTag\` — visual category marker in the UI (no generation effect).

Undo / redo semantics:
- \`canvas.undo\` steps back through recent mutations on the canvas. The undo stack is bounded and scoped to the current canvas session.
- \`canvas.redo\` reverses a recent undo.
- Not all operations are undoable — destructive canvas-level ops (deleteCanvas) and some provider-side actions (generated assets, committed snapshots) are not reversible through undo. Check operation history if unclear.

Common pitfalls:
- Calling \`canvas.updateNodes\` in a loop for 12 nodes → use the \`nodes\` array in one call.
- Forgetting to call \`canvas.selectVariant\` when variant[0] is not the chosen output → downstream uses the wrong asset.
- Writing character or location names into the prompt instead of attaching refs → identity drifts, and refs are ignored because the prompt overrides.
- Over-attaching refs → pile-up of entity refs fights the scene. Attach only what is in frame.
- Using \`canvas.setNodeLayout\` to hide a node by moving it off-screen → use \`bypassed: true\` instead; layout moves can be confusing.
- Forgetting \`canvas.previewPrompt\` before expensive generations → wasted tokens on broken compiles.
- Over-relying on \`canvas.undo\` for complex multi-step reversals → undo is step-wise and has limits; for big reversals, a snapshot is safer.

After edits:
- Existing generated assets do NOT retro-update from node-record changes. Regenerate if the edit needs to land in the output.
- If the edit affects ref or prompt, and downstream nodes chain off this node's output, consider whether the chain needs re-running.`,
  ),
  defineProcessPrompt(
    'provider-management',
    'Provider Management',
    'Guidance for provider setup and capability checks.',
    `Provider management covers the global provider registry — listing available providers, reading active selections, setting API keys, registering custom endpoints. This is project-wide infrastructure, not per-node configuration.

Workflow — always, in order:
1. Call \`provider.manage { action: 'list' }\` to see which providers are currently registered and their id strings.
2. Call \`provider.manage { action: 'getActive' }\` to see which provider is the current default for a given capability (image, video, audio). The active provider is what nodes use when no explicit provider is set.
3. Call \`provider.manage { action: 'getCapabilities' }\` with a specific providerId to learn what that provider can actually do — resolutions, durations, lip-sync support, emotion vector support, max variant counts, cost tiers. Always call this BEFORE assuming a capability exists.
4. Pick the right write path:
   - \`provider.manage { action: 'setActive' }\` — change the default provider for a capability (image / video / audio). This is the only provider write the agent can perform directly.
   - Storing an API key, modifying a registered provider's settings, or registering/removing a custom endpoint are admin tasks the agent CANNOT perform — these live in Settings. Direct the user there (via \`commander.askUser\`); do not attempt a tool call for them.
5. After the user reports a credential or provider change, re-verify via \`provider.manage { action: 'list' }\` or \`provider.manage { action: 'getCapabilities' }\` before running generations.

Capability checks — always query before assuming:
- Lip-sync: provider-specific. Many audio providers generate voice without lip-sync; only combined video+voice providers sync.
- Advanced emotion vector: honored by some providers, silently ignored by others. When unsupported, the vector is dropped.
- Variant count > 1: not all providers support it; check before setting \`variantCount\` on a node.
- Resolution limits: each provider has min/max. Setting image params outside the range will be clamped or rejected.
- Duration limits (video, music, SFX): provider-specific. Most video models degrade past 8s.
- Cost tier: some providers expose tiers. Reading this informs the user quote before they commit.

API key handling:
- Treat provider keys as secrets. Do not write them into notes, comments, or chat replies.
- Setting an API key is a Settings task the agent cannot perform; never echo a key back in tool output.
- If the user pastes a key in chat by mistake, advise them to set it in Settings and rotate the leaked key immediately.

Custom provider registration:
- Registering or removing a custom endpoint is a Settings task the agent cannot perform. When the user wants a self-hosted endpoint, private API gateway, or provider variant not in the built-in registry, walk them through Settings.
- Confirm capability manifest details with the user before they register — a wrong manifest causes silent failures downstream.

Active provider vs node-level provider:
- Active provider (this process) is the project-wide DEFAULT.
- Per-node provider overrides (set via \`canvas.configureNode\`) are for specific shots that need a different provider from the active default — see the node-provider-selection process.
- Changing the active provider does NOT update nodes that already have explicit overrides.

Decision tree — when to change the active provider:
- The project is committing to a new primary provider for all image generation → \`provider.manage { action: 'setActive' }\` for the image capability. Existing nodes with no override will pick up the new default on next generation.
- One specific shot needs a different provider → do NOT change active. Use \`canvas.configureNode\` on that node only.
- Switching providers mid-project → warn the user; style and identity may drift across the boundary. Consider regenerating reference images under the new provider to lock identity.
- Testing a new provider → have the user register the custom endpoint in Settings (if not built-in), run a test node with explicit \`canvas.configureNode\`, evaluate, then decide whether to promote to active.

Common pitfalls:
- Setting API key and immediately generating without calling \`provider.manage { action: 'getCapabilities' }\` first → can mis-assume a feature exists.
- Changing the active provider mid-sequence without coordinating regeneration → identity and style drift between early and late shots.
- Printing or echoing API keys back to the user → security leak.
- Using a custom-removal on a built-in providerId → not possible from the agent and would be rejected anyway; verify the provider is custom first with \`provider.manage { action: 'list' }\` before directing the user to remove it in Settings.
- Forgetting that existing nodes with explicit \`canvas.configureNode\` overrides do not follow active-provider changes → audit overrides when switching defaults.

After provider changes:
- If the active provider changed and existing shots were generated under the old provider, a coordinated regeneration pass may be needed for visual consistency.
- Capabilities assumed earlier in the session may no longer match — re-check \`provider.manage { action: 'getCapabilities' }\` after any provider swap.`,
  ),
  defineProcessPrompt(
    'node-provider-selection',
    'Node Provider Selection',
    'Guidance for assigning providers to nodes.',
    `Node provider selection covers setting a specific provider on a specific node (when that node must diverge from the project default) and estimating cost before committing to generation. This is per-node routing and budgeting.

Workflow — always, in order:
1. Call \`canvas.getNode\` to read the current node state — current \`providerId\`, any seed, current params.
2. Call \`provider.manage { action: 'list' }\` and/or \`provider.manage { action: 'getCapabilities' }\` if you do not already know what the candidate provider can do.
3. Decide if overriding the active provider is actually needed:
   - Shot requires a capability the active provider lacks (higher resolution, lip-sync, longer duration) → override is justified.
   - Shot is a style experiment needing a specific provider → override is justified.
   - Shot is a normal shot in the middle of a sequence → do NOT override; use the active default for consistency.
4. For override: \`canvas.configureNode\` with the target providerId and optional seed. Use seed to lock reproducibility when you need deterministic regeneration.
5. For cost preview: \`canvas.generation { action: 'estimate' }\` returns the provider-side cost estimate for generating this node with current params. Always use BEFORE batch-generating many nodes; cost surprises are avoidable.
6. Proceed to generation via \`canvas.generation\` — the node's overridden providerId takes effect.

Override-vs-default decision tree:
- Active provider covers the capability and style → no override. Leave \`providerId\` unset so the node inherits the active default.
- Shot needs higher resolution than active supports → override.
- Shot needs lip-sync (voice + video) and active is audio-only or video-only → override to a combined provider.
- Shot needs longer duration than active supports → override (video) or split into shorter shots.
- Director wants a specific provider's aesthetic for one shot → override, with the understanding that style may diverge from neighbors.
- Testing a new provider → override on a test node only; do not flip active until the test is approved.

Seed usage:
- Seed lets you reproduce the same generation from a provider. Setting a seed makes iterations deterministic (within provider variance).
- Lock a seed when you are iterating on prompt or params and need to isolate the effect of each change.
- Unlock (clear) the seed when you want the provider to explore the prompt space freely.
- Seed is stored as \`seed\` + \`seedLocked\` — check both before assuming reproducibility.

Cost estimation patterns:
- Single-shot estimate → call \`canvas.generation { action: 'estimate' }\` on the target node, read the number, report to the user before generating.
- Batch sequence estimate → call \`canvas.generation { action: 'estimate' }\` on a representative node, then multiply by the batch count for a rough total. For mixed-param batches, sum per-node estimates.
- Tier comparisons → \`canvas.generation { action: 'estimate' }\` reads the node's current \`providerId\` and params; costs reflect those exact settings. Change params and re-estimate if you are comparing options.

Per-node params interaction:
- Node provider override and node params (image/video/audio config) are independent. Setting a new provider does NOT reset params — but params may now be out-of-range for the new provider. Re-validate with \`provider.manage { action: 'getCapabilities' }\` after override.
- Clamped values: if a set param exceeds the provider's capability, the pipeline may clamp silently. Always cross-check capability before assuming the param you set is what will be used.

Common pitfalls:
- Override set but capabilities mismatch the new provider (e.g. asking for lip-sync on a pure text-to-speech provider) → generation fails or silently drops the feature. Always \`provider.manage { action: 'getCapabilities' }\` on the target first.
- Forgetting \`canvas.generation { action: 'estimate' }\` before a 50-node batch → user gets surprise bill. Estimate first, present, confirm.
- Seed left locked when iterating creatively → generations become stuck in one aesthetic lane. Unlock seed to explore.
- Seed unlocked during QA iteration → cannot reproduce the problem because seed changes each run. Lock during debugging.
- Override on every node "just in case" → defeats the point of active provider; maintenance burden grows.

After override:
- Verify with a test generation if capability mismatch is possible.
- If the override is promoted to project-wide later, consider \`provider.manage { action: 'setActive' }\` and clear the per-node override for maintainability.`,
  ),
  defineProcessPrompt(
    'media-config',
    'Media Config',
    'Guidance for media parameter configuration (image, video, audio).',
    `Media-config covers per-node generation parameters for image, video, and audio nodes. Each media type has its own \`canvas.set*Params\` call. Always read the node first, check provider capabilities, then write params.

Shared workflow:
1. Call \`canvas.getNode\` to read current params.
2. Call \`provider.manage { action: 'getCapabilities' }\` on the node's active provider to learn valid ranges and supported features.
3. Decide what to change (see media-specific sections below).
4. Call the appropriate setter (\`canvas.setMediaParams\`, \`canvas.setMediaParams\`, or \`canvas.setMediaParams\`). Omit fields you do not want to change.
5. Verify via \`canvas.getNode\` if downstream reasoning depends on final state.

--- Image params (\`canvas.setMediaParams\`) ---

Parameters:
- \`width\` / \`height\` — pixels, multiples of 8 or 16. <512 loses detail; >2048 risks OOM.
- \`steps\` — sampling iterations. 20-30 default; beyond the provider's sweet spot adds little or degrades.
- \`cfgScale\` — prompt adherence. Flow-matching models expect 1-4; classic diffusion expects 6-12. Always check the provider's range.
- \`scheduler\` — Euler, DPM++ 2M, DDIM, UniPC, etc. Affects texture and speed.

Aspect-ratio patterns:
- Cinema 2.39:1 → ~1880:790. Widescreen 16:9 → 1920:1080 / 1280:720. Portrait 9:16 → 1080:1920. Square → 1024:1024.
- Reference images → 3:2 or 2:3 depending on entity type.

Tuning:
- Undercooked (noisy, vague) → raise steps first, then check scheduler.
- Over-saturated / burnt → lower cfgScale.
- Ignoring prompt → raise cfgScale modestly.
- Flat but prompt-faithful → try a different scheduler or lower cfgScale slightly.
- Cranking steps to 100+ rarely helps. Match cfgScale to the model family. Keep dimensions divisible by 8/16.
- Lock scheduler at sequence level; drift between neighboring shots causes visual mismatch.

--- Video params (\`canvas.setMediaParams\`) ---

Parameters:
- \`duration\` — seconds. 3-8s reliable; 8-10s risky; 10s+ split into multiple nodes via first/last-frame anchors.
- \`audio\` — embed audio alongside video (provider-dependent).
- \`quality\` — tier selection. Lower tier for iteration; higher tier for locked final renders.
- \`lipSyncEnabled\` — sync mouth to attached voice node. Requires provider support.

Duration strategy: 3-5s motion test, 5-8s final shot sweet spot, 10s+ split. Match video duration to audio duration when voice-driven.

Quality tier strategy: iterate at low tier, promote to high tier once motion locks. Do NOT start at highest tier.

Lip-sync: enable only when a character is speaking on-screen and the voice node is attached. Disable for VO or silent characters (avoids twitchy mouths). Verify provider supports it via \`provider.manage { action: 'getCapabilities' }\`.

--- Audio params (\`canvas.setMediaParams\`) ---

Parameters:
- \`audioType\` (\`voice\` / \`music\` / \`sfx\`) — set FIRST; routes the downstream process prompt. Changing mid-flight can leave prompts stale.
- \`emotionVector\` — voice only, when provider supports it. Eight fields (\`happy\`, \`sad\`, \`angry\`, \`fearful\`, \`surprised\`, \`disgusted\`, \`contemptuous\`, \`neutral\`), each 0-1.
- Sample rate / duration — capability-dependent. Voice: 24kHz typical, 30-60s limit. Music: 44.1-48kHz, 30-120s. SFX: 44.1-48kHz, 5-30s.

audioType selection:
- Character with spoken text → \`voice\`. Music structure (genre, BPM) → \`music\`. Physical sound event or ambience → \`sfx\`. Ambiguous → ask the user.

Emotion vector patterns:
- Calm: one field 0.5-0.7, others 0. Intense: one field 0.7-0.9, neutral 0.1-0.2. Conflicted: two mid values + neutral fill. Flat narration: neutral 0.9. Do NOT max all fields to 1.0. Keep sum under ~1.2.

Common pitfalls (all media types):
- Changing params without \`provider.manage { action: 'getCapabilities' }\` → silent clamping or errors.
- Existing generated assets do NOT retro-update after param changes — regenerate to apply.
- Image: wrong cfgScale family (flow vs diffusion) → burnt or undercooked. Dimensions not divisible by 8/16 → quantize errors.
- Video: \`lipSyncEnabled\` on unsupported provider → silently dropped. Duration beyond provider limit → clamped or fails. Changing duration without checking first/last-frame anchors → wrong anchor positions.
- Audio: emotion vector on unsupported provider → silently ignored. Changing audioType without updating prompt → wrong audio shape. Setting music on a character-attached voice node → conflict. Sample rate mismatch → conversion artifacts.`,
  ),
  defineProcessPrompt(
    'script-development',
    'Script Development',
    'Guidance for reading, writing, and importing scripts.',
    `Script development covers reading, writing, and importing screenplay text — \`script.manage\`, \`script.manage\`, \`script.import\`. Scripts are the narrative spine of a Lucid Fin project; breaking them down into canvas nodes is a separate workflow step.

Workflow — always, in order:
1. Call \`script.manage\` to load the current script text for the active project. Use this before any edit or breakdown — never write blind.
2. Decide the operation:
   - \`script.manage\` — replace the project's script with generated or drafted content. This is the primary authoring path.
   - \`script.import\` — bring in an external script file from disk or a paste. This is the ingestion path for user-provided scripts.
3. After write or import, re-read with \`script.manage\` if downstream steps depend on the final state.

script.manage { action: 'write' } vs script.import decision tree:
- User pasted script text into chat → \`script.manage\` with that text. Import is for file-path or binary input, not chat content.
- User referenced a file on disk → \`script.import\` with the path.
- Generating new script from a brief → \`script.manage\` with the generated text. Confirm creative direction first via \`commander.askUser\` (story structure, tone, length).
- Converting a novel chapter → generate scene-level script via a subagent (novel-to-script is a system prompt), then \`script.manage\` the output. Do not paste novel prose directly as script.

Fountain format basics:
- Scene headings / sluglines: \`INT. LOCATION - TIME\` or \`EXT. LOCATION - TIME\` or \`INT./EXT.\`. All caps, line-start, no indent.
- Action lines: plain text below the slug, present tense, concrete visual description. Short paragraphs.
- Character cues: CHARACTER NAME, all caps, centered by convention but Fountain leaves that to the renderer.
- Dialogue: directly under the character cue, indented in most renderers.
- Parentheticals: \`(sotto)\`, \`(off screen)\`, \`(CONT'D)\` — brief delivery cues under the character cue.
- Transitions: \`CUT TO:\`, \`FADE OUT.\`, all caps, right-aligned by convention.
- Dual dialogue: supported via Fountain's \`^\` marker when two characters speak simultaneously.

Script-to-canvas pipeline:
- Scene extraction: each slug defines a scene; nodes can be created per scene as \`canvas.createNodes\` text → image → video chains.
- Character extraction: from action lines and dialogue cues, gather character names, then create character records (with \`commander.askUser\` for creative direction before \`entity.create { type: "character" }\`).
- Location extraction: from slugs, gather unique locations, then create location records (again, confirm direction first).
- Breakdown workflow: read script → identify scenes + entities → ask user to approve entity list → batch create entities → batch create canvas structure. Do NOT create entities or nodes without user approval for creative content.

Edit hygiene:
- \`script.manage\` replaces the entire script text. Preserve the user's existing content by reading first, modifying, then writing — do not write a fragment assuming the pipeline merges.
- Large restructures (act reshuffles, scene deletions) warrant confirmation with the user before writing.
- Small fixes (typos, format normalizations) can proceed autonomously if the user has asked for them.

Common pitfalls:
- Using \`script.import\` for pasted chat content → import is file-based; use \`script.manage\` instead.
- Writing without reading first → silently overwrites the user's work.
- Breaking the script into canvas nodes without confirming the entity list → creates unwanted characters or locations.
- Fountain format violations (missing slugs, inconsistent caps) → downstream script-breakdown tools may misparse; normalize format when writing.
- Paraphrasing the user's dialogue instead of preserving verbatim → script is authorial; do not rewrite dialogue unless explicitly asked.

After script edits:
- Existing canvas nodes are NOT auto-synced with script changes. If the script restructured scenes, coordinate with the user on whether to rebuild affected canvas sections.
- Entity records derived from the earlier script version may be stale. Offer to re-scan for new/removed entities after large restructures.`,
  ),
  defineProcessPrompt(
    'vision-analysis',
    'Vision Analysis',
    'Guidance for extracting usable visual evidence from images.',
    `Vision analysis covers reading visual content from images — \`text.analyze\` — and stateless text transformations like paraphrasing or summarization via \`text.analyze\`. Three common intents drive vision work: reverse-engineer a prompt from an image, extract style for a color-style record, write findings back into a node's prompt.

Workflow — always, in order:
1. Identify the input image — usually a node asset hash, a canvas ref, or a file path the user provided.
2. Identify the intent before calling the tool. The prompt passed to \`text.analyze\` is what shapes the output; vague intent produces vague output.
3. Call \`text.analyze { action: 'describeImage' }\` with the image + a targeted analysis prompt (see intents below). \`action: 'describeImage'\` is REQUIRED for any image read — the call is rejected without it.
4. Depending on intent, route the output:
   - Prompt reverse-engineering → use as seed text for a new node prompt via \`canvas.updateNodes\`.
   - Style extraction → use as the body of a new \`colorStyle.manage\` record.
   - Entity extraction → use as the seed for \`entity.create\` (with appropriate \`type\`), with user approval.
   - Write-back to a node → use as the basis for updating an existing node's prompt via \`canvas.updateNodes\`.
5. If the user wants the transformed result re-shaped (summary, simplification, translation, etc.), chain \`text.analyze\` on the vision output. \`text.analyze\` does not look at the image — it only reshapes text.

Intent 1 — reverse-engineer prompt:
- Goal: produce a prompt that, if used with a generation model, would plausibly reproduce the image.
- Analysis prompt: "Describe this image as a concise image-generation prompt. Include subject, action, environment, lighting, composition, and style cues. 30-80 words. Natural prose, not keyword soup."
- Use case: user wants a similar frame, or wants to learn what makes an existing reference tick.

Intent 2 — extract style for color-style record:
- Goal: produce palette + grade + material-response description suitable for a \`colorStyle.manage\` body.
- Analysis prompt: "Describe this image's color style as reusable palette + grade grammar. Cover: palette anchors (key colors with roles), saturation ceiling, contrast curve, temperature bias, highlight rolloff, shadow density, material response (skin, metal, foliage), texture response. 80-200 words. No story content."
- Use case: building a color-style library from reference frames.

Intent 3 — write findings back to node prompt:
- Goal: take what is already generated on a node and refine the prompt based on what is or isn't working.
- Analysis prompt: "Describe this image's strengths and failures vs this target intent: [intent]. What is the prompt missing? What is overcooked? Suggest prompt corrections in one short paragraph."
- Use case: iteration loop when a node's output keeps drifting.

Intent 4 — entity field extraction:
- Goal: populate character / location / equipment records from a reference image.
- Analysis prompt: "Extract character fields from this image: face (eyeShape, eyeColor, noseType, lipShape, jawline, definingFeatures), hair (color, style, length, texture), body (height, build, proportions), skinTone, distinctTraits. Respond as a structured list matching these fields."
- Use case: onboarding a new character from a single hero image.
- Adapt the field list for location (architectureStyle, lighting, weather, keyFeatures) or equipment (material, color, condition, visualDetails).

text.analyze { action: 'transform' } usage:
- \`text.analyze\` is stateless — it does not look at images or persistent state. Feed it text + a transformation intent.
- Common transforms: translate, summarize, expand, rephrase as screenplay action, extract bullet list, convert to structured JSON.
- Chain vision → text.analyze { action: 'transform' } when the vision output needs reshaping (e.g. vision produces prose, you need bullets for a UI list).

Common pitfalls:
- Vague analysis prompt → vague vision output. Always state the intent explicitly.
- Using vision output verbatim without review → hallucinated details may leak into records; skim before committing.
- Writing extracted entity fields without user approval → creative direction gate still applies; vision extraction is technical, entity creation is creative.
- Confusing \`text.analyze\` as image-aware → it isn't. If the image matters, \`text.analyze\` must run first.
- Running vision on a generated node to "improve" the prompt without establishing the target intent → rewrites based on what is there, not what was wanted.

After analysis:
- Vision output is advisory, not authoritative. Downstream writes (updates, creates) still need user creative-direction approval where the global agent rules require it.
- Cache results if the same image is analyzed repeatedly — vision calls cost tokens.`,
  ),
  defineProcessPrompt(
    'snapshot-and-rollback',
    'Snapshot And Rollback',
    'Guidance for safe checkpointing and restoration.',
    `Snapshots capture point-in-time state that can be restored after destructive operations. The three tools are \`snapshot.create\`, \`snapshot.list\`, \`snapshot.restore\`. Restoration is a high-impact action; it rewinds project state and must go through the user.

Workflow — always, in order:
1. For creating a snapshot: call \`snapshot.create\` with a descriptive label. Labels should name what you are about to do, not the current time.
2. For browsing snapshots: call \`snapshot.list\` to see existing snapshots with their labels, timestamps, and ids.
3. For restoring: \`snapshot.restore\` rewinds project state to the snapshot. MUST go through \`commander.askUser\` confirmation first — restoration is destructive to current state.

When to create a snapshot:
- Before a large \`canvas.createNodes\` that adds many nodes.
- Before a sweeping preset or color-style change that affects many nodes.
- Before \`canvas.deleteNode\` in bulk or any \`canvas.deleteCanvas\`.
- Before a structural reorganization (big layout moves, edge restructures).
- Before running \`canvas.importWorkflow\` into a populated canvas.
- Before deleting a character / location / equipment record referenced elsewhere.
- Before \`script.manage\` that replaces a user-authored script.
- Before major preset library cleanup (bulk \`preset.manage { action: 'delete' }\`).
- Before the final render pass, as an insurance snapshot.

When NOT to snapshot (routine reads and small edits):
- Reading state (\`canvas.getInfo\`, \`canvas.listNodes\`, \`entity.list\`).
- Small single-node edits (\`canvas.updateNodes\` on one node).
- Single ref attachment or variant selection.
- Iteration on a single node's prompt or params.
- Single-shot generation.

Label naming conventions:
- Name what you are about to do: "Before batch create scene 3 coverage", "Before color-style sweep on warehouse shots", "Before deleting unused characters".
- Avoid generic labels: "snapshot 1", "test", "backup".
- Include the scope so the list is scannable later: which scene, which entity group, which canvas area.
- Timestamps auto-append; do not include date/time in the label yourself.

Browsing snapshots:
- \`snapshot.list\` returns snapshots ordered most-recent-first. Skim labels to find the relevant restore point.
- Snapshots are project-scoped; they include canvas state, node data, entity records, preset tracks, and related metadata.
- Snapshots do NOT include generated asset binaries in all cases — restoration may preserve asset hashes without re-downloading assets. Verify after restore that expected assets are present.

Restoration — user confirmation required:
- \`snapshot.restore\` rewinds the project to the chosen snapshot. Any work done since that snapshot is lost unless the user created a later snapshot to capture it.
- BEFORE calling \`snapshot.restore\`: call \`commander.askUser\` with a clear summary of what will be rewound (snapshot label + timestamp + approximate scope of changes since then).
- AFTER the user confirms: call \`snapshot.restore\`.
- AFTER the restore completes: re-read state (\`canvas.getInfo\`, entity lists) to verify the restore landed and update the user.

Recovery workflows:
- User regrets a recent change → \`snapshot.list\`, find the snapshot from before the change, \`commander.askUser\` to confirm, \`snapshot.restore\`.
- Corrupted state or pipeline error → try undo first (\`canvas.undo\`) for small reversals; snapshot restore for bigger ones.
- Experimental work went wrong → if a "Before experiment" snapshot exists, restore it.
- Before risky operation that might go wrong → always create a snapshot FIRST, with a "Before X" label.

Common pitfalls:
- Calling \`snapshot.restore\` without \`commander.askUser\` confirmation → rewinds unauthorized work. This is a hard rule.
- Creating snapshots with vague labels → list becomes unnavigable; good labels are discovery aids.
- Snapshotting excessively (every tool call) → noise, no useful restore points, storage bloat.
- Snapshotting insufficiently (never) → no recovery path when things go wrong. Error on the side of more snapshots for high-impact work.
- Assuming \`snapshot.restore\` brings back deleted binary assets → asset-side recovery is provider/storage-dependent; verify after restore.

After restore:
- The project is now in the snapshot's state. Any later work must start from here.
- Notify the user what landed and what didn't (e.g. "Nodes restored; last 4 generated images were post-snapshot and are no longer in canvas state").
- Consider a new snapshot immediately after restore if further risky work follows.`,
  ),
  defineProcessPrompt(
    'render-and-export',
    'Render And Export',
    'Guidance for render execution and delivery handoff.',
    `AUTHORITATIVE PERSISTENT WORKFLOW RULES:
- The implemented model tools are \`workflow.finalExport\`, \`render.start\`, and \`render.cancel\`. \`render.exportBundle\` is not an available persistent-workflow completion path.
- After all required shot artifacts pass evaluation, call \`workflow.finalExport\` exactly once with workflowRunId, canvasId, expectedRowVersion, codec, quality, width, height, and fps. Never send clip paths, hashes, ordering, or trims; the host derives them from SQLite, canvas state, the asset index, and CAS.
- Stop for the third host approval gate. Chat and \`commander.askUser\` cannot approve it.
- After exact approval, call \`render.start\` with only workflowRunId, canvasId, expectedManifestRevision, expectedManifestHash, and optionally outputPath/retry. Never replace approved media or settings.
- Reconstruct work after compaction/restart from the persisted Manifest and execution receipt. Do not resubmit an active/completed/ambiguous render. An interrupted queued/running render requires an explicit bounded retry; a different destination file is never overwritten.
- Current approved-manifest support is ordered full video clips at speed 1, embedded clip audio, MP4 H.264/H.265 or MOV ProRes. Separate audio nodes/mixes and subtitle tracks fail explicitly.
- Manual auxiliary exports are not Final Export completion and are blocked when a persistent workflow owns the canvas.

The notes below apply only to a manual, unbound canvas and must never override the persistent rules above. Render and export covers compiling generated canvas assets into a local deliverable and canceling a render.

Workflow — always, in order:
1. Pre-render dependency check: before calling \`render.start\`, verify the render scope is complete.
   - Call \`canvas.listNodes\` (with filters if appropriate) to see which nodes are needed.
   - Verify each required node has status "complete" (generated asset present). Nodes stuck in "pending" or "error" block the render.
   - Verify edges are intact — no broken connections in the render path.
   - For video chains, verify first/last-frame anchors are set on all video nodes (\`canvas.setVideoFrames\`).
   - For shots with audio, verify audio nodes are generated and sync mode is correct.
2. Call \`render.start\` with the target canvas and scope (usually a canvas-wide render, sometimes scoped to a scene or a subgraph).
3. Monitor: the render runs asynchronously. Report progress to the user; do not poll aggressively.
4. If a render needs to stop: \`render.cancel\` aborts the in-flight render. Useful when the user spots an issue mid-render or when a pre-render check was missed.
5. When the render is complete, report the durable output receipt. Do not invent a bundle step.

Pre-render dependency check — common missing items:
- Image nodes with status "pending" or "error" → regenerate those first.
- Video nodes without first-frame anchors → continuity will drift; set anchors via \`canvas.setVideoFrames\`.
- Audio nodes with no generated asset → the audio layer will be silent in the render.
- Ref images on characters / locations / equipment that appear in-frame but are missing → visual drift in the rendered shot.
- Preset tracks on affected nodes that point to deleted presets → orphaned track entries; clean up before render.

Output format options:
- Render output format depends on the provider and project configuration. Typical formats include MP4 (H.264 or H.265), MOV (ProRes), image sequences (PNG/EXR for post).
- Resolution: usually inherits from the canvas or the first image node's params; verify before committing to a long render.
- Audio tracks: rendered with the video or exported as separate stems depending on config.
- Check the project's render config before assuming output format — surprises here cost real render time.

Render monitoring:
- Progress reporting: the render job emits progress events. Report significant milestones (started, 25%, 50%, 75%, completed) without narrating every tick.
- Failure recovery: on render error, read the error text, identify the failing node(s), fix (regenerate the failing node, repair the chain, or skip the shot), and restart.
- Long renders: video-heavy renders can take hours. Offer the user the option to stop and resume at key points rather than blocking on a single long run.

Cancel semantics:
- \`render.cancel\` stops the in-flight render. In-progress shots may be partially complete; the bundle is not produced.
- After cancel, the canvas state is preserved; only the render job is terminated.
- Common cancel triggers: user spotted a missing ref, user wants to change provider mid-render, the estimated cost is too high.

Auxiliary exports:
- NLE, asset bundle, storyboard, metadata, subtitle, and CapCut exports are manual handoff aids. They do not render or complete a persistent workflow.
- When a persistent workflow owns the canvas, the host blocks these paths so they cannot bypass the approved Manifest.

Common pitfalls:
- Starting a render without the pre-check → render fails mid-way, wasting minutes or hours of compute. Pre-check is non-optional.
- Forgetting to set video frame anchors → rendered video drifts between clips; the "render looks fine but continuity is broken" failure mode.
- Canceling a render on a minor issue instead of letting it finish → if the issue is cosmetic, finishing and regenerating the affected shot post-render is often cheaper than restarting everything.
- Not monitoring long renders → user doesn't know progress; communicate milestones.
- Inventing a bundle tool call after render — report the persisted output receipt and use only tools currently exposed by discovery.

After render and export:
- Notify the user of completion with the bundle location and a summary (duration, shot count, any warnings from the render log).
- If warnings or errors occurred in the render log, surface them — silent failures erode trust in the pipeline.`,
  ),
  defineProcessPrompt(
    'workflow-orchestration',
    'Workflow Orchestration',
    'Guidance for the persistent three-gate production workflow and run control.',
    `Workflow orchestration has a deterministic host-owned state machine. The model creates structured creative documents; it never grants approvals, advances gates, or treats chat text as workflow state.

Entry — one-line idea or full-video request:
1. Expand the user's idea into the complete structure required by \`workflow.manage { action: 'createProductionPlan' }\`: title, logline, synopsis, genre, tone, audience, runtime/aspect ratio, ordered acts/scenes, explicit assumptions, budget/retry bounds, and a small set of visual directions.
2. Call \`createProductionPlan\` exactly once. This persists an immutable revision and opens the Production Plan approval gate.
3. STOP all canvas/entity/generation/render/export mutations while the run reports \`awaiting_approval\`. Explain that the exact revision is ready in the approval UI; do not call \`commander.askUser\` to simulate approval.
4. When the host later reports the plan approved, continue from the persisted workflow state. Never recreate the plan merely because chat was cleared or compacted.

Exactly three persistent approval gates:
- Production Plan: locks story, assumptions, target format, total budget, audition budget, attempts per shot, and total regeneration count.
- Visual Constitution: locks the selected medium/style, palette, lighting, texture, camera/lens/composition/motion grammar, and character/location reference anchors.
- Final Export: locks the exact assembly/export manifest before the deliverable is written.

There are no per-phase approval prompts. Inside already approved story, style, budget, provider/model, and retry bounds, continue autonomously through planning, generation, evaluation, repair, and regeneration. If a rejected document needs a revision, create a new immutable revision; never overwrite the approved or rejected one.

Use \`commander.askUser\` only when:
- a missing creative decision would materially change story, audience, style, or cost;
- the next action would exceed an approved bound;
- a provider submission has an ambiguous outcome that cannot be retried safely;
- evaluation evidence requires human review.
Persist ordinary low-risk assumptions in the next approvable document instead of interrupting the user.

Style exploration after Production Plan approval:
- Call \`workflow.visual\` exactly once with 2–4 complete, project-specific candidate directions. Each candidate must include its preview prompt, deterministic seed, negative constraints, and the full Visual Constitution grammar required by the tool schema.
- \`workflow.visual\` uses the configured production image provider, persists a submission reservation before every provider call, generates real previews, grades the visible results with the configured vision provider, and resumes partial grading without blindly resubmitting generated assets.
- After the tool returns, STOP and direct the user to the visible preview selector. The user first locks one candidate there, then separately approves the exact Visual Constitution revision. Do not use \`commander.askUser\` to replace either host-UI action.
- If the SQLite manifest already contains an audition revision, resume or report that revision. Never submit a different candidate set or regenerate a completed audition because chat history was cleared.
- A reusable style catalog may provide optional inspiration later, but it is not authoritative. The project-specific previews made by the configured provider are the decision surface and disclose image/vision provider, model, seed, score evidence, cost, and unknown cost fields.

Generation after Visual Constitution approval:
- Build character/location/equipment reference sheets as ordinary canvas image nodes bound to their real entity refs and the approved anchor text. Produce each with \`workflow.media\`, then attach only the accepted asset with the relevant \`entity.setRefImageFromNode\` action. Never use \`entity.generateRefImage\` inside the persistent run because it bypasses the durable grader.
- For each production image or video node, call \`workflow.media\` once with only workflowRunId, canvasId, nodeId, and the current workflow rowVersion. Never send a prompt, provider override, raw asset path, grade, verdict, or Repair Delta.
- The host deterministic compiler binds the approved plan, Visual Constitution, entity/reference anchors, node revision, provider request, seed, limits, and cost into an immutable Generation Spec before any provider call.
- The host evaluates images directly and evaluates video with ffprobe metadata plus timestamped keyframes. Evaluators propose \`pass / repair / regenerate / human_review\`; host policy decides from visible evidence and remaining bounds.
- \`workflow.media\` creates a new immutable attempt and artifact for every bounded repair/regeneration and selects only a passing artifact. Never use \`canvas.generation\` for media owned by this persistent run.
- Follow the returned \`nextAction\`: \`retry_evaluation\` may call the same tool again because it resumes grading the existing CAS asset without another provider submission; \`ask_user\` must call \`commander.askUser\` once with the persisted evidence and exact configuration/bound decision. Never retry \`ambiguous\`, \`human_review\`, or \`budget_blocked\` provider work.

Final assembly:
- Assemble only from accepted artifact revisions.
- Call \`workflow.finalExport\` once with only output choices; the host derives the exact assembly and opens the Final Export gate.
- Stop until the host records approval of that exact revision/hash.
- After approval call \`render.start\` with only workflow/canvas identity and the exact Manifest revision/hash. Never supply caller-selected clips or settings.
- On compaction or restart, resume from the persisted Manifest and execution receipt instead of preparing or submitting again.

workflow.manage { action: 'control' } actions:
- \`pause\` — suspend the workflow run. In-progress tool calls may complete, but queued ones halt. Useful when the user wants to review mid-run.
- \`resume\` — continue a paused workflow from where it paused.
- \`cancel\` — abort the workflow entirely. Already-completed work persists; remaining steps are abandoned.
- \`retry\` — re-run a failed step or a failed workflow. Useful after fixing the root cause of a failure.

When to use workflow.manage { action: 'control' }:
- Long workflow hitting a clearly wrong branch → \`pause\`, review with user, decide to \`cancel\` or adjust and \`resume\`.
- Workflow failed mid-run due to transient error → \`retry\`.
- User changed their mind mid-run → \`pause\`, discuss with user, \`cancel\` or adjust.
- Workflow stuck in a retry loop on a persistent error → \`cancel\`, fix root cause, restart fresh.

Workflows vs manual tool chains:
- Use the persistent workflow for all end-to-end video creation, because approval, budget, attempts, evidence, and recovery must survive restarts.
- Use manual tool chains when the work is exploratory, one-off, or requires tight user interaction at each step.
- Manual tool chains must not mutate artifacts that belong to an active persistent run outside its task permissions.

Common pitfalls:
- Creating nodes or media before Production Plan approval → bypasses the first non-negotiable gate.
- Treating "yes", "go", or an answer to \`commander.askUser\` as approval → only the host approval command can advance a gate.
- Using \`workflow.manage { action: 'control' }\` without knowing the workflowId → fetch the id from the workflow's start response or from the running-workflow registry.
- Canceling instead of pausing → if the user might still want the work, \`pause\` preserves the option. \`cancel\` is final.
- Retrying without addressing the root cause → loops until the retry budget expires. Fix first, retry second.
- Replaying the same provider mutation after an ambiguous timeout → enter recovery instead of risking duplicate cost.

After workflow operations:
- \`workflow.manage { action: 'createProductionPlan' }\` returns the run ID, exact revision/hash, and pending gate; that result is persisted truth.
- \`workflow.manage { action: 'control' }\` results affect the in-flight run; re-check workflow status to confirm the control action landed.`,
  ),
  defineProcessPrompt(
    'series-management',
    'Series Management',
    'Guidance for series and episode planning work.',
    `Series management covers the series-level project metadata — series title and description, the ordered episode list, adding and removing episodes, reordering. A Lucid Fin project can be a standalone film or a series with multiple episodes; this process is active only when the series structure matters.

Workflow — always, in order:
1. Call \`series.get\` to read the current series metadata (title, description, top-level fields). Never write blind.
2. Call \`series.listEpisodes\` to see the current episode list with ids and positions.
3. Decide the operation:
   - \`series.update\` — modify the series-level fields (title, description). Confirm significant rewrites with the user — series title is a creative decision.
   - \`series.addEpisode\` — append or insert a new episode into the list.
   - \`series.removeEpisode\` — remove an episode. Verify no canvas or entity references it before removing.
   - \`series.reorderEpisodes\` — change the episode order. Affects presentation and any downstream numbering.
4. Verify via \`series.get\` / \`series.listEpisodes\` if downstream work depends on final state.

When to touch series-management vs per-episode work:
- Renaming the series → series-management (\`series.update\`).
- Adding a new episode shell (title, placeholder) → series-management (\`series.addEpisode\`).
- Working on what's INSIDE an episode (script, canvas, characters) → respective per-episode processes. Series-management is about the list itself, not the contents.
- Reorganizing episode order (e.g. swapping act structure) → series-management (\`series.reorderEpisodes\`).

Episode-list hygiene:
- Keep episode titles short and discoverable. They appear in UI lists and references.
- Episode numbering is typically driven by list position; if the project uses explicit numbers, keep them consistent with position after \`series.reorderEpisodes\`.
- Removing an episode with active canvas / script content → verify there is no work that needs preserving first. Confirm with the user before destructive removal.

Approval workflow:
- Creating a new episode structure for a series the user has not planned → \`commander.askUser\` first with a short brief proposal.
- Reordering episodes in a user-authored arc → confirm before reordering; episode order is creative.
- Minor series-title typo fix → proceed autonomously if the user asked.

Common pitfalls:
- Updating series title or description without reading first → silently overwrites user's draft.
- Reordering episodes without asking → may violate the user's intended narrative sequence.
- Removing an episode that still has active canvas or script content → work lost unless explicitly confirmed.
- Treating \`series.update\` as the place to put per-episode facts → episode facts belong on the episode record or the episode's canvas; series-level fields are top-level.

After series changes:
- Any UI that reads series metadata will refresh; inform the user of changes that may not be immediately visible.
- Reordered episodes may affect references (e.g. "Episode 3" previously meant one thing, now means another). Flag this to the user.`,
  ),
  defineProcessPrompt(
    'prompt-template-management',
    'Prompt Template Management',
    'Guidance for reusable prompt template maintenance.',
    `Prompt template management covers the built-in prompt catalog — \`prompt.get\` reads a prompt template by code (e.g. \`agent-system\`, \`domain-canvas-tools\`, \`novel-to-script\`, \`character-extract\`, \`script-breakdown\`), \`prompt.setCustom\` stores a user-edited override. These are the system prompts and subagent briefs, NOT the process-bound prompts (which have their own store).

Workflow — always, in order:
1. Call \`prompt.get\` with the prompt code to read the current template (returns the custom value if set, otherwise the built-in default).
2. If the user wants to edit: present the current value, collect the user's changes, then call \`prompt.setCustom\` with the code and the new value.
3. If the user wants to reset a customized prompt to its built-in default: call \`prompt.setCustom\` with an empty custom value (or use the reset path if the API exposes one).
4. Verify by calling \`prompt.get\` again to confirm the stored value.

What lives in this store vs the process-prompt store:
- \`agent-system\` (Commander's minimal global rules), \`domain-canvas-tools\` (tool catalog reference), system prompts for subagents (\`novel-to-script\`, \`character-extract\`, \`script-breakdown\`, etc.) → this store, managed via \`prompt.*\` tools.
- Process-bound prompts (one per process category, auto-injected when the matching process is active) → the separate process-prompt store, managed via \`processPrompt.*\` tools and the process-bound-prompts Settings UI.
- Do NOT confuse the two stores. A process-prompt edit belongs in the process-prompt-store workflow, not here.

Approval workflow:
- Editing \`agent-system\` or any other default-behavior prompt → confirm with the user; these govern Commander's baseline behavior.
- Adjusting a subagent system prompt (e.g. tuning \`novel-to-script\`) → confirm with the user; subagent behavior follows from these.
- Resetting a customized prompt to default → confirm, because the user's customizations are lost.

Edit hygiene:
- Read before write. \`prompt.setCustom\` overwrites the stored custom value entirely; it does not merge.
- Preserve intent: minor fixes (typo, small rephrasing) can proceed autonomously if asked. Large rewrites should be reviewed with the user.
- Do NOT paraphrase the user's custom text when they ask you to "save the change" — use the exact text they authored.
- Version awareness: some prompts are frequently updated in the codebase (new tools added, process names changed). A user's custom override may drift from the latest default; surface this when the user is reviewing.

prompt-store vs runtime injection:
- \`prompt.get\` reads the stored template. Commander's actual system-message at runtime is an aggregate of \`agent-system\` plus active process prompts plus a few other layers.
- Editing \`agent-system\` here does NOT immediately change mid-session behavior; a new session picks up the new value.

Common pitfalls:
- Editing a process prompt through \`prompt.setCustom\` → wrong tool; process prompts are in a separate store.
- Writing without reading → silently overwrites the user's custom override.
- Paraphrasing the user's intended custom text → the user wanted verbatim; respect their exact phrasing.
- Resetting without asking → discards the user's customizations; always confirm.
- Updating \`agent-system\` expecting mid-session change → session needs restart or explicit re-injection for the new rules to take effect.

After edits:
- The next session (or the next time Commander's system prompt is composed) uses the new value. If the user expects immediate change, start a fresh conversation.
- Flag to the user when a prompt is "customized" so they know it differs from the built-in default.`,
  ),
  defineProcessPrompt(
    'asset-library-management',
    'Asset Library Management',
    'Guidance for importing and locating project assets.',
    `Asset library management covers the project's binary asset store — \`asset.list\` to browse imported assets, \`asset.import\` to add new assets. Assets are images, videos, audio files, or other binaries referenced by canvas nodes, entity ref slots, or render outputs.

Workflow — always, in order:
1. Call \`asset.list\` with filters (type, tag, name query) to see what is already in the library. Avoid importing duplicates.
2. Decide the source of the new asset:
   - User provided a file path on disk → \`asset.import\` with the path.
   - User provided a URL → may require downloading first; check if \`asset.import\` accepts URLs or if a fetch step is needed.
   - User wants to reuse a generated canvas node's output as a library asset → the ref-image tools (e.g. \`entity.setRefImageFromNode\`) handle this directly; no separate import needed.
3. Call \`asset.import\` with the source and intended usage metadata (type, tags, descriptive name).
4. Verify via \`asset.list\` that the import landed.

When to use asset.import:
- Onboarding user-provided reference imagery (a photo of the actor who inspires the character, a location scout photo, a prop sketch).
- Onboarding user-provided final deliverables (client-provided logo, brand imagery, approved test frame).
- Bringing back exports from an external tool (retouched frame from Photoshop, re-colored still from DaVinci).
- Importing a previously exported bundle's assets into a new project.

When NOT to use asset.import:
- Attaching a generated canvas node's output as an entity ref → use \`entity.setRefImageFromNode\`. That tool wires the asset correctly without a manual import round-trip.
- Using an already-imported asset on a new node → find its hash via \`asset.list\` and reference directly.

Metadata hygiene:
- Name imports descriptively. "Actor reference - jane_doe.jpg" beats "image.jpg" when scanning the library later.
- Tag at import time. Common tags: \`character-ref\`, \`location-scout\`, \`prop-scan\`, \`brand\`, \`final-deliverable\`.
- Include the source or context in metadata when useful. "Scanned from director's moodboard" is easier to trace later than an unlabeled JPEG.

Library scale considerations:
- \`asset.list\` may return many items on mature projects. Use filters aggressively.
- Duplicate imports bloat storage; check the library before importing the same reference twice.
- Large binary imports (video files, multi-GB) may take time; tell the user to expect the wait.

Common pitfalls:
- Importing a generated node output via \`asset.import\` instead of \`*.setRefImageFromNode\` → bypasses the ref-wiring; the asset is in the library but not attached to the intended entity.
- Untagged or poorly named imports → library becomes unsearchable; later work has to grep by hash.
- Importing duplicates → storage bloat; check first.
- Importing unrelated files "for later" → clutters the library; only import what the project actually needs.
- Assuming \`asset.import\` accepts URLs when it may only accept file paths → check the tool schema before assuming.

After import:
- The asset is in the library but not yet attached to any node or entity. Further steps (\`canvas.updateNodes\`, \`canvas.setNodeRefs\`, \`entity.setRefImage\`) are needed to use it.
- The returned asset hash / id is the stable reference. Record it if downstream steps will reference this asset.`,
  ),
  defineProcessPrompt(
    'job-control',
    'Job Control',
    'Guidance for inspecting and controlling generation jobs.',
    `Job control covers background job oversight — \`job.list\` to see in-flight and completed jobs, \`job.control\` to pause, resume, cancel, or retry a specific job. Jobs are asynchronous work units: generations, imports, renders, bulk operations. This process is about watching and steering the async layer.

Workflow — always, in order:
1. Call \`job.list\` with optional filters (status, type) to see current job state.
2. Identify the job(s) relevant to the current situation.
3. Decide the control action:
   - \`pause\` — suspend a running job. Useful for mid-run review or when a resource conflict blocks progress.
   - \`resume\` — continue a paused job from where it left off.
   - \`cancel\` — abort a job entirely. Already-completed work within the job may persist (provider-dependent); remaining work is abandoned.
   - \`retry\` — re-run a failed job. Useful after transient errors or after fixing the root cause of a persistent failure.
4. Call \`job.control\` with the jobId and action. Verify via \`job.list\` that the control action landed.

Reading job state:
- \`job.list\` returns jobs with fields like id, type, status (\`running\`, \`paused\`, \`completed\`, \`failed\`, \`canceled\`), progress percentage, error message (if failed), and timestamps.
- Filter by status when triaging: \`running\` to see what is active, \`failed\` to see what needs attention.
- Filter by type to focus on a specific concern: generation jobs, render jobs, import jobs, etc.

When to pause vs cancel:
- User wants to review mid-progress → \`pause\`. Preserves the option to \`resume\`.
- User wants to add constraints or change parameters before more work commits → \`pause\`, apply changes (if possible), \`resume\`.
- User has decided the job is wrong and won't use the output → \`cancel\`. Stops burning resources.
- User wants to cancel just to restart with different params → \`cancel\`, then start a fresh job with the new params. \`retry\` uses the same params as the original.
- Job is stuck and unresponsive → \`cancel\`; \`pause\` requires the job to acknowledge, which a stuck job may not.

When to retry:
- Transient error (network blip, provider temporary unavailable, timeout on a retryable operation) → \`retry\` is appropriate.
- Persistent error (bad input, missing ref, invalid params) → do NOT \`retry\` until the root cause is fixed. Otherwise you loop until the retry budget exhausts.
- Partial failure (job produced some output but failed on a specific step) → check whether \`retry\` resumes from the failed step or restarts from scratch; provider-dependent.
- User-initiated cancel → do NOT \`retry\` without asking the user; they canceled for a reason.

Triage patterns:
- Periodic status report: \`job.list\` with status=\`running\`, show progress to user without polling aggressively (every 10-30 seconds is typical, not every second).
- Failure diagnosis: \`job.list\` with status=\`failed\`, read the error message, classify as transient or persistent, act accordingly.
- End-of-session cleanup: \`job.list\` to ensure nothing is still running before the session closes; cancel stale or abandoned jobs.

Common pitfalls:
- Polling job status every second → wastes calls and noise. Space polls out; the user does not need sub-second updates.
- Retrying a persistent-failure job repeatedly → fix the root cause first; a retry loop on the same bad input wastes compute.
- Canceling when pause would have sufficed → if you might still want the output, pause; cancel is final.
- Forgetting that already-completed parts of a canceled job may persist → verify downstream state (e.g. partial canvas updates) after a cancel.
- Ignoring error messages from failed jobs → the error often names the exact fix. Read it before deciding to retry.

After control actions:
- Verify with \`job.list\` that the action landed. \`job.control\` returns acknowledgment, but the job may take a moment to transition states.
- Report control actions to the user, especially \`cancel\` and failed \`retry\` — they are decisions the user should know about.
- After a cancel or failure, state that the job is gone so the user does not expect its output to appear later.`,
  ),
  defineProcessPrompt(
    'style-plate-lock',
    'Visual Style Draft (manual/pre-approval)',
    'Guides Commander to create a structured Canvas visual-style draft for manual media and previews without competing with an approved Visual Constitution.',
    `Before manual reference-image or Canvas media generation, inspect \`canvas.settings.visualStylePolicy\` (legacy \`stylePlate\` is read compatibly). The host deterministically compiles this draft into reference-image and manual image/video prompts.

If the Canvas is bound to a persistent workflow with an approved Visual Constitution, STOP using this draft workflow. The immutable approved Visual Constitution is the only style authority; use workflow media tools and the existing revision/approval gate.

Workflow — non-negotiable order:
1. Call \`canvas.getInfo({ scope: 'settings' })\` for the active canvas.
2. Inspect \`visualStylePolicy\` (or legacy \`stylePlate\`) on the returned settings.
   - **Present** → proceed. The host injects it automatically; do not repeat it in scene text.
   - **Missing** → ask one targeted question or offer visible project-specific style auditions so a non-expert can choose by sight.

Visual-style draft workflow (when no draft is set):
- Call \`guide.get({ ids: ['workflow-style-plate'] })\` to read the full lock procedure.
- Ask the user ONE question: which art style anchors this project (e.g. "Japanese anime, flat cel shading", "Pixar 3D with subsurface scatter", upload an image and describe it).
- When the user answers, compose a 20–60 word \`summary\` plus structured locks covering medium, line work, palette, texture, lighting, and era. No character names, scene, or action.
- Persist it: call \`canvas.setSettings({ canvasId, visualStylePolicy: { version: 1, summary, locked, allowedVariations, negativeConstraints } })\`. If the direction came from a user choice, do not ask for duplicate confirmation.
- Re-call \`canvas.getInfo\` to verify it landed.
- THEN return to the original ref-image request without pausing.

Hard rules:
- Do NOT present a Canvas draft as an approved workflow lock.
- Do NOT hardcode style vocabulary for the user. Let them choose with plain-language descriptions or visible previews.
- Do NOT embed scene/action/character details in the style policy; those belong in node prompts.

User-visible behavior:
- If a draft exists: proceed and report the style provenance with the result.
- If no draft exists: ask one concise question or offer previews; do not lecture the user about film terminology.

Verification after locking:
- \`canvas.getInfo\` returns the structured policy you wrote.
- The generated result reports \`visualStyle.policyHash\`; generated assets persist the same provenance.`,
  ),
  defineProcessPrompt(
    'entities-before-generation',
    'Entities Before Generation',
    'Triggered on early steps when a visual-generation tool is pending. Reminds Commander to verify that referenced entities have reference images before generating scene visuals.',
    `One or more referenced entities may not have reference images yet. Before generating scene images or video, verify that every attached character, location, and equipment entity has a usable reference image.

Why this matters:
- Reference images are the identity anchors for the entire pipeline. Scene generation without them produces identity drift that is expensive to correct across dozens of shots.
- Generating ref images first costs one extra step per entity but saves multiple regeneration passes later.

Checklist — run before your first canvas.generation in this session:
1. For each entity ref attached to the target node(s): call \`entity.list\` with the entity's type and check that the entity's \`referenceImages\` array contains at least one entry with a non-null asset. If missing, call \`entity.generateRefImage\` first.
2. Only after all referenced entities have ref images should you proceed with \`canvas.generation\`.

Exceptions:
- If the user explicitly asks to skip ref-image generation ("just generate the shot, I'll fix refs later"), comply but warn that identity may drift.
- If the entity is brand new and the user is iterating on its record fields, generating the ref image after the record stabilizes is acceptable.
- Text-only nodes and audio nodes do not require entity ref images.`,
  ),
  defineProcessPrompt(
    'batch-create-guidance',
    'Batch Create Guidance',
    'Triggered when canvas.createNodes is called with more than 5 nodes. Provides structural guidance for large batch operations.',
    `You are about to batch-create a large number of nodes. Large batches benefit from deliberate structure — without it, the canvas becomes a disorganized pile that is hard to navigate and harder to edit.

Structural guidance for large batches (>5 nodes):
1. Group nodes by scene or sequence. Each scene should form a visual cluster on the canvas — text brief at the top, image nodes below, video nodes chained left-to-right.
2. Use backdrops for scene containers. After batch-creating the nodes, call \`canvas.manage { action: 'updateBackdrop' }\` to group each scene's nodes under a labeled backdrop (scene title, act number). This makes the canvas navigable.
3. Set proper edge flow between sequential shots. Image → video (first-frame), video → image (last-frame for next shot). Do not leave nodes disconnected — orphan nodes miss context during generation.
4. Apply shot templates for consistent quality. If the project has established shot templates (check \`shotTemplate.manage { action: 'list' }\`), apply them to new nodes via \`canvas.presetTracks { action: 'applyTemplate' }\` rather than manually setting preset tracks on each node.
5. Consider splitting into multiple batch calls if creating >20 nodes. A single batch with 30+ nodes is atomic but harder to debug if something goes wrong. Two batches of 15 with a verification step in between is safer.
6. After the batch completes, call \`canvas.layout\` to auto-arrange the graph so the director can visually scan the structure.
7. Set entity refs (\`canvas.setNodeRefs\`) on the new nodes in a follow-up pass — batch-create supports inline refs via characterIds/locationIds/equipmentIds, but a dedicated pass lets you verify IDs first.`,
  ),
  defineProcessPrompt(
    'prompt-quality-gate',
    'Prompt Quality Gate',
    'Triggered when canvas.generation is called. Reminds Commander to verify and expand thin prompts before committing to generation.',
    `Before generating: verify that the target node has a detailed, actionable prompt. Short or empty prompts produce generic results that waste generation tokens and require regeneration.

Quick check:
1. Call \`canvas.getNode\` on the target node.
2. Read the \`prompt\` field.
3. If the prompt is missing, empty, or under ~20 characters, STOP and expand it before generating.

What a good prompt includes (for image nodes):
- Subject: who or what is in the frame, identifying marks, pose or state.
- Environment: concrete place, time, visible ground plane and surroundings.
- Lighting: directional, colored, with interaction ("low-angle afternoon sun slicing through louvers").
- Composition: framing, camera distance, lens feel, focal anchor.
- Mood: one or two words anchoring the emotional register.

What a good prompt includes (for video nodes):
- Camera move: one move only (dolly in, pan left, tracking, static).
- Subject action: concrete verbs in present tense.
- Beat resolution: how the shot ends.

What to do if the prompt is thin:
- Use \`canvas.updateNodes\` to expand the prompt with shot type, angle, lighting, and mood.
- Check \`canvas.presetTracks { action: 'read' }\` — if preset tracks already carry camera/lens/look direction, the prompt can be shorter because presets handle those layers.
- Check attached entity refs — if character/location refs are attached, the prompt does not need to re-describe identity; focus on action and environment.
- Use \`canvas.previewPrompt\` to see the full compiled prompt (node text + refs + presets + text edges) before generating.`,
  ),
  defineProcessPrompt(
    'story-workflow-phase',
    'Story Workflow Phase',
    'Triggered for story-to-video work. Reinforces persisted truth, three approvals, and bounded autonomy.',
    `You are operating inside a persistent story-to-video workflow. Read the current run, gate, approved document revisions, remaining budget, and attempt counters from tools; do not reconstruct them from chat memory.

The only approval gates are:
1. Production Plan — before any canvas/entity/provider mutation.
2. Visual Constitution — before reference, scene-image, or video generation.
3. Final Export — before writing the final deliverable.

Chat affirmations and \`commander.askUser\` answers never approve a gate. Stop at \`awaiting_approval\` until the host approval UI advances the exact revision. Do not invent extra checkpoints.

During \`style-exploration\`, call \`workflow.visual\` once with 2–4 complete project-specific directions. It creates durable provider previews and vision grades. Then stop for the host preview selector: candidate selection and Visual Constitution approval are two separate user actions. Never replace them with a chat question, and never repeat a completed audition after compaction or restart.

During \`media-generation\`, call \`workflow.media\` for each required image/video node with only workflow/canvas/node identity and the current rowVersion. The host compiles, reserves, generates, grades, and performs bounded repair/regeneration. Never use \`canvas.generation\` for an active persistent run and never author a replacement grade or Repair Delta in chat.

After all production artifacts are accepted, call \`workflow.finalExport\` exactly once. Stop at its host gate. After exact approval, call \`render.start\` with the persisted Manifest revision/hash only; never send clip paths or replacement output settings. Reconstruct any later action from the export execution receipt.

Between gates, work autonomously within approved bounds:
- create/reuse entities and reference anchors from the approved documents;
- compile prompts through the deterministic compiler;
- generate, inspect, score, repair, and regenerate only while attempts and budget remain;
- preserve every attempt, artifact, evaluator score, and repair delta;
- pause and ask only when a material decision or approved bound must change.

Hard rules:
- Never mutate canvas or media before Production Plan approval.
- Never generate production media before Visual Constitution approval.
- Never export before Final Export approval.
- Never treat context compaction, chat clear, or app restart as permission to restart a completed stage.
- Never retry an ambiguous provider submission unless the host proves it is safe and idempotent.
- Fix partial failures at the smallest affected artifact; do not restart the entire production without evidence.`,
  ),

  defineProcessPrompt(
    'canvas-settings',
    'Canvas Settings',
    'Guidance for reading and updating canvas-scoped settings.',
    `Canvas settings (\`canvas.getInfo\` / \`canvas.setSettings\`) control canvas-wide defaults that propagate to every node on that canvas.

Key settings:
- \`aspectRatio\`: Default output aspect ratio for new image/video nodes (e.g. "16:9", "9:16", "1:1", "4:3"). Changing this does NOT retroactively resize existing nodes — only new nodes inherit the canvas default.
- \`visualStylePolicy\`: the canonical manual/pre-approval Canvas style draft. Legacy \`stylePlate\` is only a compatibility mirror. An approved persistent workflow always uses its immutable Visual Constitution instead.
- \`defaultProvider\`: Canvas-level provider override. When set, all generation on this canvas uses this provider unless a node has its own override. When null, the global active provider is used.

Rules:
- Read before writing: call \`canvas.getInfo\` to see current values before calling \`canvas.setSettings\`.
- Only set fields you intend to change — omitted fields are left untouched.
- Outside a bound persistent run, "set the style" or "lock the look" maps to \`visualStylePolicy\`; keep the legacy mirrors synchronized through \`canvas.setSettings\`.
- When the user asks to "change the format" or "make it vertical/horizontal", that maps to \`aspectRatio\`.
- Changing the manual draft after entities or reference images exist is a significant creative decision: use \`commander.askUser\` once because affected manual assets must be regenerated. For a bound persistent run, do not edit the Canvas draft; create and approve a new Visual Constitution revision through Gate 2.
- Changing \`aspectRatio\` mid-session only affects new nodes. Existing nodes keep their current dimensions.`,
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
    // Repo must exist before seed/migrate because both helpers delegate
    // through `this.get` / `this.repo`.
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
