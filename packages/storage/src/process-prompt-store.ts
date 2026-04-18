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
    `Character reference images are durable identity assets the whole pipeline trusts. They are not hero posters. Your job is to build a sheet the generator and downstream prompts can reuse across every shot.

Workflow — always, in order:
1. Call \`character.list\` (if you do not yet know the character) or rely on the ID Commander already gave you.
2. Call \`canvas.getNode\` / entity read is not enough — also read the existing reference images on the character record. Know which slots already exist and whether the current \`main\` turnaround is usable.
3. Pick ONE slot per generation call. Do not batch slots. Slots: \`main\` (turnaround sheet), \`back\`, \`left-side\`, \`right-side\`, \`face-closeup\`, \`top-down\`. Aliases like \`front\`, \`default\`, \`hero\`, \`rear\`, \`profile-left\` are normalized into these six — prefer the canonical name.
4. Decide what this slot must prove. Use the slot → goal table below.
5. Call \`character.generateRefImage\` with \`{ characterId, slot }\`. If the caller provided a \`prompt\`, it overrides the auto-built fallback — only pass a custom \`prompt\` when you intentionally want to add direction the entity fields do not capture. Otherwise omit it and let \`buildCharacterRefImagePrompt\` compile from the record.
6. Wait for success. Call ONE at a time. Verify the returned asset before starting the next slot.

Slot → goal table:
- \`main\` — two-row model sheet (3:2 landscape). Top row: full-body front, left profile, right profile, rear view at identical scale. Bottom row: head studies with neutral, happy, sad, angry, surprised, determined expressions. ANTI-COLLAPSE rules (state these explicitly in any custom prompt): one character only, neutral background, even studio light, no single-portrait collapse, no half-body crop, no missing side or back view, no hero pose.
- \`back\` — full-body rear view; hair shape, cape, backpack, back-fastening details must be legible.
- \`left-side\` / \`right-side\` — full-body profile; arms slightly away from the body so silhouette reads cleanly head to toe.
- \`face-closeup\` — six head-and-shoulders panels (2:3 portrait) with the same six expressions; direct gaze, maximum facial detail, same hairstyle and lighting in every panel.
- \`top-down\` — bird's-eye straight down; hair crown, shoulders, stance, posture.

Decision tree — do I regenerate or add a new slot?
- Existing \`main\` has wrong costume/hair/proportions → regenerate \`main\`; everything else will rebuild around it.
- Existing \`main\` is clean but you need a profile or rear → generate only the missing slot; do NOT regenerate \`main\`.
- Costume just changed on the character record → regenerate \`main\` first; re-run any downstream slots whose costume read is now wrong.
- Emotion range feels thin → regenerate \`face-closeup\` with a custom prompt extending the expression list. Do not touch \`main\`.

What to write (custom prompt) vs what to let the record carry:
- Put enduring identity in the entity record (face, hair, body, skinTone, distinctTraits, costume). \`buildCharacterAppearancePrompt\` assembles these automatically.
- Custom prompt text is for this-sheet-only guidance: slot-specific pose, alternate expression set, extra anti-collapse language, prop held for scale.
- Do NOT repeat record fields inside a custom prompt. That produces doubled descriptions that fight with the auto-compiled appearance line.
- Do NOT bury scene, environment, or story context in a ref-image prompt. Ref images are studio-neutral.

Quality language — prefer process vocabulary over adjective piles:
- Materials: "brushed wool", "oiled leather", "chipped enamel edge", "linen weave", "knurled metal grip". Not "high-detail fabric".
- Lighting: "even studio softbox", "3-point neutral setup, no cinematic rim". Not "beautiful lighting".
- Framing: "head-to-toe, no cropped feet", "head-and-shoulders framing, shoulders included". Not "good framing".
- Forbidden in ref-image prompts: "cinematic", "dramatic", "epic", "masterpiece", "8k", "hyperdetailed". These destroy identity stability.

Word budget (custom prompt, if any): 40-120 words. Beyond that you are duplicating the entity record or drifting into style decoration.

Common pitfalls — stop and fix if you catch any:
- Sheet collapses to one portrait → add explicit layout language: "two rows, top row four panels, bottom row six panels".
- Face drifts between expression panels → add "same face shape, same hairstyle, same colors, same lighting in every panel".
- Shadows mistaken for facial structure → demand "flat even studio lighting, no harsh rim, no deep cast shadows".
- Random background appears → demand "solid white background, no environment, no props unless required for scale".
- Extra character in the panel → demand "single character only, solo subject".

After generation:
- Promote the best result via \`character.setRefImageFromNode\` if it came from a canvas node, or \`character.setRefImage\` if the user picked a variant.
- If none of the variants hold up, describe what failed in one line ("profile view collapsed to 3/4"), then regenerate with corrective language targeting that specific failure. Do not retry blindly.
- Never silently accept a broken sheet. If the main turnaround is broken, downstream identity across the whole project will drift.`,
  ),
  defineProcessPrompt(
    'location-ref-image-generation',
    'Location Reference Image Generation',
    'Guidance for location reference image creation.',
    `Location reference images lock durable place identity — geography, landmarks, atmosphere, repeatable camera angles. They are concept-art model sheets, not dramatic one-off frames.

Workflow — always, in order:
1. Read the location record (and existing reference slots if Commander did not already surface them). Know which slots exist and whether their architecture, mood, weather, and lighting still match the current record.
2. Pick ONE slot per call. Slot vocabulary: \`main\` / \`wide-establishing\` (default), \`interior-detail\`, \`atmosphere\`, \`key-angle-1\`, \`key-angle-2\`, \`overhead\`. Any other slot string becomes a generic "<slot> angle view" — prefer canonical names.
3. Decide what this slot must prove. Use the table below.
4. Call \`location.generateRefImage\` with \`{ locationId, slot }\`. Only pass a custom \`prompt\` when the record fields do not capture the specific camera choice you need. Otherwise let \`buildLocationRefImagePrompt\` compile from \`description\`, \`architectureStyle\`, \`mood\`, \`lighting\`, \`weather\`, \`timeOfDay\`, \`dominantColors\`, \`keyFeatures\`, \`atmosphereKeywords\`, \`tags\`.
5. Call ONE at a time. Verify success before starting the next slot.

Slot → goal table:
- \`main\` / \`wide-establishing\` — wide establishing shot; full environment visible; cinematic composition; overall scale and layout readable; weather traces on the ground plane. Geography first, atmosphere second.
- \`interior-detail\` — architectural close study; furniture, joints, wear patterns, material transitions; shadows pool in recessed doorways.
- \`atmosphere\` — mood study; light and weather are the subject; "light filters through dusty panes", "shadows pool in recessed doorways", "rain collects in gutter channels".
- \`key-angle-1\` — primary camera angle for scene staging; eye-level cinematic; layered foreground / midground / background depth.
- \`key-angle-2\` — alternate angle of the same location; secondary details, circulation paths, back-of-room reveal.
- \`overhead\` — bird's-eye straight down; spatial layout, drainage lines, circulation paths.

Decision tree — which slot to build first?
- Brand-new location, no refs → \`main\` / \`wide-establishing\` first. Nothing else makes sense until geography is locked.
- Geography clear but shots keep drifting → add \`key-angle-1\` (most common repeat camera).
- Prompts keep losing mood → add \`atmosphere\`. Use it downstream as the lighting reference, not the layout reference.
- Scene relies on interior close-ups → add \`interior-detail\` before any interior node generation.
- Scenes will use blocking or movement → add \`overhead\` so spatial choreography has a ground plan.

What to write (custom prompt) vs what to let the record carry:
- Put durable place identity in the record: architecture, mood, weather tendencies, lighting logic, landmark structure, palette anchors.
- Custom prompt is for slot-specific camera language: "eye-level, 35mm equivalent, slight upward tilt revealing ceiling beams", "overhead orthographic, no perspective distortion".
- Do NOT write actor blocking, weather of a specific scene, or one-shot props into the ref image. That belongs on a node prompt, not on the location record.
- Do NOT write characters, figures, or people into any location ref. Location sheets are empty — \`buildLocationRefImagePrompt\` forces "No characters, no people, no figures, empty scene, environment only"; keep any custom prompt aligned with that rule.

Quality language — prefer process vocabulary:
- Surface: "cracked plaster", "lichen-stained stone", "rain-darkened wood", "sun-bleached concrete". Not "weathered".
- Light: "low-angle afternoon sun slicing through louvers", "overcast north-facing skylight", "sodium streetlamp pooling on wet asphalt". Not "moody lighting".
- Depth: "foreground planter, midground doorway, background corridor receding left". Not "depth".
- Forbidden words in ref images: "epic", "dramatic", "breathtaking", "cinematic masterpiece", "8k", "hyperdetailed".

Word budget (custom prompt, if any): 40-120 words.

Common pitfalls — stop and fix if you catch any:
- Time-of-day drift across the slot set → explicitly lock \`timeOfDay\` on the record, then echo it in every custom prompt.
- Random character appears → add "no characters, no people, no figures" and run \`location.deleteRefImage\` on the bad slot before retrying.
- Wide-establishing shows only a hero wall → add "full environment visible, reveal entry path and far boundary".
- Atmosphere slot ends up a realistic wide → add "atmosphere study, light and weather are the subject, environment recedes".
- Overhead becomes a perspective oblique → demand "orthographic top-down, no perspective distortion, camera looking straight down".

After generation:
- Promote the best result via \`location.setRefImageFromNode\` (from a canvas node) or \`location.setRefImage\` (from a variant).
- If results miss, describe the failure in one line and regenerate with corrective language. Do not retry blindly.
- When re-architecting a location (palette shift, renovation story beat), update the record first with \`location.update\`, then regenerate \`main\` and any slot whose architecture read now mismatches.`,
  ),
  defineProcessPrompt(
    'equipment-ref-image-generation',
    'Equipment Reference Image Generation',
    'Guidance for equipment reference image creation.',
    `Equipment reference images prove the object's silhouette, controls, materials, and handling. Treat the item as the subject. Environment mood never buries the form.

Workflow — always, in order:
1. Read the equipment record and its existing ref slots.
2. Pick ONE slot per call. Slot vocabulary: \`main\`, \`front\`, \`back\`, \`left-side\`, \`right-side\`, \`detail-closeup\`, \`in-use\`. Prefer canonical names.
3. Decide what this slot must prove. Use the table below.
4. Call \`equipment.generateRefImage\` with \`{ equipmentId, slot }\`. Omit \`prompt\` and let \`buildPrompt\` compile from \`description\`, \`function\`, \`material\`, \`color\`, \`condition\`, \`visualDetails\`, \`subtype\`, \`tags\` unless the record lacks a specific piece of info you need.
5. Call ONE at a time. Verify success before starting the next slot.

Slot → goal table:
- \`main\` / \`front\` — orthographic front; straight-on angle; full item visible; centered composition; default reference. Portrait framing (2:3) by default.
- \`back\` — orthographic back; rear details (sights, clasps, straps, hidden controls) readable.
- \`left-side\` / \`right-side\` — pure profile; silhouette clarity; scale control lines readable.
- \`detail-closeup\` — extreme macro; shallow DoF; fine surface textures, engravings, mechanical joints, wear marks; scale indicator if ambiguous.
- \`in-use\` — contextual action shot; generic human silhouette or anonymous hand ONLY for scale/grip reference; item is still the subject; minimal background.

Decision tree — which slot to build first?
- Brand-new equipment → \`main\` / \`front\` first; silhouette must lock before anything else.
- Silhouette is clean but material reads wrong in node generations → add \`detail-closeup\` so downstream prompts can reference the macro surface.
- Hero shots keep losing scale or grip → add \`in-use\`. Keep the human silhouette anonymous.
- Pipeline needs to model or kit-bash the object → add \`back\` + both profiles so the orthographic set is complete.

What to write (custom prompt) vs what to let the record carry:
- Put durable object identity in the record: \`function\`, \`material\`, \`color\`, \`condition\`, \`visualDetails\`, \`subtype\`, \`tags\`.
- Custom prompt is for slot-specific camera and lighting choices, scale indicators, or a specific handling posture for \`in-use\`.
- Do NOT write story context, owner identity, or environment drama into a ref image. Those belong on the node prompt for scene shots.
- Do NOT copy record fields into the custom prompt text — \`buildPrompt\` has already appended them.

Quality language — prefer process vocabulary:
- Material: "brushed steel", "anodized aluminum", "oiled walnut stock", "chipped enamel edge", "powder-coated matte black", "knurled grip". Not "cool material".
- Wear: "factory-new with shipping film still present", "field-used with oil rings on the grip", "battle-damaged with hairline cracks near the muzzle". Not "weathered".
- Joinery: "visible tig weld bead at the seam", "inset phillips fasteners at four corners", "hidden magnetic latch at the rear". Not "well-made".
- Forbidden in ref images: "epic", "dramatic", "masterpiece", "cinematic", "8k", "hyperdetailed". These turn product shots into concept-art collage.

Word budget (custom prompt, if any): 40-120 words.

Common pitfalls — stop and fix if you catch any:
- Background leaks in → demand "solid white background, no environment, no scene".
- Multiple objects appear → demand "single object, solo subject".
- Scale unclear on \`in-use\` → add "hand or silhouette at known scale, keep item as the subject, hand is anonymous and unlit".
- Macro slot loses silhouette context → add a small callout: "inset thumbnail showing full object for context at top-right corner" (optional, provider permitting).
- Orthographic shots show perspective distortion → demand "true orthographic projection, no vanishing points, no camera perspective".

After generation:
- Promote via \`equipment.setRefImageFromNode\` or \`equipment.setRefImage\`.
- If silhouette is broken, regenerate \`main\` before re-running any other slot. Every other slot leans on \`main\` reading correctly.
- If material read is the failure, regenerate \`detail-closeup\` with corrective material language rather than throwing more adjectives at \`main\`.`,
  ),
  defineProcessPrompt(
    'image-node-generation',
    'Image Node Generation',
    'Prompt compilation rules for image nodes.',
    `Image nodes produce the actual frames the film ships. Your job is to compile ONE prompt that reflects the real frame — subject, action, environment, lighting, composition — from every piece of context attached to the node. Never send only the raw node prompt when more context exists.

Workflow — always, in order:
1. Call \`canvas.getNode\` on the target node. Read the current \`prompt\`, attached \`characterRefs\`, \`equipmentRefs\`, \`locationRefs\`, and any incoming text edges.
2. Call \`canvas.getState\` (once per session, not per node) if you need the full edge map. Use that to find connected text nodes that feed context into this image node.
3. Call \`canvas.readNodePresetTracks\` on this node to see what camera, lighting, style, and quality direction the preset system is already carrying. Do not duplicate those into the compiled prompt text.
4. If character / location / equipment refs are missing, stale, or wrong entity, fix them with \`canvas.setNodeRefs\` before generation. Generating against missing refs produces identity drift that is hard to correct later.
5. Compile one unified prompt that covers the five elements below. Order them however the provider and scene read best — the five elements are the checklist, not a rigid sequence.
6. If the user has not clarified a significant creative choice (style direction, mood shift, alternate costume), call \`commander.askUser\` BEFORE calling \`canvas.generate\`. Technical execution proceeds autonomously; creative direction does not.
7. Call \`canvas.generate\` with \`{ canvasId, nodeId, nodeType: 'image' }\`. Always pass \`nodeType: 'image'\` — this routes the process prompt correctly. Set \`wait=false\` for fire-and-forget; set \`wait=true\` only when the next tool call depends on the output.
8. Verify result. If generation fails or drifts, correct the specific failure, do not retry blindly.

Five elements (every compiled prompt should cover all five; order by what the frame needs to communicate first):
- Subject: who or what is in the frame, identifying marks, current pose or state.
- Action: what is happening, directional intent — omit for pure portraits.
- Environment: concrete place, time, ground plane, surrounding props — only what is actually visible.
- Lighting: describe light as something that moves through and interacts with the scene. "Low-angle afternoon sun slicing through louvers, warm bounce off pale walls" beats "dramatic lighting".
- Composition: framing, camera distance, lens feel, focal anchor. "Medium close, 50mm feel, subject centered, midground doorway recedes left".

Provider hints for ordering:
- Flow-matching / SD-family models → lead with the subject so it stays prioritized.
- Midjourney-style providers → subject + composition early, style modifiers late.
- Edit / inpaint models → start with the change you want, since the base image already carries most elements.
- Follow the actual provider doc when specified. These are hints, not rules.

What to put in the compiled prompt vs where else it lives:
- Subject identity, costume, face → already carried by attached character refs. Do not re-describe. Just call the character by name and state what is different this shot (pose, injury, expression).
- Location geography, architecture → already carried by location refs. State only the part actually in the frame.
- Camera style (lens, film grain, grade, tone) → preset tracks carry this. Check \`canvas.readNodePresetTracks\` first; do not duplicate into prompt text.
- Scene-specific context (what the character is doing, what just happened, where the light is coming from) → THIS is what the compiled prompt is for.

Decision tree — which context shapes the prompt most?
- Node has a single strong text edge → treat that text as the scene brief, then filter down to what is visible in this frame.
- Node has multiple text edges → merge into one prompt, keep the most frame-relevant; drop off-frame context (audio cues, monologue, etc).
- Node has no text edges but rich entity refs → let refs carry identity; focus compiled prompt on action + environment + lighting.
- Refs missing, no text edges → STOP. Call \`canvas.setNodeRefs\` or ask the user what they want. Do not generate blind.

Anti-quality-stacking rules:
- Do NOT pile adjectives ("epic cinematic masterpiece, 8k, hyperdetailed, breathtaking, award-winning"). These destroy control.
- Do NOT repeat identity fields already carried by refs. That creates conflicts.
- Do NOT describe what is NOT in the frame (most modern image models actively include what you negate; use positive phrasing).
- Do NOT write style words that collide with preset tracks.

Word budget: compiled prompt 30-80 words. Hard stop at 120 — above that, models lose subject priority.

Common pitfalls — stop and fix if you catch any:
- Subject drifts from ref → check \`canvas.readNodePresetTracks\` for a conflicting style preset that is overriding ref; remove or update with \`canvas.updatePresetEntry\` / \`canvas.removePresetEntry\`.
- Environment ignores location ref → ensure the location ref is attached AND the compiled prompt names at least one concrete landmark from the location record.
- Too-flat lighting → add directional light language.
- Style collapses to generic "digital art" look → apply a shot template or color style via \`canvas.applyShotTemplate\` instead of stuffing style words in the prompt.

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
2. Call \`canvas.getState\` (if not already cached) to find incoming text edges and connected image nodes that might be first-frame or last-frame references.
3. Call \`canvas.readNodePresetTracks\` to see what camera, lens, and motion direction presets are already carrying.
4. If the clip depends on continuity images (first-frame image or last-frame image), verify them with \`canvas.setVideoFrames\`. First-frame and last-frame roles MUST be explicit — a video model that guesses direction from ambiguous anchors will drift.
5. Compile ONE shot using the three-part thinking model below (stage, describe, land). Write it as natural prose — no SCENE/ACTION/BEAT labels. 40-100 words.
6. If the user has not approved a significant creative or motion choice (pacing, cut strategy, alternate action), call \`commander.askUser\` first.
7. Call \`canvas.generate\` with \`{ canvasId, nodeId, nodeType: 'video' }\`. Pass \`nodeType: 'video'\` always so process routing stays correct. Set \`wait=true\` only when the next call depends on the output.
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

Word budget: part 1 ~10-15 words, part 2 25-70 words, part 3 ~5-15 words. Total 40-100 words as one flowing paragraph. Hard stop at 150.

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
    'audio-voice',
    'Audio Voice Generation',
    'Guidance for spoken-line voice generation.',
    `Voice nodes produce a single spoken line or short vocal delivery. The prompt IS the line; the emotion is structured data, not prose. Stay inside your provider's voice control capabilities.

Workflow — always, in order:
1. Call \`canvas.getNode\` on the target audio node. Read \`prompt\`, current \`audioType\`, \`emotionVector\`, attached refs, duration, providerId.
2. Call \`canvas.setAudioParams\` with \`{ audioType: 'voice' }\` if audioType is not already 'voice'. This also locks downstream process routing.
3. If the node is attached to a character ref, confirm the character ref is on the node. Some providers use it for voice cloning; without it they fall back to a generic voice.
4. Set \`emotionVector\` via \`canvas.setAudioParams\`. Fields: \`happy\`, \`sad\`, \`angry\`, \`fearful\`, \`surprised\`, \`disgusted\`, \`contemptuous\`, \`neutral\`. Each is 0-1. One dominant value (0.5-0.7) + small secondaries beats maxing one or spreading flat across all.
5. Write the \`prompt\` as the exact spoken text. No narration, no scene description.
6. Check provider capability (advanced emotion vector + voice cloning support varies by provider) via \`provider.list\` or provider settings before assuming.
7. Call \`canvas.generate\` with \`{ canvasId, nodeId, nodeType: 'audio', audioType: 'voice' }\`. Pass \`audioType\` explicitly so the process routes to voice-specific guidance.
8. Always listen to the result; voice failures are silent in transcript.

Voice prompt anatomy:
- Spoken text — verbatim, exactly as the character says it.
- Bracketed delivery cues inline: "[whispered] I know you're there. [louder, half-turning] You can come out now."
- Audible cues as bracket annotations only if the provider supports it: \`[breathy]\`, \`[cracks]\`, \`[long pause]\`, \`[sigh]\`.
- NOT in the prompt: "she sounds sad", "angrily", "with a smirk". Emotion goes in the emotion vector, not in prose.
- NOT in the prompt: scene context, who is speaking to whom, what came before. The model voices the text.

Emotion vector guidance:
- Single emotion (calm delivery): one field at 0.5-0.7, others at 0. E.g. \`happy: 0.6\`.
- Single emotion (intense delivery): one field at 0.7-0.9, \`neutral: 0.1-0.2\`. E.g. \`angry: 0.8, neutral: 0.1\`.
- Conflicted emotion (most interesting): two mid values + neutral fill. E.g. \`angry: 0.4, sad: 0.4, neutral: 0.2\`.
- Flat neutral narration: \`neutral: 0.9\`, everything else 0.
- Do NOT max all fields to 1.0. Delivery becomes manic or unstable.
- Sum does not need to equal 1.0, but keep total under ~1.2.

Character voice continuity:
- If the character's prior lines used a specific provider and voiceId, keep them. Switching voice providers mid-project breaks identity.
- Store recurring voice facts on the character record (voice description, cadence baseline) rather than in every prompt.

Provider capability gates (check before assuming):
- Advanced emotion vector: honored by some providers, silently ignored by others. When unsupported, vector is dropped — pre-bake emotion into text via bracketed cues instead.
- Voice cloning from image/audio: provider-specific, check capabilities.
- Long-form delivery (>30s continuous): most voice providers degrade. Split into multiple audio nodes.

Word budget:
- Prompt text: whatever the line is. No cap; that is the line.
- Bracketed cues: keep to 1-3 per line; more becomes noise.

Common pitfalls:
- Prompt describes the scene, not the line → rewrite to verbatim spoken text.
- Emotion in prose instead of vector → move to \`emotionVector\` via \`canvas.setAudioParams\`.
- Every vector field near 1.0 → back down to one dominant.
- Line length exceeds provider's continuous duration → split across multiple nodes.
- Character voice shifts across clips → lock provider + voiceId on first clip, reuse.

After generation:
- Listen. Voice failures are inaudible in transcript.
- If delivery is wrong, adjust \`emotionVector\` or bracketed cues — do not just reword the text.
- Promote selected variants via \`canvas.selectVariant\`.`,
  ),
  defineProcessPrompt(
    'audio-music',
    'Audio Music Generation',
    'Guidance for music / score generation.',
    `Music nodes produce structural audio — a bed, a theme, a transition. The prompt describes structure and role, not story synopsis. Length and genre choice depend on provider capability.

Workflow — always, in order:
1. Call \`canvas.getNode\` on the target audio node. Read \`prompt\`, current \`audioType\`, duration, providerId.
2. Call \`canvas.setAudioParams\` with \`{ audioType: 'music' }\` if not already set. This locks downstream process routing.
3. Check provider capability via \`provider.list\`. Some providers produce vocals + structure; most others do instrumental only.
4. Write the \`prompt\` using the music prompt anatomy below. 40-120 words.
5. Call \`canvas.generate\` with \`{ canvasId, nodeId, nodeType: 'audio', audioType: 'music' }\`. Pass \`audioType\` explicitly.
6. Always listen. Music failures (off-key, wrong genre, bad mix) are silent in transcript.

Music prompt anatomy (40-120 words):
- Genre anchor: "Indie folk", "Synth-heavy cinematic score", "Bossa nova". One tag, not five. Genre stacking confuses most music models.
- Structure: "Intro pad 8 bars, vocal enters bar 9, chorus at bar 17, outro fades from bar 33". Structure beats mood for models that listen to structure.
- BPM + key when known: "85 BPM, A minor". Providers that honor these produce tighter mixes.
- Texture and mix role: "sparse, vocals forward, bed underneath", "dense, wall-of-sound, no single lead". Tells the model where it sits in the final film mix.
- Instrumentation: "fingerpicked acoustic guitar, upright bass, brushed snare, no piano". Explicit omissions prevent the model from stuffing in unwanted elements.
- Vocal direction (if applicable): "breathy female vocal, lower register, no harmonies" or "instrumental only, no vocals".

What to write vs where else it lives:
- Scene mood / narrative tone → hint, don't paste. "Music for a quiet goodbye" is a hint; "Music for the third-act reunion where Anna finally tells Ben she's leaving" is a story synopsis, which confuses the model.
- Duration → set via \`canvas.setAudioParams\` or the node's duration field, not in prose.
- Provider choice → set via \`canvas.setNodeProvider\` (only when user has requested a specific provider) or rely on the canvas default.

Duration and loop strategy:
- 15-30s: short cue, sting, transition.
- 30-60s: standard cue, A-section + B-section possible.
- 60-120s: multi-section, verse-chorus-verse likely to degrade.
- 120s+: most music models produce loop-stitch artifacts. Split into sections as separate nodes or use a longer-form provider.

Genre pairing with provider:
- Orchestral / cinematic → providers with orchestral training. Avoid providers that default to EDM.
- Vocal-forward pop / indie → providers with vocal + lyric training.
- Synth / electronic → most providers handle well.
- Jazz / classical → quality varies widely. Test before committing.

Word budget: 40-120 words. Above 150 and most music models lose the plot.

Common pitfalls:
- Prompt is a story synopsis → rewrite around structure, BPM, texture.
- Genre stacked ("indie folk meets cinematic orchestral with ambient pad") → pick one primary genre + one texture hint.
- Requested vocals on an instrumental-only provider → switch provider or rewrite as instrumental.
- Duration exceeds provider capability → split or switch provider.
- Mix role unclear → add "bed underneath dialogue", "foreground cue, no dialogue".

After generation:
- Listen with the intended dialogue/video bed in mind. Music that is great solo can fight dialogue.
- If mix is wrong, regenerate with corrected mix-role language.
- Promote selected variants via \`canvas.selectVariant\`.`,
  ),
  defineProcessPrompt(
    'audio-sfx',
    'Audio SFX Generation',
    'Guidance for sound-effect and ambience generation.',
    `SFX nodes produce physical sound events or ambience loops. The prompt names the object, the action, and the acoustic environment. Layers beat blobs.

Workflow — always, in order:
1. Call \`canvas.getNode\` on the target audio node. Read \`prompt\`, current \`audioType\`, duration, providerId.
2. Call \`canvas.setAudioParams\` with \`{ audioType: 'sfx' }\` if not already set.
3. Check provider capability. Some providers support long seamless loops and high sample rates; others do not.
4. Write the \`prompt\` using the SFX anatomy below. 20-80 words.
5. Call \`canvas.generate\` with \`{ canvasId, nodeId, nodeType: 'audio', audioType: 'sfx' }\`. Pass \`audioType\` explicitly.
6. Listen to result; SFX failures (wrong layer, misread object, wrong acoustics) are silent in transcript.

SFX prompt anatomy (20-80 words):
- Object: what makes the sound. "Heavy wooden door", "brass zipper", "dropped ceramic mug".
- Action: what happens. "Slams closed", "unzips slowly", "shatters on tile floor".
- Environment acoustics: what room this is in. "Stone corridor with long reverb tail", "dry padded studio", "open field, no reflections".
- Layer list (optional but powerful): comma-separated sub-events in time order. "Metal on metal impact, short metallic ring, debris skitter aftermath" beats "metal impact".
- Mix role: "foreground hit, no music bed", "background ambience bed, seamless loop".

Foley vs ambience decision:
- Single event (hit, footstep, crash) → foley. Short clip (3-8s). Layers matter.
- Continuous environment (room tone, forest ambience, city street) → ambience. Long clip (15-30s), looped. Density matters.
- Character-made sound (breathing, clothing rustle, weapon handling) → foley, attached character ref useful.
- Non-diegetic sound (whoosh, riser, impact) → foley, environment = dry.

Environment acoustics vocabulary:
- Dry / anechoic → studio foley, no reverb.
- Small room → carpet, plaster, soft reverb ~0.3s.
- Large room → wood, stone, medium reverb ~0.8-1.5s.
- Cathedral / cavern → long reverb 2-4s+.
- Outdoor → no reflections, wind bed, distance cues.
- Underwater → low-pass filter language: "muffled, high frequencies absent".

Layer language:
- Comma-separated, time-ordered: "Ignition spark, low rumble build, bass impact, crackling sustain".
- Specify timing when needed: "Sharp attack at 0s, body at 0.2s, decay over 1.5s".
- Foreground vs background per layer: "foreground ceramic shatter, background crowd reaction".

Duration:
- Foley hits: 1-5s. Keep it short; padding becomes noise.
- Foley sustained (machinery, engine): 5-15s.
- Ambience loops: 15-30s. Ask provider to produce seamless loop if supported.
- Over 30s: most SFX providers degrade. Layer two 20s clips instead.

Word budget: 20-80 words. SFX usually needs less prose than voice or music.

Common pitfalls:
- Prompt is one word ("footsteps") → expand to surface + weight + environment + layers: "Heavy boots on wet cobblestones, slow pace, puddle splash on every third step, reverb tail ~0.5s".
- Emotional adjectives ("scary", "creepy") → describe physical sound instead: "Low drone at 40Hz, rising to 80Hz over 3s, metallic scrape layered on top".
- Wrong acoustic environment → lock environment first; downstream sound will fight if it mismatches neighboring shots.
- Loop stitches audible → request "seamless loop" explicitly and check provider capability; otherwise crossfade in post.
- Multiple unrelated events in one prompt → split into multiple SFX nodes, mix in post.

After generation:
- Listen for acoustic match with neighboring shots. A dry foley in a reverberant scene breaks immersion.
- Listen for layer legibility — if layers overlap too much, re-prompt with explicit timing.
- Promote selected variants via \`canvas.selectVariant\`.`,
  ),
  defineProcessPrompt(
    'node-preset-tracks',
    'Node Preset Tracks',
    'Guidance for node-level preset track operations.',
    `Preset tracks carry reusable cinematic grammar on each node — camera, lens, look, scene, composition, emotion, flow, technical. The goal is a readable category stack downstream compilation can trust without duplicating prompt text. Scene-specific facts never belong on a preset track.

Workflow — always, in order:
1. Call \`canvas.readNodePresetTracks\` on the node first. Know what is already there before changing anything. Never overwrite blind.
2. Identify which of the 8 categories you need to touch: \`camera\`, \`lens\`, \`look\`, \`scene\`, \`composition\`, \`emotion\`, \`flow\`, \`technical\`. Stay inside these — any other category name is invalid.
3. Decide whether this is a surgical edit (one or two entries inside one category) or a grouped rewrite (multiple categories moving together).
4. Pick the right tool:
   - \`canvas.addPresetEntry\` — add one entry to one category.
   - \`canvas.updatePresetEntry\` — modify one existing entry inside a category.
   - \`canvas.removePresetEntry\` — remove one entry.
   - \`canvas.writeNodePresetTracks\` — overwrite the full track set for one node, one or more categories at once.
   - \`canvas.writePresetTracksBatch\` — overwrite track sets on multiple nodes at once with the same payload (use for sequence-wide decisions).
5. Execute. For batch operations, verify the node list is correct before calling — these writes are not easily reversed.
6. Call \`canvas.readNodePresetTracks\` again after write if downstream reasoning depends on the final state.

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
- Fixing one wrong entry in one category → \`canvas.updatePresetEntry\` or \`canvas.removePresetEntry\`.
- Adding a new preset reference inside an existing stack → \`canvas.addPresetEntry\`.
- Rewriting a single category wholesale (e.g. swapping all camera entries) → \`canvas.writeNodePresetTracks\` with just that category.
- Applying the same camera+lens+look decision to 12 shots in a row → \`canvas.writePresetTracksBatch\`. Faster and atomic.
- Replacing the entire track set across categories → \`canvas.writeNodePresetTracks\` with all affected categories.

What goes on tracks vs elsewhere:
- Reusable camera/lens/look/composition grammar → tracks. These are the point of the system.
- Subject identity (who, what they wear, their face) → character / location / equipment refs, not tracks.
- Scene-specific action (what happens in THIS shot) → the node prompt, not tracks.
- Color palette and grade behavior → color-style record, referenced by \`look\` track entry or \`colorStyle.save\`.
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
1. Call \`preset.list\` to see existing presets in the relevant category before creating. Filter or scan the output so you do not duplicate an existing entry.
2. If editing, call \`preset.get\` first to read the current state. Do not write blind.
3. Make the change:
   - \`preset.create\` — add a new definition. Confirm the pattern is durable (recurs across shots), not a one-scene exception.
   - \`preset.update\` — modify an existing entry. Keep the category stable; migrating a preset across categories is its own decision.
   - \`preset.delete\` — remove an unused or superseded entry. Confirm no node currently references it (check preset track entries) before deleting.
   - \`preset.reset\` — restore a built-in preset to its factory defaults. Use when a user has edited a built-in and wants the original back.
4. Verify by calling \`preset.get\` on the edited preset, or \`preset.list\` to confirm the library list is correct.

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

Preset body word budget: 20-80 words. Under 20 is usually too vague; over 80 is usually scene-specific content leaking in.

Common pitfalls:
- Near-duplicate of an existing preset → refine the existing one instead of adding another; library bloat makes selection harder.
- Category drift (updating a \`look\` entry to include camera-direction text) → split into two presets.
- Scene-specific body text ("the warehouse scene's moody light") → rewrite into reusable grammar ("warehouse-style moody light: low-angle sodium source, long shadows, dust haze").
- Deleting a preset that is still referenced on nodes → broken node tracks; always check references first.
- Using \`preset.reset\` on a user-created preset (the tool only resets built-ins) → wrong tool; use \`preset.update\` to restore an older version.

After editing:
- If downstream nodes reference this preset, they will use the new version on next generation. Existing generated assets do NOT retro-update — regenerate if the change must land.`,
  ),
  defineProcessPrompt(
    'shot-template-management',
    'Shot Template Management',
    'Guidance for shot template creation and application.',
    `Shot templates package a bundle of preset grammar (camera + lens + composition, sometimes look and flow) that can be applied across nodes with one call. They accelerate shot planning by injecting reusable framing + motion structure while leaving node-specific subject and action untouched.

Workflow — always, in order:
1. Call \`shotTemplate.list\` to see existing templates before creating. Confirm there is not already a template that covers 80% of this pattern.
2. If editing, call the list or detail read to see the current bundle.
3. Make the change:
   - \`shotTemplate.create\` — add a new template. Confirm the bundle represents a durable, recurring pattern across shots.
   - \`shotTemplate.update\` — modify an existing template's bundled tracks.
   - \`shotTemplate.delete\` — remove a template. Verify it is not the only source of a recurring framing before deleting.
4. To apply: call \`canvas.applyShotTemplate\` on a single node or on a \`nodes\` array for batch application. The template's track set overlays onto the node; node-specific subject, action, and entity refs are preserved.
5. Verify by calling \`canvas.readNodePresetTracks\` on an affected node to confirm the template's tracks landed where expected.

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
- Include the primary camera decision in the name so \`shotTemplate.list\` is scannable.

Apply-vs-write decision tree:
- Same 4-5 shots share a framing pattern → one \`shotTemplate.create\` + one \`canvas.applyShotTemplate\` per shot (or batch via \`nodes\` array).
- One-off shot with a unique framing → do not create a template. Write tracks directly with \`canvas.writeNodePresetTracks\`.
- Need to tweak a template for one shot after applying → apply the template, then \`canvas.updatePresetEntry\` on the node for the local change. Do not fork the template for one deviation.
- Template needs to replace a whole bundle across 12+ nodes → batch apply via \`canvas.applyShotTemplate\` with a \`nodes\` array is atomic and safer than 12 sequential calls.

Common pitfalls:
- Template bundles character or scene identity → strip to grammar-only; identity belongs on entity records.
- Template owns too many categories → split into two narrower templates or keep as node-level edits.
- Name is scene-specific → rename to grammar-first so it is reusable and discoverable.
- Applying a template that conflicts with a pre-existing node edit → the application overwrites matching categories; check \`canvas.readNodePresetTracks\` before applying if the node has custom edits you want to preserve.
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
1. Call \`colorStyle.list\` to see existing styles before creating. Confirm there is not already a style that covers 80% of this look direction.
2. To create or update: use \`colorStyle.save\`. The tool upserts by id (create if new, update if existing).
3. To delete: use \`colorStyle.delete\`. Verify no active nodes or templates reference the style before removing.
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
- Look covers 80%+ of an existing style's description → extend the existing style via \`colorStyle.save\` (update path).
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
    'character-management',
    'Character Management',
    'Guidance for character CRUD work.',
    `Character records are durable identity sources. The whole pipeline reads from them — ref-image generation, node prompt compilation, voice direction, continuity checks. Write them with care, because fixing identity drift after 50 generated assets is painful.

Workflow — always, in order:
1. Call \`character.list\` first to see what already exists. Look for near-duplicates by name, role, or description before creating a new record.
2. For edits, call \`character.list\` (or \`canvas.getNode\` if the context surfaced the id) to read the current record. Never write blind.
3. For the actual write, pick the right tool:
   - \`character.create\` — new character.
   - \`character.update\` — modify an existing record. Surgical field edits are fine; large rewrites need user direction.
   - \`character.delete\` — remove a character. Verify no node currently references this character (check canvas refs) before deleting.
4. For reference images on this character, use the ref-image tools (\`character.generateRefImage\`, \`character.setRefImage\`, \`character.deleteRefImage\`, \`character.setRefImageFromNode\`) — see the character-ref-image-generation process guidance.

Field-placement rules — put facts where they belong:
- Durable identity (role, description, appearance, personality, face, hair, skinTone, body, distinctTraits, vocalTraits) → character record. These recur across every shot.
- Costume system (reusable outfits and equipment loadouts) → \`costumes\` array + \`loadouts\` array on the record. Keep costume descriptions compact and structured.
- One-shot pose, lighting, or camera angle → node prompt. Never bake transient state into the character record.
- Reference images (turnaround, profiles, face closeups) → \`referenceImages\` array, populated via the ref-image tools.
- Recurring emotional baseline (e.g. "stoic, rarely smiles") → \`personality\` field. Shot-level emotion goes on the node prompt.

Field-filling best practices:
- Use explicit, concrete language. "Warm amber eyes, heavy brow, asymmetric jawline" beats "striking face".
- Fill structured fields (face/hair/body) whenever you have the info — downstream ref-image compilation reads them. Empty structured fields weaken ref-image quality.
- \`description\` vs \`appearance\`: description is who they are in the story; appearance is how they look. Do not mix.
- \`personality\` is behavior grammar, not a monologue. "Stoic under pressure, dry humor, loyal to a fault" beats a two-paragraph backstory.
- \`distinctTraits\` should be image-visible and stable. "Prosthetic left hand" yes; "believes in fate" no (belongs in personality).
- \`loadouts\` link to equipment records; \`defaultLoadoutId\` is used when a node attaches this character without a specific loadout.

Common pitfalls:
- Writing personality as story synopsis → rewrite as behavioral grammar.
- Baking one-shot pose or emotion into the record → move to node prompt.
- Skipping structured fields when info exists → fill them in; the ref-image system uses them.
- Near-duplicate of an existing character → check \`character.list\` output carefully; consolidate rather than fork.
- Deleting a character referenced by active nodes → node refs become orphans. Check canvas refs first.

After editing:
- Existing generated assets do NOT retro-update. If the change affects identity, regenerate affected nodes (or at minimum, regenerate the character \`main\` ref-image before re-running shots).
- If costume or equipment loadout changed, node refs that use this character may need their \`loadoutId\` reviewed.`,
  ),
  defineProcessPrompt(
    'location-management',
    'Location Management',
    'Guidance for location CRUD work.',
    `Location records preserve durable place identity — architecture, layout, weather tendencies, lighting logic, landmark structure. They are the project's geographic continuity layer. Ref-image workflow is covered by the location-ref-image-generation process; this process handles the record itself.

Workflow — always, in order:
1. Call \`location.list\` to see what already exists. Look for near-duplicates by name, type, or subLocation before creating.
2. For edits, read the current record (via list or the context-surfaced id). Never write blind.
3. For the actual write, pick the right tool:
   - \`location.create\` — new location.
   - \`location.update\` — modify an existing record.
   - \`location.delete\` — remove a location. Verify no node currently references it before deleting.
4. For reference images, use the ref-image tools (\`location.generateRefImage\`, \`location.setRefImage\`, \`location.deleteRefImage\`, \`location.setRefImageFromNode\`) — see the location-ref-image-generation process guidance.

Field-placement rules:
- Durable place identity (type, subLocation, description, architectureStyle, mood, weather, lighting, timeOfDay, dominantColors, keyFeatures, atmosphereKeywords) → location record.
- One-shot actor blocking, transient weather, specific camera angle → node prompt. Never bake single-shot state into the record.
- Reference images (wide establishing, interior detail, atmosphere, key angles, overhead) → \`referenceImages\` array, populated via the ref-image tools.
- Repeat camera angles the project uses consistently → captured as key-angle ref slots on this record, not in presets.

Field-filling best practices:
- Concrete language, not taste words. "Cracked plaster walls, rain-darkened wood beams, flickering sodium bulb" beats "atmospheric".
- Fill structured fields (\`lighting\`, \`weather\`, \`architectureStyle\`, \`keyFeatures\`) whenever info exists — downstream ref-image compilation reads them.
- \`description\` is narrative role ("this is where Anna lost her sister"); \`mood\` is emotional grammar ("tense, unresolved"); \`atmosphereKeywords\` are short evocative tags. Keep them distinct.
- \`keyFeatures\` are image-identifiable landmarks. "Stained glass window above the entrance" yes; "history of conflict" no (belongs in description).
- Set \`type\` (\`interior\` / \`exterior\` / \`int-ext\`) — ref-image defaults read the layout from it.

Common pitfalls:
- Baking one-shot weather or blocking into the record → move to node prompt.
- Vague taste-word fields ("nice atmosphere") → rewrite with concrete architectural / lighting detail.
- Near-duplicate of an existing location → consolidate; prefer \`subLocation\` to capture variants of the same place.
- Deleting a location referenced by active nodes → node refs become orphans. Check canvas refs first.
- Forgetting to set \`type\` → ref-image defaults misread the layout; always set it.

After editing:
- Existing generated assets do NOT retro-update. If the change affects architecture or palette, regenerate affected nodes (or at minimum regenerate the \`main\` / \`wide-establishing\` ref-image first).
- If lighting or weather changed substantially, scenes that depend on continuity may need a coordinated regeneration pass.`,
  ),
  defineProcessPrompt(
    'equipment-management',
    'Equipment Management',
    'Guidance for equipment CRUD work.',
    `Equipment records preserve durable object identity — function, material, condition, surface details. They plug into character loadouts and get attached as node refs. The whole pipeline reads from them for prop continuity.

Workflow — always, in order:
1. Call \`equipment.list\` to see what exists. Look for near-duplicates by name, type, or subtype before creating.
2. For edits, read the current record first. Never write blind.
3. For the actual write, pick the right tool:
   - \`equipment.create\` — new piece.
   - \`equipment.update\` — modify an existing record.
   - \`equipment.delete\` — remove equipment. Verify no character loadout or node ref uses it before deleting.
4. For reference images, use the ref-image tools (\`equipment.generateRefImage\`, \`equipment.setRefImage\`, \`equipment.deleteRefImage\`, \`equipment.setRefImageFromNode\`) — see the equipment-ref-image-generation process guidance.

Field-placement rules:
- Durable object identity (type, subtype, description, function, material, color, condition, visualDetails) → equipment record.
- One-shot handling, a specific scene's damage state, a single shot's lighting → node prompt. Never bake transient state into the record.
- Reference images (front/back/profiles/detail/in-use) → \`referenceImages\` array, populated via the ref-image tools.
- Character association (who owns this, who carries it) → character record's \`loadouts\` array, not on the equipment record.

Field-filling best practices:
- Concrete material language, not taste words. "Knurled steel grip" beats "cool weapon".
- Fill structured fields whenever info exists — the ref-image system reads them.
- \`function\` is mechanical ("fires via gas-operated bolt"); \`description\` is narrative ("the rifle Anna took from her father"); do not mix.
- \`visualDetails\` are image-identifiable, small, stable. "Chipped enamel on the bolt" yes; "hand-made by her father" no (belongs in description).
- \`condition\` is baseline wear, not a story beat. If it changes across the story, use node-prompt language for the specific shots, not repeated record edits.
- Set \`type\` — ref-image defaults read the object category from it.

Common pitfalls:
- Baking one-shot damage or handling into the record → move to node prompt.
- Vague material fields ("high-quality metal") → rewrite with concrete surface language.
- Missing \`function\` field → downstream prompts struggle to convey what the object does in use shots.
- Near-duplicate of existing equipment → consolidate; use \`subtype\` or \`tags\` to distinguish variants of the same piece.
- Deleting equipment referenced by character loadouts → loadouts break. Check character records first.
- Forgetting to set \`type\` → ref-image defaults misread the object; always set it.

After editing:
- Existing generated assets do NOT retro-update. If material or condition changed, regenerate affected nodes (or at minimum regenerate the \`main\` ref-image first).
- If this equipment is in a character loadout used by multiple shots, coordinate regeneration across those shots for continuity.`,
  ),
  defineProcessPrompt(
    'canvas-structure',
    'Canvas Structure',
    'Guidance for canvas creation and structural organization.',
    `Canvas structure covers the canvas itself and the nodes on it — creating nodes, batch-creating whole subgraphs, duplicating, renaming, deleting, adding notes and backdrops, importing and exporting workflows. This is the skeleton of the film.

Workflow — always, in order:
1. Call \`canvas.getState\` once per session (metadata + edges) to orient. Use \`canvas.listNodes\` for paginated node scans (filterable by type or query). Use \`canvas.getNode\` for full detail, single id or batch \`nodeIds\` array.
2. Decide single-node vs batch before calling tools:
   - One node → \`canvas.addNode\`.
   - Multiple nodes with edges → \`canvas.batchCreate\` in one call (atomic, faster, fewer round-trips).
   - Copy an existing structure → \`canvas.duplicateNodes\` (returns new ids).
3. For canvas-level ops: \`canvas.renameCanvas\` (rename), \`canvas.deleteCanvas\` (destructive — verify before calling), \`canvas.importWorkflow\` / \`canvas.exportWorkflow\` (subgraph I/O).
4. For annotations: \`canvas.addNote\`, \`canvas.updateNote\`, \`canvas.deleteNote\`, \`canvas.updateBackdrop\`.
5. Verify by re-reading \`canvas.getState\` or \`canvas.listNodes\` when downstream reasoning depends on the final state.

Single-node vs batch decision tree:
- Creating one image node for a quick test → \`canvas.addNode\`.
- Creating a full scene (text brief + image + video chain) → \`canvas.batchCreate\` with nodes + edges in one payload. Atomic. Fewer failure modes.
- Creating 12 shots with identical structure → \`canvas.batchCreate\` once; do NOT loop 12 \`canvas.addNode\` calls.
- Duplicating an existing shot structure for a new scene → \`canvas.duplicateNodes\` with the source \`nodeIds\`; faster than reconstructing.
- Importing a known workflow template → \`canvas.importWorkflow\`.

Scene assembly patterns (batchCreate):
- Text-driven scene: text node (scene brief) → image node (establishing frame) → video node (first shot). Edges: text→image, image→video (as first-frame anchor).
- Image-first scene: image node → image node (variant angle) → video node. Edges chain left-to-right.
- Video chain: first-frame image → video node → last-frame image → next video node → last-frame image ... Each video reads first-frame from its upstream image and exports a last-frame image for the next.
- Parallel coverage: one image node per coverage angle (wide / medium / close), all attached to the same text brief upstream.

Notes and backdrops:
- \`canvas.addNote\` — freeform text annotation; useful for director notes, reminders, TODO markers. Notes do NOT participate in generation.
- \`canvas.updateBackdrop\` — visual grouping behind nodes; change color, padding, opacity, border, title size, lock-children. Use for act breaks, scene groups, workflow sections.
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
- Using \`canvas.addNode\` in a loop when \`canvas.batchCreate\` would do it in one call → slow, more failure modes, less atomic.
- Creating nodes without edges and then forgetting to connect them → orphan nodes the video pipeline cannot use. Prefer \`canvas.batchCreate\` so edges are declared together.
- Forgetting to set refs after node creation → generation falls back to naive prompt-only; set refs with \`canvas.setNodeRefs\` as part of the setup pass.
- Deleting a canvas thinking it was a node → \`canvas.deleteCanvas\` is project-level; \`canvas.deleteNode\` is node-level. Do not confuse.
- Importing a workflow into the wrong canvas → verify the target canvasId before importing.

After structural changes:
- Re-read state if downstream decisions depend on final node ids — \`canvas.batchCreate\` returns ids, but multi-step flows should still confirm with \`canvas.listNodes\` or \`canvas.getState\`.
- If the change removes nodes that were referenced by character loadouts or entity refs, those refs may now be orphans — audit afterwards.`,
  ),
  defineProcessPrompt(
    'canvas-graph-and-layout',
    'Canvas Graph And Layout',
    'Guidance for edges, ordering, and layout operations.',
    `Canvas graph-and-layout covers edges between nodes, layout positioning, and video frame anchors. This is the wiring of the film — how shots connect, how footage flows, how the graph is arranged for human readability.

Workflow — always, in order:
1. Call \`canvas.getState\` or \`canvas.listEdges\` (paginated) to see the current edge set.
2. For edges: pick the right tool:
   - \`canvas.connectNodes\` — add an edge from source to target.
   - \`canvas.deleteEdge\` — remove one edge.
   - \`canvas.swapEdgeDirection\` — flip the direction of an existing edge.
   - \`canvas.disconnectNode\` — remove all edges attached to one node in one call. Faster than multiple \`deleteEdge\` calls.
3. For video-specific frame anchoring: \`canvas.setVideoFrames\` locks the first-frame and last-frame image roles on a video node. Always use explicit roles — a video model that guesses direction from an ambiguous edge will drift.
4. For layout: \`canvas.layout\` runs the auto-layout on the canvas (or a subset). Call when the graph has grown disorganized or after a large \`canvas.batchCreate\`.
5. Verify by re-reading \`canvas.getState\` or \`canvas.listEdges\` when reasoning depends on the final state.

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
- \`canvas.swapEdgeDirection\` is rarely needed and often means the original edge was created in the wrong direction — prefer to delete and re-create cleanly.

Common pitfalls:
- Video node with ambiguous first/last frame roles → always call \`canvas.setVideoFrames\` explicitly even when the edge topology "looks obvious". Models do not see the edge semantics.
- Disconnecting one edge at a time when \`canvas.disconnectNode\` would clear all → slower, more failure modes.
- Running \`canvas.layout\` before the graph is structurally complete → layout re-runs can be needed after further edits; batch layout after major structural work.
- Leaving video chains without last-frame anchors → continuity breaks between clips.
- Creating edges between incompatible node types (audio → image, backdrop → anything) → pipeline ignores or errors; check the type pair before connecting.

After edge changes:
- Re-read \`canvas.getState\` if downstream generation depends on the edge topology.
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
1. Call \`provider.list\` to see which providers are currently registered and their id strings.
2. Call \`provider.getActive\` to see which provider is the current default for a given capability (image, video, audio). The active provider is what nodes use when no explicit provider is set.
3. Call \`provider.getCapabilities\` with a specific providerId to learn what that provider can actually do — resolutions, durations, lip-sync support, emotion vector support, max variant counts, cost tiers. Always call this BEFORE assuming a capability exists.
4. Pick the right write tool:
   - \`provider.setActive\` — change the default provider for a capability (image / video / audio).
   - \`provider.setKey\` — store an API key for a provider. Never write plaintext keys into tool-output logs or chat.
   - \`provider.update\` — modify settings on an existing registered provider.
   - \`provider.addCustom\` — register a custom or self-hosted provider endpoint.
   - \`provider.removeCustom\` — unregister a custom provider.
5. After credential or provider changes, re-verify via \`provider.list\` or \`provider.getCapabilities\` before running generations.

Capability checks — always query before assuming:
- Lip-sync: provider-specific. Many audio providers generate voice without lip-sync; only combined video+voice providers sync.
- Advanced emotion vector: honored by some providers, silently ignored by others. When unsupported, the vector is dropped.
- Variant count > 1: not all providers support it; check before setting \`variantCount\` on a node.
- Resolution limits: each provider has min/max. Setting image params outside the range will be clamped or rejected.
- Duration limits (video, music, SFX): provider-specific. Most video models degrade past 8s.
- Cost tier: some providers expose tiers. Reading this informs the user quote before they commit.

API key handling:
- Treat provider keys as secrets. Do not write them into notes, comments, or chat replies.
- \`provider.setKey\` stores the key securely; never print the key back in tool output for confirmation.
- If the user pastes a key in chat by mistake, call \`provider.setKey\` immediately and advise them to rotate the key.

Custom provider registration:
- \`provider.addCustom\` — takes provider metadata (endpoint URL, auth scheme, capability manifest). Use for self-hosted endpoints, private API gateways, or provider variants not in the built-in registry.
- Confirm capability manifest details with the user before registering — a wrong manifest causes silent failures downstream.
- \`provider.removeCustom\` — only removes custom-registered providers, not built-ins.

Active provider vs node-level provider:
- Active provider (this process) is the project-wide DEFAULT.
- Per-node provider overrides (set via \`canvas.setNodeProvider\`) are for specific shots that need a different provider from the active default — see the node-provider-selection process.
- Changing the active provider does NOT update nodes that already have explicit overrides.

Decision tree — when to change the active provider:
- The project is committing to a new primary provider for all image generation → \`provider.setActive\` for the image capability. Existing nodes with no override will pick up the new default on next generation.
- One specific shot needs a different provider → do NOT change active. Use \`canvas.setNodeProvider\` on that node only.
- Switching providers mid-project → warn the user; style and identity may drift across the boundary. Consider regenerating reference images under the new provider to lock identity.
- Testing a new provider → register with \`provider.addCustom\` (if not built-in), run a test node with explicit \`canvas.setNodeProvider\`, evaluate, then decide whether to promote to active.

Common pitfalls:
- Setting API key and immediately generating without calling \`provider.getCapabilities\` first → can mis-assume a feature exists.
- Changing the active provider mid-sequence without coordinating regeneration → identity and style drift between early and late shots.
- Printing or echoing API keys back to the user → security leak.
- Using \`provider.removeCustom\` on a built-in providerId → silently rejected; verify the provider is custom first with \`provider.list\`.
- Forgetting that existing nodes with explicit \`canvas.setNodeProvider\` overrides do not follow active-provider changes → audit overrides when switching defaults.

After provider changes:
- If the active provider changed and existing shots were generated under the old provider, a coordinated regeneration pass may be needed for visual consistency.
- Capabilities assumed earlier in the session may no longer match — re-check \`provider.getCapabilities\` after any provider swap.`,
  ),
  defineProcessPrompt(
    'node-provider-selection',
    'Node Provider Selection',
    'Guidance for assigning providers to nodes.',
    `Node provider selection covers setting a specific provider on a specific node (when that node must diverge from the project default) and estimating cost before committing to generation. This is per-node routing and budgeting.

Workflow — always, in order:
1. Call \`canvas.getNode\` to read the current node state — current \`providerId\`, any seed, current params.
2. Call \`provider.list\` and/or \`provider.getCapabilities\` if you do not already know what the candidate provider can do.
3. Decide if overriding the active provider is actually needed:
   - Shot requires a capability the active provider lacks (higher resolution, lip-sync, longer duration) → override is justified.
   - Shot is a style experiment needing a specific provider → override is justified.
   - Shot is a normal shot in the middle of a sequence → do NOT override; use the active default for consistency.
4. For override: \`canvas.setNodeProvider\` with the target providerId and optional seed. Use seed to lock reproducibility when you need deterministic regeneration.
5. For cost preview: \`canvas.estimateCost\` returns the provider-side cost estimate for generating this node with current params. Always use BEFORE batch-generating many nodes; cost surprises are avoidable.
6. Proceed to generation via \`canvas.generate\` — the node's overridden providerId takes effect.

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
- Single-shot estimate → call \`canvas.estimateCost\` on the target node, read the number, report to the user before generating.
- Batch sequence estimate → call \`canvas.estimateCost\` on a representative node, then multiply by the batch count for a rough total. For mixed-param batches, sum per-node estimates.
- Tier comparisons → \`canvas.estimateCost\` reads the node's current \`providerId\` and params; costs reflect those exact settings. Change params and re-estimate if you are comparing options.

Per-node params interaction:
- Node provider override and node params (image/video/audio config) are independent. Setting a new provider does NOT reset params — but params may now be out-of-range for the new provider. Re-validate with \`provider.getCapabilities\` after override.
- Clamped values: if a set param exceeds the provider's capability, the pipeline may clamp silently. Always cross-check capability before assuming the param you set is what will be used.

Common pitfalls:
- Override set but capabilities mismatch the new provider (e.g. asking for lip-sync on a pure text-to-speech provider) → generation fails or silently drops the feature. Always \`provider.getCapabilities\` on the target first.
- Forgetting \`canvas.estimateCost\` before a 50-node batch → user gets surprise bill. Estimate first, present, confirm.
- Seed left locked when iterating creatively → generations become stuck in one aesthetic lane. Unlock seed to explore.
- Seed unlocked during QA iteration → cannot reproduce the problem because seed changes each run. Lock during debugging.
- Override on every node "just in case" → defeats the point of active provider; maintenance burden grows.

After override:
- Verify with a test generation if capability mismatch is possible.
- If the override is promoted to project-wide later, consider \`provider.setActive\` and clear the per-node override for maintainability.`,
  ),
  defineProcessPrompt(
    'image-config',
    'Image Config',
    'Guidance for image parameter configuration.',
    `Image-config covers image-specific generation parameters via \`canvas.setImageParams\` — width, height, steps, cfgScale, scheduler. Set these per image node to control resolution, sampling effort, and style strength.

Workflow — always, in order:
1. Call \`canvas.getNode\` to read the node's current image params.
2. Call \`provider.getCapabilities\` on the node's active provider to learn valid ranges (min/max width, min/max height, supported schedulers, steps range, expected cfgScale range).
3. Decide what to change. Image params usually change for one of these reasons:
   - Resolution for final delivery (poster, print) needs higher width/height.
   - Aspect ratio needs to match a shot template or color-style decision.
   - Steps need tuning (higher = slower but more detail; lower = faster but can be undercooked).
   - cfgScale (classifier-free guidance) needs tuning: higher = more prompt adherence, lower = more creative drift.
   - Scheduler choice affects texture, sharpness, and behavior under low steps.
4. Call \`canvas.setImageParams\` with the target node and new params. Omit fields you do not want to change.
5. Verify via \`canvas.getNode\` if downstream reasoning depends on final state.

Parameter guidance:
- \`width\` / \`height\` — in pixels. Stick to multiples of 8 or 16; most image models quantize to those. Very small (<512) loses detail; very large (>2048 on consumer GPUs) risks OOM or long waits.
- \`steps\` — sampling iterations. Default 20-30 is safe for most providers. More steps beyond the provider's sweet spot often add little or degrade (over-cooking). Always check the provider's recommended range.
- \`cfgScale\` — how strictly the model follows the prompt. Flow-matching models (the newer class) expect low cfgScale (roughly 1-4); classic diffusion models expect higher cfgScale (roughly 6-12). Too high = burnt / saturated / overdetermined; too low = ignoring prompt. Always check the provider's documented range before guessing.
- \`scheduler\` — sampler choice. Euler, DPM++ 2M, DDIM, UniPC are common. Different schedulers produce different textures; some are faster per step but need more steps for equal quality.

Aspect-ratio-by-shot patterns:
- Cinema 2.39:1 → width:height ~1880:790 or scaled to provider limits.
- Standard widescreen 16:9 → 1920:1080, 1280:720.
- Portrait / mobile 9:16 → 1080:1920, 720:1280.
- Square 1:1 → 1024:1024, 768:768. Common for social / album art.
- Reference images → 3:2 or 2:3 depending on slot (character main = 3:2 landscape, equipment = 2:3 portrait).

Steps vs cfgScale tuning:
- Image looks undercooked (vague, noisy, unresolved) → raise steps first; if already high, check scheduler.
- Image looks over-saturated / burnt / over-detailed → lower cfgScale.
- Image ignores prompt elements → raise cfgScale (modest).
- Image matches prompt but feels flat → try a different scheduler or lower cfgScale slightly to let the model breathe.

Common pitfalls:
- Cranking steps to 100+ expecting better results → mostly wasted compute past the provider's sweet spot.
- Using a classic-diffusion cfgScale on a flow-matching model (or vice versa) → burnt or undercooked outputs. Always match cfgScale to the model family.
- Setting dimensions not divisible by 8/16 → provider quantizes or errors.
- Changing params without checking capabilities → silent clamping. Always \`provider.getCapabilities\` first.
- Scheduler drift across a sequence → neighboring shots generated with different schedulers feel visually mismatched. Lock scheduler at sequence level unless deliberately varying.

After param changes:
- Existing generated assets do NOT retro-update. Regenerate affected nodes to pick up new params.
- If changing resolution, downstream video nodes that expected the previous resolution may need re-framing.`,
  ),
  defineProcessPrompt(
    'video-config',
    'Video Config',
    'Guidance for video parameter configuration.',
    `Video-config covers video-specific generation parameters via \`canvas.setVideoParams\` — duration, audio, quality tier, lipSyncEnabled. Set these per video node to control clip length, audio embedding, render tier, and lip-sync behavior.

Workflow — always, in order:
1. Call \`canvas.getNode\` to read the current video params.
2. Call \`provider.getCapabilities\` on the node's active provider to learn duration limits, lip-sync support, and available quality tiers.
3. Decide what to change. Video params usually move for one of these reasons:
   - Clip duration needs to match a beat or match a connected audio node.
   - Quality tier needs adjustment (lower tier for iteration, higher tier for final).
   - Lip-sync toggle when embedding a voice onto a character video.
   - Audio parameter when the video must carry an audio bed (provider-dependent).
4. Call \`canvas.setVideoParams\` with the target node and new params. Omit fields you do not want to change.
5. Verify via \`canvas.getNode\`.

Parameter guidance:
- \`duration\` — clip length in seconds. Most video providers produce reliable results 3-8s; 8-10s is risky; beyond 10s, degrade is likely. Split longer beats into multiple video nodes connected via first/last-frame anchors.
- \`audio\` — whether to embed audio alongside the video (provider-dependent). Some providers generate video with audio baked in; others require a separate audio node.
- \`quality\` — tier selection. Provider-dependent (tier names and costs vary). In general: pick the lower tier for iteration (motion tests, prompt tuning, debugging) and the higher tier for final renders once motion is locked. Check \`provider.getCapabilities\` for the actual tier labels and relative costs.
- \`lipSyncEnabled\` — turn on when the video must sync mouth movement to an attached voice node. Requires provider support (\`provider.getCapabilities\` → lipSync).

Duration strategy:
- 3-5s → motion test. Lock action arc quickly without spending high-tier budget.
- 5-8s → final shot for most cuts. Sweet spot for reliable motion and controlled costs.
- 8-10s → only for one-beat oners. Models degrade; expect more failure retries.
- 10s+ → generally split into two video nodes connected via last→first frame anchor (see canvas-graph-and-layout).
- Audio-driven duration (voice line is 7s) → match video duration to audio duration, or split if audio exceeds model limits.

Quality tier strategy:
- Iteration phase → lower tier. Motion tests, prompt tuning, ref-attachment debugging. Burn cost on learning, not on final frames.
- Approval phase → move up a tier once motion is locked. Regenerate the locked shot at the final tier.
- Final delivery pass → highest tier the project justifies. Cost is justified because the shot ships.
- Do NOT jump to the highest tier before motion is locked — expensive mistakes.

Lip-sync toggle:
- Enable when the shot is a character speaking and the voice is a known audio node. Provider must support combined video+voice; query \`provider.getCapabilities\`.
- Disable when the shot has no on-screen dialogue or the voice is VO (off-screen). Lip-sync processing on silent characters can produce twitchy mouths.
- After enabling, verify the audio node is actually attached (usually via edge or first-frame link per the provider's convention).

Common pitfalls:
- \`lipSyncEnabled: true\` on a provider that does not support it → flag is silently dropped or generation errors.
- Highest tier used throughout iteration → budget burn; use a lower tier until motion locks.
- Duration set beyond provider capability → clamped, or generation fails. Always capability-check first.
- Audio embedded vs audio as separate node confusion → know which your provider prefers; mixed assumptions cause sync issues.
- Changing \`duration\` without checking the connected first/last-frame anchors → anchor positioning may be wrong for the new duration.

After param changes:
- Existing generated video does NOT retro-update. Regenerate to pick up new params.
- Duration changes affect downstream audio sync and edit-timeline assumptions; notify the user or adjust connected audio nodes.`,
  ),
  defineProcessPrompt(
    'audio-config',
    'Audio Config',
    'Guidance for audio parameter configuration.',
    `Audio-config covers audio-specific generation parameters via \`canvas.setAudioParams\` — audioType, emotionVector, sample rate, expressive controls. This process is about parameter plumbing; prompt/content guidance lives in the audio-voice, audio-music, and audio-sfx processes respectively.

Workflow — always, in order:
1. Call \`canvas.getNode\` to read the current audio params.
2. Call \`provider.getCapabilities\` on the node's active provider to learn emotion-vector support, sample rate options, duration limits, lip-sync compatibility.
3. Decide what to change:
   - \`audioType\` (\`voice\` / \`music\` / \`sfx\`) — set FIRST. This also routes the process prompt for downstream work. Changing audioType on a node mid-flight can leave prompts stale.
   - \`emotionVector\` — for voice only (and only when the provider supports it). Eight fields: \`happy\`, \`sad\`, \`angry\`, \`fearful\`, \`surprised\`, \`disgusted\`, \`contemptuous\`, \`neutral\`. Each 0-1.
   - Sample rate / duration / other provider-specific params — capability-dependent.
4. Call \`canvas.setAudioParams\` with the target node and new params. Omit fields you do not want to change.
5. Verify via \`canvas.getNode\`.

audioType selection — set this first:
- Node is attached to a character with spoken text → \`audioType: 'voice'\`. Routes to audio-voice process guidance.
- Node describes music structure (genre, BPM, instrumentation) → \`audioType: 'music'\`. Routes to audio-music process guidance.
- Node describes a physical sound event, impact, or ambience → \`audioType: 'sfx'\`. Routes to audio-sfx process guidance.
- Ambiguous → ask the user with \`commander.askUser\`; the audioType routes the entire downstream pipeline.

Emotion vector patterns (voice only):
- Single emotion, calm: one field at 0.5-0.7, others 0. Example: \`happy: 0.6\`.
- Single emotion, intense: one field at 0.7-0.9, \`neutral: 0.1-0.2\`. Example: \`angry: 0.8, neutral: 0.1\`.
- Conflicted emotion: two mid values + neutral fill. Example: \`angry: 0.4, sad: 0.4, neutral: 0.2\`. Most interesting for dramatic lines.
- Flat neutral narration: \`neutral: 0.9\`, others 0.
- Do NOT max all fields to 1.0. Delivery becomes manic or unstable.
- Sum target: under ~1.2 total. Keeping the total modest preserves delivery stability.

Provider capability notes:
- Emotion vector: some providers honor the full eight-dimension vector, others ignore it entirely (values stored but not applied). Check \`provider.getCapabilities\`.
- Sample rate: 24kHz standard for most voice; 44.1kHz or 48kHz for music and professional SFX. Some providers are fixed-rate.
- Duration: voice providers usually limit single-clip to 30-60s. Music providers 30-120s. SFX providers 5-30s.

Interaction with generation:
- \`canvas.setAudioParams\` does not generate — it only sets params. Call \`canvas.generate\` with \`nodeType: 'audio', audioType: <value>\` afterwards.
- Changing params after generation does NOT retro-update the generated asset. Regenerate to pick up new params.
- Emotion vector set but provider does not honor it → the audio generates normally but the emotion is ignored. No error. Always capability-check if the vector matters.

Common pitfalls:
- Setting emotion vector then using a provider that ignores it → silent drop. \`provider.getCapabilities\` first.
- Changing \`audioType\` mid-flow without regenerating and without updating the prompt → prompt still reflects the old type; new generation produces the wrong shape of audio.
- Vector fields all at 1.0 → manic or unstable delivery. Back down.
- Setting audioType to \`music\` on a character-attached node with a spoken-text prompt → the character ref and spoken prompt conflict with music generation; unset the character ref or switch audioType back to voice.
- Sample rate mismatch with the final mix → conversion artifacts. Lock the rate at the project's target rate early.

After param changes:
- Existing generated audio does NOT retro-update. Regenerate to apply new params.
- Emotion vector changes are low-cost to iterate — often cheaper to tune the vector and regenerate than to rewrite the prompt text.`,
  ),
  defineProcessPrompt(
    'script-development',
    'Script Development',
    'Guidance for reading, writing, and importing scripts.',
    `Script development covers reading, writing, and importing screenplay text — \`script.read\`, \`script.write\`, \`script.import\`. Scripts are the narrative spine of a Lucid Fin project; breaking them down into canvas nodes is a separate workflow step.

Workflow — always, in order:
1. Call \`script.read\` to load the current script text for the active project. Use this before any edit or breakdown — never write blind.
2. Decide the operation:
   - \`script.write\` — replace the project's script with generated or drafted content. This is the primary authoring path.
   - \`script.import\` — bring in an external script file from disk or a paste. This is the ingestion path for user-provided scripts.
3. After write or import, re-read with \`script.read\` if downstream steps depend on the final state.

script.write vs script.import decision tree:
- User pasted script text into chat → \`script.write\` with that text. Import is for file-path or binary input, not chat content.
- User referenced a file on disk → \`script.import\` with the path.
- Generating new script from a brief → \`script.write\` with the generated text. Confirm creative direction first via \`commander.askUser\` (story structure, tone, length).
- Converting a novel chapter → generate scene-level script via a subagent (novel-to-script is a system prompt), then \`script.write\` the output. Do not paste novel prose directly as script.

Fountain format basics:
- Scene headings / sluglines: \`INT. LOCATION - TIME\` or \`EXT. LOCATION - TIME\` or \`INT./EXT.\`. All caps, line-start, no indent.
- Action lines: plain text below the slug, present tense, concrete visual description. Short paragraphs.
- Character cues: CHARACTER NAME, all caps, centered by convention but Fountain leaves that to the renderer.
- Dialogue: directly under the character cue, indented in most renderers.
- Parentheticals: \`(sotto)\`, \`(off screen)\`, \`(CONT'D)\` — brief delivery cues under the character cue.
- Transitions: \`CUT TO:\`, \`FADE OUT.\`, all caps, right-aligned by convention.
- Dual dialogue: supported via Fountain's \`^\` marker when two characters speak simultaneously.

Script-to-canvas pipeline:
- Scene extraction: each slug defines a scene; nodes can be created per scene as \`canvas.batchCreate\` text → image → video chains.
- Character extraction: from action lines and dialogue cues, gather character names, then create character records (with \`commander.askUser\` for creative direction before \`character.create\`).
- Location extraction: from slugs, gather unique locations, then create location records (again, confirm direction first).
- Breakdown workflow: read script → identify scenes + entities → ask user to approve entity list → batch create entities → batch create canvas structure. Do NOT create entities or nodes without user approval for creative content.

Edit hygiene:
- \`script.write\` replaces the entire script text. Preserve the user's existing content by reading first, modifying, then writing — do not write a fragment assuming the pipeline merges.
- Large restructures (act reshuffles, scene deletions) warrant confirmation with the user before writing.
- Small fixes (typos, format normalizations) can proceed autonomously if the user has asked for them.

Common pitfalls:
- Using \`script.import\` for pasted chat content → import is file-based; use \`script.write\` instead.
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
    `Vision analysis covers reading visual content from images — \`vision.describeImage\` — and stateless text transformations like paraphrasing or summarization via \`text.transform\`. Three common intents drive vision work: reverse-engineer a prompt from an image, extract style for a color-style record, write findings back into a node's prompt.

Workflow — always, in order:
1. Identify the input image — usually a node asset hash, a canvas ref, or a file path the user provided.
2. Identify the intent before calling the tool. The prompt passed to \`vision.describeImage\` is what shapes the output; vague intent produces vague output.
3. Call \`vision.describeImage\` with the image + a targeted analysis prompt (see intents below).
4. Depending on intent, route the output:
   - Prompt reverse-engineering → use as seed text for a new node prompt via \`canvas.updateNodes\`.
   - Style extraction → use as the body of a new \`colorStyle.save\` record.
   - Entity extraction → use as the seed for \`character.create\` / \`location.create\` / \`equipment.create\`, with user approval.
   - Write-back to a node → use as the basis for updating an existing node's prompt via \`canvas.updateNodes\`.
5. If the user wants the transformed result re-shaped (summary, simplification, translation, etc.), chain \`text.transform\` on the vision output. \`text.transform\` does not look at the image — it only reshapes text.

Intent 1 — reverse-engineer prompt:
- Goal: produce a prompt that, if used with a generation model, would plausibly reproduce the image.
- Analysis prompt: "Describe this image as a concise image-generation prompt. Include subject, action, environment, lighting, composition, and style cues. 30-80 words. Natural prose, not keyword soup."
- Use case: user wants a similar frame, or wants to learn what makes an existing reference tick.

Intent 2 — extract style for color-style record:
- Goal: produce palette + grade + material-response description suitable for a \`colorStyle.save\` body.
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

text.transform usage:
- \`text.transform\` is stateless — it does not look at images or persistent state. Feed it text + a transformation intent.
- Common transforms: translate, summarize, expand, rephrase as screenplay action, extract bullet list, convert to structured JSON.
- Chain vision → text.transform when the vision output needs reshaping (e.g. vision produces prose, you need bullets for a UI list).

Common pitfalls:
- Vague analysis prompt → vague vision output. Always state the intent explicitly.
- Using vision output verbatim without review → hallucinated details may leak into records; skim before committing.
- Writing extracted entity fields without user approval → creative direction gate still applies; vision extraction is technical, entity creation is creative.
- Confusing \`text.transform\` as image-aware → it isn't. If the image matters, \`vision.describeImage\` must run first.
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
- Before a large \`canvas.batchCreate\` that adds many nodes.
- Before a sweeping preset or color-style change that affects many nodes.
- Before \`canvas.deleteNode\` in bulk or any \`canvas.deleteCanvas\`.
- Before a structural reorganization (big layout moves, edge restructures).
- Before running \`canvas.importWorkflow\` into a populated canvas.
- Before deleting a character / location / equipment record referenced elsewhere.
- Before \`script.write\` that replaces a user-authored script.
- Before major preset library cleanup (bulk \`preset.delete\`).
- Before the final render pass, as an insurance snapshot.

When NOT to snapshot (routine reads and small edits):
- Reading state (\`canvas.getState\`, \`canvas.listNodes\`, \`character.list\`).
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
- AFTER the restore completes: re-read state (\`canvas.getState\`, entity lists) to verify the restore landed and update the user.

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
    `Render and export covers the final-output pipeline — compiling generated canvas assets into a deliverable render, canceling renders, exporting bundles. Three tools: \`render.start\`, \`render.cancel\`, \`render.exportBundle\`.

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
5. When the render is complete: \`render.exportBundle\` packages the output + metadata into a deliverable archive.

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

Export bundle contents:
- \`render.exportBundle\` produces a packaged deliverable. Contents typically include the rendered video, project metadata, and the canvas state snapshot used for the render.
- Use after a successful render when the user wants the project ready for handoff (client delivery, archive, NLE import).
- Bundles may be large for video-heavy projects; confirm with the user before starting the export if storage is tight.

Common pitfalls:
- Starting a render without the pre-check → render fails mid-way, wasting minutes or hours of compute. Pre-check is non-optional.
- Forgetting to set video frame anchors → rendered video drifts between clips; the "render looks fine but continuity is broken" failure mode.
- Canceling a render on a minor issue instead of letting it finish → if the issue is cosmetic, finishing and regenerating the affected shot post-render is often cheaper than restarting everything.
- Not monitoring long renders → user doesn't know progress; communicate milestones.
- Assuming \`render.exportBundle\` re-renders — it doesn't, it packages the latest render output. Re-render with \`render.start\` if output is stale.

After render and export:
- Notify the user of completion with the bundle location and a summary (duration, shot count, any warnings from the render log).
- If warnings or errors occurred in the render log, surface them — silent failures erode trust in the pipeline.`,
  ),
  defineProcessPrompt(
    'workflow-orchestration',
    'Workflow Orchestration',
    'Guidance for workflow expansion and control.',
    `Workflow orchestration covers two tools: \`workflow.expandIdea\` (concept → structured scene/shot text) and \`workflow.control\` (pause / resume / cancel / retry on in-flight workflow runs). These tools drive the higher-level creative pipeline — turning a director brief into canvas structure.

Workflow — always, in order:
1. For creative expansion: call \`workflow.expandIdea\` with a concept prompt (e.g. "A heist set in a decommissioned observatory, 8 shots, tense pacing"). Returns structured scene/shot text that can seed canvas node creation.
2. Expanded output is creative content the user has not approved — before acting on it, call \`commander.askUser\` to confirm the expansion direction, or present the expansion and ask for edits.
3. Once approved, seed canvas structure: pass scenes through \`canvas.batchCreate\` (one batch per scene with text+image+video nodes), then iterate.
4. For controlling in-flight workflows: \`workflow.control\` with the target workflowId and action (\`pause\` / \`resume\` / \`cancel\` / \`retry\`).

expandIdea usage patterns:
- Story concept → scene breakdown: "Expand this logline into a scene list with beats for each scene. 8 scenes max."
- Scene concept → shot list: "Expand this scene into a shot list with action lines and coverage angles."
- Character concept → backstory and motivation: "Expand this character premise into a structured character description including role, personality, distinct traits, and story arc."
- Location concept → place identity: "Expand this location premise into architecture, mood, lighting, recurring features."
- The prompt you pass shapes the structure of the output; explicit structure requests (scene count, shot count, field list) produce more usable output.

Creative-expansion decision tree:
- User provides a rich brief → \`workflow.expandIdea\` may be unnecessary; parse the brief directly.
- User provides a one-liner → \`workflow.expandIdea\` is the right tool; then confirm the expansion with the user before acting.
- User asks "what would a full scene look like" → \`workflow.expandIdea\` for one scene only; show the user; do not proliferate without approval.
- Expansion returns content the user has not approved → STOP. \`commander.askUser\` to review before anything is saved to records or canvas.

workflow.control actions:
- \`pause\` — suspend the workflow run. In-progress tool calls may complete, but queued ones halt. Useful when the user wants to review mid-run.
- \`resume\` — continue a paused workflow from where it paused.
- \`cancel\` — abort the workflow entirely. Already-completed work persists; remaining steps are abandoned.
- \`retry\` — re-run a failed step or a failed workflow. Useful after fixing the root cause of a failure.

When to use workflow.control:
- Long workflow hitting a clearly wrong branch → \`pause\`, review with user, decide to \`cancel\` or adjust and \`resume\`.
- Workflow failed mid-run due to transient error → \`retry\`.
- User changed their mind mid-run → \`pause\`, discuss with user, \`cancel\` or adjust.
- Workflow stuck in a retry loop on a persistent error → \`cancel\`, fix root cause, restart fresh.

Workflows vs manual tool chains:
- Use workflows when the pipeline is well-defined and repeatable (concept expansion, shot breakdown, batch generation).
- Use manual tool chains when the work is exploratory, one-off, or requires tight user interaction at each step.
- Workflows buy speed and repeatability at the cost of mid-flight transparency; manual chains invert that tradeoff.

Common pitfalls:
- Acting on \`workflow.expandIdea\` output without user approval → creative content gate is still active; always \`commander.askUser\` before persisting expansion to records or canvas.
- Using \`workflow.control\` without knowing the workflowId → fetch the id from the workflow's start response or from the running-workflow registry.
- Canceling instead of pausing → if the user might still want the work, \`pause\` preserves the option. \`cancel\` is final.
- Retrying without addressing the root cause → loops until the retry budget expires. Fix first, retry second.
- Expanding too many scenes at once → expansion is creative; large expansions overwhelm review and risk scope drift. Prefer scene-by-scene expansion with user check-ins.

After workflow operations:
- \`workflow.expandIdea\` outputs text only; nothing persists until you explicitly write records, scripts, or canvas nodes.
- \`workflow.control\` results affect the in-flight run; re-check workflow status to confirm the control action landed.`,
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
   - User wants to reuse a generated canvas node's output as a library asset → the ref-image tools (e.g. \`character.setRefImageFromNode\`) handle this directly; no separate import needed.
3. Call \`asset.import\` with the source and intended usage metadata (type, tags, descriptive name).
4. Verify via \`asset.list\` that the import landed.

When to use asset.import:
- Onboarding user-provided reference imagery (a photo of the actor who inspires the character, a location scout photo, a prop sketch).
- Onboarding user-provided final deliverables (client-provided logo, brand imagery, approved test frame).
- Bringing back exports from an external tool (retouched frame from Photoshop, re-colored still from DaVinci).
- Importing a previously exported bundle's assets into a new project.

When NOT to use asset.import:
- Attaching a generated canvas node's output as an entity ref → use \`*.setRefImageFromNode\` (\`character.setRefImageFromNode\`, \`location.setRefImageFromNode\`, \`equipment.setRefImageFromNode\`). Those tools wire the asset correctly without a manual import round-trip.
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
- The asset is in the library but not yet attached to any node or entity. Further steps (\`canvas.updateNodes\`, \`canvas.setNodeRefs\`, \`character.setRefImage\`) are needed to use it.
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
  {
    legacyKey: 'audio-generation',
    replacementKeys: ['audio-voice', 'audio-music', 'audio-sfx'],
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
