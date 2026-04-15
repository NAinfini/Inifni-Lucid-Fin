import { createRequire } from 'node:module';
import type BetterSqlite3 from 'better-sqlite3';

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

export const PROCESS_PROMPT_DEFAULTS: ProcessPromptDefault[] = [
  {
    processKey: 'ref-image-generation',
    name: '参考图生成',
    description: '用于角色、地点与设备参考图创建的指导。',
    defaultValue: `Reference image generation guide:

Mission:
- Build production-grade reference images that improve downstream consistency, not flashy one-off artwork.
- Start from stored entity data. Only infer missing details conservatively and only when they are needed to complete a coherent visual instruction.
- Keep the image readable as a reference sheet: clear silhouette, clear materials, clear lighting, clear slot purpose.
- Default deliverable for character refs is one turnaround sheet at 2048x1360 unless the user explicitly approves a different output.

Core workflow:
1. Read the entity record and existing reference slots first. Reuse or replace deliberately instead of generating blindly.
2. Decide which slot is being generated and what information that slot must prove: identity, silhouette, material, layout, atmosphere, or usage.
3. Build one unified prompt from structured fields, then add slot-specific framing and exclusion rules.
4. Prefer explicit physical description over hype words. Describe anatomy, wardrobe, materials, weathering, architecture, scale, and lighting behavior.
5. Avoid quality-stacking terms such as "8k", "masterpiece", "ultra detailed", or similar filler. Use process language instead: fabric bunches, brushed metal catches light, fog hangs, shadows pool, dust clings.
6. Include negative concepts inline through plain language: no extra characters, no crowd, no props unless the slot requires them, no scene clutter, no text labels, no collage chaos.

Character reference rules:
- Default goal is a clean turnaround sheet for one character only.
- Keep the same person across every panel: same facial structure, body proportions, costume construction, hair shape, and color relationships.
- Prefer neutral studio setup: solid white or light neutral background, even studio lighting, no environment, no dramatic action pose.
- Use full-body views for silhouette slots and tight head-and-shoulders views for expression or face slots.
- Describe clothing by construction and material, not by vague style labels: waxed canvas coat, scuffed leather boots, matte nylon straps, brushed brass buckle.
- For turnaround or standard-angle work, prioritize front, three-quarter, side, and back readability. Arms should not hide silhouette-critical costume features.
- Negative concepts for character refs: no extra people, no props, no background scene, no weapon flourish unless the slot explicitly needs it, no pose variation that changes proportions.

Location reference rules:
- Treat the location as the subject. People should be absent or minimized unless a tiny scale cue is essential.
- Keep time of day, weather, architecture, and atmosphere consistent across panels of the same sheet.
- Prioritize spatial readability: approach, entry, circulation path, key landmarks, foreground-to-background layering, and lighting direction.
- Use environment process language: light filters through dust, puddles reflect signage, fog settles in corners, concrete sweats moisture, curtains lift in a draft.
- Wide-establishing slots should explain the full environment. Key-angle slots should show usable camera positions. Atmosphere slots should emphasize mood through light, weather, and particulate behavior.
- Negative concepts for location refs: no random characters, no crowd action, no unrelated props dominating frame, no inconsistent weather or time jump between panels.

Equipment reference rules:
- Make the item legible as an object first. Silhouette, form factor, joinery, wear pattern, controls, and material transitions matter more than cinematic mood.
- Front, back, and side slots should read like clean product or orthographic references.
- Detail-closeup slots should emphasize surface texture, engravings, seams, switches, fasteners, or damage patterns.
- In-use slots may include a generic human silhouette or anonymous hand only to clarify scale and handling. Never turn the slot into a character portrait.
- Use material/process language: knurled steel grip, chipped enamel edge, rubberized handle, oil-stained hinge, heat discoloration near exhaust port.
- Negative concepts for equipment refs: no environment storytelling unless the slot requires it, no clutter tableaus, no decorative over-rendering that hides core form.

Dimensions and composition:
- Character and location sheets usually want wide landscape composition so multiple panels can breathe.
- Equipment often benefits from tall portrait composition for front-to-back readability, except when multiple orthographic panels need width.
- Keep scale consistent across panels. Do not allow one view to zoom or crop so much that comparison becomes useless.

Reference attachment rules:
- Before attaching reference images to any image or video generation call, check provider limits with provider.getCapabilities.
- If the provider limit is unknown, default to one reference image.
- Choose the most informative ref for the intended frame: face-closeup for close shots, front or three-quarter for medium character shots, wide-establishing for location-wide shots, detail-closeup only when the generated shot truly needs material detail.
- Never hardcode a reference-image count. Query capability first, then select the strongest refs.`,
  },
  {
    processKey: 'image-node-generation',
    name: '图像节点生成',
    description: '用于图像节点提示词编排的规则。',
    defaultValue: `Image node generation guide:

Prompt compilation order:
1. Read the node title, prompt, negativePrompt, current params, provider, and attached refs.
2. Read every referenced character, location, and equipment record that is actually visible in the intended frame.
3. Read current preset tracks or shot template state before writing prompt text so you do not duplicate camera/look/lighting instructions already carried by presets.
4. Compile one unified scene description. Do not paste disconnected fact fragments.

Core formula:
- Subject + physical state
- Action or frozen behavior
- Foreground, midground, and background spatial layers
- Material and texture detail
- Sensory anchors that convert abstract intent into filmable evidence

Scene-writing rules:
- Describe one coherent image, not a sequence of edits.
- Match detail density to shot scale. Close shots need face, skin, fabric, and expression detail. Wide shots need silhouette, blocking, architecture, weather, and depth cues.
- Use nouns and verbs that imply physical behavior: coat hem drags across wet tile, condensation blooms on glass, sodium light grazes chipped paint, smoke gathers near ceiling beams.
- Prefer concrete evidence over abstract labels. Replace "sad" with jaw set tight, reddened eyelids, untouched food, or slumped shoulders if that emotion should be visible.
- Keep the prompt unified around what is inside the frame. Do not mention entities or props that are not visually present and identifiable.

Preset interaction:
- Presets own reusable cinematic grammar: camera, lens, look, scene lighting, composition, emotion, flow, and technical defaults.
- The node prompt owns scene-specific substance: who is here, what they are doing, what the place looks like right now, what materials and traces the frame reveals.
- If presets already imply a dolly-in, anamorphic look, or low-key lighting, do not restate those instructions in the prompt unless the node truly needs an exception.

Spatial and texture language:
- Write with layered depth: foreground obstruction or texture, main subject plane, background architecture or atmosphere.
- Call out meaningful surfaces: oxidized copper, damp concrete, cigarette haze, wool fibers, cracked lacquer, pearlized plastic, greasy fingerprints, standing water.
- Let light interact with matter: reflections, translucency, shadow falloff, haze, steam, dust, rain streaks.

Entity and ref rules:
- Attach character refs only when the character is visible and identifiable in the frame.
- Attach equipment refs only when the object is on screen and design continuity matters.
- Attach location refs when the location identity or layout matters to the shot.
- Use the most frame-relevant ref, not the maximum number of refs.

Anti-quality-stacking:
- Do not pad prompts with empty quality adjectives.
- Do not spam style keywords when a preset already carries style direction.
- Favor process, material, and staging language over generic "cinematic", "epic", "high detail", or "best quality" filler.

Word budget:
- Aim for roughly 150 to 200 words of useful image description before provider trimming.
- If the shot is simple, stay concise, but every sentence must add visible information.
- Use negativePrompt only for real exclusions such as extra limbs, duplicate characters, unwanted text, clutter, distortion, or background intrusions.

Pre-generate checklist:
- The prompt clearly states subject, action/state, and environment.
- The prompt contains spatial layering and material detail, not just adjectives.
- Attached refs match what is actually visible.
- Presets are present when reusable cinematic grammar is needed.
- Media config is already set to the intended aspect ratio and quality level.
- No major creative gap is being silently invented. If the image depends on an unapproved creative choice, ask the user first via commander.askUser.

Operational sequence:
1. Read the node with canvas.getNode and inspect current prompt, negativePrompt, refs, provider, and status.
2. If the node already has a shot template or preset stack, inspect it with canvas.readNodePresetTracks before rewriting any text.
3. If multiple related image nodes need coordinated edits, prepare all prompt revisions first and write them together with canvas.updateNodes using the nodes array form.
4. If refs are missing or wrong, fix them with canvas.setNodeRefs before generation so prompt and ref evidence agree.
5. If the shot needs explicit provider or media config changes, use canvas.setNodeProvider or canvas.setImageParams instead of burying technical instructions inside prose.

Decision tree:
- If the shot is a clean reference-style plate, reduce environment prose and emphasize silhouette, materials, and framing discipline.
- If the shot is a dramatic story frame, increase atmosphere, foreground blockers, and scene-state evidence, but keep the action frozen to one decisive instant.
- If the node exists mainly to anchor a later video shot, optimize for readable first-frame clarity rather than maximal spectacle.
- If the node prompt keeps growing because style, camera, and technical constraints are being repeated, move those instructions into preset tracks or params and trim the prompt back to scene substance.

Quality review:
- Ask whether a stranger could sketch the frame from the prompt alone.
- Ask whether the chosen refs prove the same identity, location, or object that the text describes.
- Ask whether the negative prompt removes genuine failure modes instead of acting as a dumping ground for taste words.
- Use canvas.previewPrompt before expensive runs when the node carries many presets, refs, or provider-specific constraints.

Common failure modes:
- The prompt reads like a synopsis instead of a frame.
- The subject is clear but the environment has no layered depth.
- Refs point to entities that are not visible in the shot, diluting composition control.
- The node prompt repeats lens, lighting, and grade terms that are already encoded in presets, causing compiled prompts to bloat.
- The negativePrompt suppresses useful texture or atmosphere because it was copied from an unrelated node.

Provider adaptation:
- Short, clean prompts often outperform bloated ones when strong refs and preset tracks are already doing the heavy lifting.
- For heavily stylized providers, anchor the prompt with material and lighting behavior so the result stays scene-specific.
- When provider capability or ref count is uncertain, confirm with provider.getCapabilities and default to the safest configuration instead of guessing.`,
  },
  {
    processKey: 'video-node-generation',
    name: '视频节点生成',
    description: '用于视频节点提示词编排的规则。',
    defaultValue: `Video node generation guide:

Mission:
- Generate one usable clip, not an entire scene summary.
- Think in motion, force, timing, and continuity.
- Keep each node scoped to a single shot-sized beat that can connect cleanly to surrounding nodes.

Clip design rules:
- Standard planning target is 10 to 15 seconds per clip, but shorter is better when the beat is simple.
- Use 3 to 5 seconds for a quick insert or micro-action, 5 to 8 seconds for one clear motion phrase, and 8 to 12 seconds for a fuller action with reaction or environmental response.
- Do not stuff multiple separate camera setups or story beats into one video prompt.

Workflow:
1. Read the node, current video params, refs, connected frame nodes, and preset tracks.
2. Determine whether this is text-to-video or image-to-video.
3. For shots that rely on first or last frames, verify the frame nodes and edge directions before generation.
4. Write one continuous motion description that starts from the visible state and evolves through a single action arc.
5. Verify duration, audio, lipSyncEnabled, provider capability, and frame references before calling canvas.generate.

Text-to-video rules:
- Describe the full evolving beat: subject motion, camera motion when needed, environmental motion, and end-state tendency.
- Keep the action continuous and readable. One strong verb phrase is better than a checklist of tiny actions.
- Include how the environment pushes back: wind shoves fabric sideways, wheels skid on gravel, puddles ripple under footsteps, breath clouds in cold air.

Image-to-video rules:
- The source image already anchors appearance, framing, and most static detail.
- Use the prompt mainly for temporal change: head turns, cloth flutters, embers drift, camera eases forward, expression softens, hand tightens.
- Keep image-to-video prompts focused, usually 15 to 40 words, unless the motion is unusually complex.
- Do not rewrite the whole still frame unless a specific change must be emphasized.

Motion language:
- Tie movement to physics and resistance: sway, recoil, compress, skid, drift, snap, settle, scatter, billow, tighten, buckle, slide, pulse.
- Give motion a rhythm: abrupt, hesitant, delayed, accelerating, easing, stuttering, lingering.
- If the camera moves, describe the intention and feel, not a stack of generic buzzwords.

First/last frame workflow:
- When a shot needs keyframed control, use image -> video for first frame and video -> image for last frame.
- Treat first frame as the starting visual contract and last frame as the arrival state.
- Verify canvas.setVideoFrames data or equivalent node state before generation. Do not assume edges alone are enough.

Camera and continuity:
- Presets should carry reusable camera grammar when possible.
- The prompt should focus on motion inside the frame unless the shot needs an intentional camera exception.
- Preserve continuity with attached character, location, and equipment refs, and with first/last frame references when present.

Word budget:
- Text-to-video: aim for roughly 100 to 150 words of useful motion-rich description.
- Image-to-video: usually 15 to 40 words focused on change over time.
- Avoid adjective stacks and static image prose that do not contribute to motion or continuity.

Pre-generate checklist:
- The clip represents one clear beat.
- Duration matches the amount of action described.
- Presets, refs, and frame nodes are aligned with the intended shot.
- Audio and lip-sync settings are checked when dialogue or music matters.
- Provider capability is confirmed for requested duration, audio, frame refs, or quality tier.
- No unapproved creative invention is hiding inside the motion plan.

Tool sequence:
1. Read the node and adjacent edge state with canvas.getNode plus canvas.listEdges when frame or audio dependencies matter.
2. For continuity-sensitive shots, wire first and last frame image nodes first, then commit them with canvas.setVideoFrames.
3. Set motion-critical parameters with canvas.setVideoParams rather than stuffing duration or audio instructions into prompt prose.
4. Confirm refs with canvas.setNodeRefs when recurring characters, props, or locations must hold identity across the clip.
5. Use canvas.previewPrompt when the node carries a dense preset stack or many refs, then trigger canvas.generate only after the compiled motion brief is coherent.

Decision tree:
- If the shot is mostly one gesture or one reaction, keep the duration short and the prompt tight.
- If the shot has dialogue, verify whether the provider supports audio and whether lipSyncEnabled must be set through canvas.setVideoParams.
- If the clip depends on matching an existing still or previous shot, treat first and last frames as mandatory constraints rather than optional flavor.
- If the requested motion contains a cut, a major angle change, or multiple beats, split it into multiple nodes instead of inflating one prompt.

Motion quality checks:
- The clip has a readable start state, motion phrase, and settling tendency.
- Camera motion is justified by story function and does not compete with subject motion.
- Environmental movement supports the main beat instead of cluttering it.
- The shot can hand off cleanly to neighboring nodes in the canvas.

Common failure modes:
- Static image prose overwhelms the motion instructions.
- The prompt asks for multiple distinct beats that should be separate clips.
- A first frame is connected in the wrong edge direction, so the constraint never really applies.
- Duration is too long for the described action, which encourages mushy filler motion.
- Audio, lip sync, and quality tier are implied in prose but never set with canvas.setVideoParams.

Model adaptation:
- Text-to-video usually benefits from a fuller motion paragraph because appearance, staging, and action all come from text.
- Image-to-video should stay concise and describe only the change over time.
- When provider duration or audio support is unknown, check provider.getCapabilities before generation and fall back to the smallest viable scope.`,
  },
  {
    processKey: 'audio-generation',
    name: '音频生成',
    description: '用于语音、音乐与音效生成的指导。',
    defaultValue: `Audio generation guide:

General rules:
- Identify the audio type first: voice, music, or sound effect.
- Keep prompts production-oriented and time-aware. Audio prompts should tell the model what role the sound plays in the edit, not just what genre it resembles.
- Describe perspective, intensity, rhythm, and decay when they matter.

Voice and dialogue:
- Prioritize delivery over generic emotion labels: tempo, pause pattern, breath control, vocal pressure, clarity, whisper vs projection, fragility vs command.
- When emotion vectors are available, align the prompt with them instead of fighting them. Use the vector for emotional weighting and the text prompt for delivery behavior.
- Keep voice identity grounded in approved character data. Do not invent accent, age shift, or vocal style unless the user approved it or the character record already supports it.
- Mention sync constraints when the line must match an on-screen action, pause, or cut.
- Good voice prompt ingredients: speaking intent, emotional temperature, pacing, articulation, loudness, and whether breaths or hesitations should remain audible.

Music:
- State the cue's job first: underscore tension, carry montage momentum, support wonder, mask a transition, build to reveal, or provide diegetic ambience.
- Specify tempo feel, groove density, instrumentation family, register, and arc across the cue.
- Describe entrances and exits: start sparse, swell under reveal, cut hard on impact, taper into room tone.
- Avoid vague genre stacking. "Low cello pulse, brushed percussion, restrained analog synth pad" is better than "epic cinematic emotional soundtrack."

Sound effects:
- Name the source, surface, environment, and perspective.
- Describe texture and envelope: sharp attack, hollow resonance, soft cloth rustle, metallic ring, short slapback, long concrete decay.
- Clarify whether the sound is isolated Foley, layered design, or environmental bed.
- For repeated actions, describe cadence and variation so the result does not feel like a robotic loop.

Sync patterns:
- Call out important timing relationships: lands on cut, trails half a second after movement, swells before reveal, ducks under dialogue, repeats every footstep.
- If audio must support a lip-synced or dialogue-driven video, keep timing language precise and avoid unrelated musical clutter.

Prompt sizing:
- Dialogue and SFX prompts are usually concise, but they still need specific direction.
- Music prompts can be longer when they need arrangement arc, instrumentation, and transition behavior.
- Keep every sentence useful. Remove empty adjectives that do not change sound design decisions.

Tool workflow:
1. Create or locate the audio node with canvas.addNode or canvas.getNode.
2. Write the spoken line, cue brief, or sound description into the node prompt with canvas.updateNodes.
3. Set audio-specific metadata with canvas.setAudioParams. Use audioType="voice" for dialogue or narration, "music" for scored cues, and "sfx" for effects design.
4. If the clip is tied to a speaking shot or editorial beat, connect the audio node to the related video node with canvas.connectNodes so the relationship stays explicit.
5. Generate the audio node with canvas.generate only after prompt, emotionVector, and any sync expectations agree.

Voice workflow:
- Keep the written line in the prompt only when the provider expects the spoken text there. If the node is narration-driven, separate text content from delivery notes cleanly.
- Use canvas.setAudioParams with an emotionVector that reflects one dominant emotion plus neutral support. Example patterns:
  restrained grief: sad 0.65, neutral 0.25, fearful 0.10
  brittle anger: angry 0.60, contemptuous 0.25, neutral 0.15
  relieved confession: happy 0.40, sad 0.30, neutral 0.30
- Mention breath and pause logic when sync matters: clipped inhale before the line, swallow between clauses, whispered landing, delayed final word.
- If the line will drive lip sync, keep it short enough that the mouth action can remain legible in the target shot duration.

Music workflow:
- Begin with cue function, then move to tempo feel, harmonic pressure, instrumentation, and arc.
- Useful shape language: begins sparse, rises under reveal, withholds percussion until midpoint, cuts to room tone on impact.
- Name timbral families instead of vague genre tags: bowed low strings, brushed kit, detuned synth bed, muted trumpet fragments, granular vocal pad.
- If the user needs a loop, say so explicitly and describe whether loop seams should be hidden or musically obvious.

SFX workflow:
- Specify source, surface, environment, perspective, attack, sustain, and decay.
- Clarify layering needs: isolated Foley footstep, layered mechanical servo with hydraulic hiss, distant thunder bed under rain on corrugated metal.
- For repeated effects, describe cadence and variation so the result does not sound copy-pasted.
- For UI or magical sounds, ground the abstraction in envelope and texture: glassy transient, rising harmonic shimmer, dry percussive click.

Decision tree:
- If the user primarily wants emotional speech, lead with voice and emotionVector design.
- If the request is about ambience or action punctuation, use sfx and keep the prompt concrete.
- If the request spans score plus design plus dialogue, split them into separate nodes; one audio node should not try to be the whole mix.
- If emotional intent is unclear, ask through commander.askUser before inventing accent, age, or performance style.

Quality checks:
- The prompt tells the model what role the sound plays in the cut.
- Timing language, if present, maps to real editorial behavior.
- Emotion vector and prose do not fight each other.
- The node title identifies the cue without pasting an unreadable wall of text.

Common failure modes:
- Treating emotionVector as a substitute for direction and pacing.
- Asking one audio node to produce narration, score, and Foley together.
- Using genre labels with no instrumentation, perspective, or envelope detail.
- Forgetting to set audioType, leaving downstream behavior ambiguous.
- Writing a music prompt so long and vague that the cue has no defined function.`,
  },
  {
    processKey: 'preset-and-style',
    name: '预设与风格',
    description: '用于预设选择、风格控制与镜头模板操作的指导。',
    defaultValue: `Preset and style guide:

Role split:
- Preset tracks hold reusable cinematic grammar.
- Shot templates provide fast multi-track starting points.
- Node prompt text holds scene-specific content that should not be repeated across shots.

Recommended stacking order:
1. Apply the closest built-in or approved shot template first with canvas.applyShotTemplate.
2. Read current tracks with canvas.readNodePresetTracks before making further edits.
3. Use canvas.writeNodePresetTracks for a deliberate single-category rewrite.
4. Use canvas.writePresetTracksBatch when multiple categories must change together as one plan.
5. Use canvas.addPresetEntry, canvas.updatePresetEntry, and canvas.removePresetEntry for surgical edits after the base look is established.

Category intent:
- camera: movement path or stillness grammar
- lens: focal behavior, distortion, compression, depth
- look: art direction, color grade, texture treatment
- scene: lighting, weather, atmosphere, environmental conditions
- composition: framing geometry and subject placement
- emotion: expressive tone or tension bias
- flow: cadence, transition energy, temporal feel
- technical: aspect ratio, quality tier, render discipline

Conflict detection:
- Do not leave contradictory entries unresolved inside the same conceptual slot.
- One shot should not simultaneously argue for incompatible aspect ratios, mutually exclusive quality tiers, or opposing dominant lens logic unless the contradiction is explicitly intentional.
- Avoid stacking presets that cancel each other out, such as hyper-stable grandeur plus frantic handheld panic, unless the user asked for that friction.
- When multiple presets compete, choose a dominant direction and trim the rest instead of averaging everything into mush.

Intensity guidance:
- One dominant influence per category should lead the stack whenever possible.
- Strong defining entries often live around 70 to 100 intensity.
- Supporting modifiers usually work better around 25 to 60.
- Very low values should be subtle accents, not clutter.
- If every track entry is maxed, the result usually becomes noisy and generic.

Creative control:
- If the style choice changes genre, tone, or overall art direction, ask the user via commander.askUser before inventing it.
- If the style work is purely technical or merely implementing an already approved direction, proceed without asking.

Prompt interaction:
- Do not duplicate preset content in node prompts.
- Use presets for repeatable grammar and prompts for shot-specific subject matter, environment state, and action.
- If no fitting preset exists, either create a reusable preset path or write only the missing scene-specific exception into the prompt.

Template quality bar:
- Favor sparse, intentional track stacks over bloated stacks.
- Reuse good templates instead of rebuilding the same camera/look/emotion recipe node by node.
- Keep a node's preset setup readable enough that another agent or user can understand the dominant logic quickly.

Concrete workflow:
1. Inspect the node and read existing tracks with canvas.readNodePresetTracks.
2. If a close built-in template already matches the shot family, apply it first with canvas.applyShotTemplate instead of hand-authoring every category.
3. Use canvas.writePresetTracksBatch when you need a coherent replacement across several categories, such as moving a shot from clean daylight realism to smoky neon handheld suspense.
4. Use canvas.writeNodePresetTracks when only one category needs a clean rewrite, such as replacing the lens track while preserving look and scene.
5. Use canvas.addPresetEntry, canvas.updatePresetEntry, and canvas.removePresetEntry to tune the stack after the dominant direction is established.

Stacking examples:
- Stable dramatic close-up: camera track favors gentle push-in or locked-off stillness, lens track favors medium telephoto compression, look track favors restrained contrast, emotion track supports contained pressure.
- Chaotic pursuit: camera track allows rough handheld energy, lens track leans wider, scene track adds rain or particulate motion, flow track increases urgency, technical track keeps duration and aspect ratio aligned with the sequence.
- Product or reference plate: composition and technical tracks dominate, while emotion and flow stay minimal so the asset remains neutral and reusable.

Conflict resolution:
- If a node has both "locked tableau" and "frantic handheld" style logic, choose one dominant rule and remove or soften the other.
- If multiple look entries fight over palette, keep the approved palette leader and downgrade accents to supporting intensities.
- If a template injects categories the shot does not need, trim them rather than leaving low-confidence noise.

Prompt coordination:
- After preset changes, inspect whether the node prompt now duplicates track content. Trim repeated lens, lighting, or grading language from the prompt with canvas.updateNodes.
- Use canvas.previewPrompt when the compiled result matters more than the raw track list. The preview is the real quality bar.
- If multiple nodes must share the same stack, write the tracks in batch rather than hand-tuning them one by one.

Decision tree:
- If the user asks for a repeatable style system, lean on presets and templates.
- If the request is a one-shot exception, keep the preset stack stable and solve the difference in prompt text.
- If the style change alters genre or approved art direction, confirm with commander.askUser before committing it broadly.

Failure modes:
- Maxing every intensity until the compiled prompt turns generic.
- Using prompt text to fight preset tracks instead of cleaning the tracks themselves.
- Adding small contradictory entries instead of removing the wrong dominant one.
- Forgetting that technical tracks should reflect actual aspect ratio and quality needs, not vibe words.`,
  },
  {
    processKey: 'entity-management',
    name: '实体管理',
    description: '用于角色、地点与设备增删改查的指导。',
    defaultValue: `Entity management guide:

Core principle:
- Characters, locations, and equipment are durable production assets. Store them as reusable structured data, not as loose prompt fragments.
- The quality of downstream prompt compilation depends on the quality of these records.

Approval workflow:
- Do not invent major creative facts without approval.
- If a new entity requires choosing a name, look, role, mood, or story-significant detail that the user did not specify, present the proposal through commander.askUser before creating it.
- For updates, distinguish between factual cleanup and creative redesign. Cleanup can proceed. Redesign needs approval.

Character fields:
- Fill role, description, appearance, personality, and costumes coherently.
- Use structured face fields for eye shape, eye color, nose type, lip shape, jawline, and defining features.
- Use hair fields for color, style, length, and texture.
- Use body fields for height, build, and proportions.
- Use skinTone, distinctTraits, voice, and vocalTraits when they materially help continuity.
- Keep appearance and description fields concise but concrete. They should summarize, not duplicate every structured field verbatim.
- Make costumes production-usable: each costume should represent a recognizable look variant, not a vague fashion mood.

Location fields:
- Name the place clearly, then describe what production needs to know: timeOfDay, mood, weather, lighting, architectureStyle, dominantColors, keyFeatures, atmosphereKeywords.
- Key features should help staging and recognition: broken skylight, central altar, neon pharmacy sign, flooded underpass.
- Atmosphere keywords should reinforce usable environmental behavior, not replace actual description.

Equipment fields:
- Record type, subtype, description, function, material, color, condition, and visualDetails.
- Treat equipment as a real object with a readable silhouette, wear pattern, and usage logic.
- Keep function and visualDetails grounded in what the object must communicate on screen.

Update discipline:
- Read the existing entity before changing it.
- Preserve coherence across related fields. If hair changes from close-cropped black to waist-length silver, update any appearance summary or costume notes that now conflict.
- Do not bury structured facts inside freeform text when a dedicated field exists.

Ref-readiness check:
- Before calling any *.generateRefImage tool, confirm the entity record is specific enough to support consistent visuals.
- If the record is too sparse, improve the structured fields first.
- Refs should emerge from entity data, not compensate for missing entity data.

Node usage:
- Never guess entity IDs when attaching refs to nodes.
- List existing entities first, then attach only the assets that are actually visible in the target frame.
- Do not use text nodes as a substitute database for character, location, or equipment records.

Creation workflow:
1. List existing entities first so you do not create duplicates with slightly different names.
2. If the user is naming or defining a new recurring asset, create it with the correct domain tool: character.create, location.create, or equipment.create.
3. Fill structured fields before polishing summaries. The freeform description should summarize the structured truth, not replace it.
4. After creation, re-read the entity or report the created identifier so later ref attachments stay deterministic.

Character best practices:
- Structured face fields should describe stable anatomy and recognition cues, not transient expressions.
- Costumes should be separated into distinct looks when continuity depends on wardrobe changes.
- Voice and vocalTraits belong only when they help audio generation or characterization downstream.
- Distinguish core appearance from scene-specific styling. Wet hair from a storm scene is not automatically the default hairstyle.

Location best practices:
- Think in layout, lighting behavior, atmosphere, and repeatable recognition cues.
- Store what later shots must preserve: neon pharmacy sign, collapsed stairwell, rainwater reflecting cyan signage, persistent fog near the floor.
- Do not turn one camera angle into the whole location. The record should describe the durable place, not just one shot.

Equipment best practices:
- Type and subtype should let another agent understand the class of object immediately.
- Function should describe what the object does in story or practical terms.
- VisualDetails should capture silhouette, wear, controls, markings, and materials that help recognition.
- If the object changes state across scenes, keep the base record stable and store damage or temporary setup in node prompts unless the asset itself has permanently changed.

Update discipline:
- Prefer update over recreation when the asset is clearly the same recurring entity.
- When new evidence contradicts an approved record in a major way, route the change through commander.askUser before overwriting.
- Keep summaries synchronized after structured field changes so descriptions do not drift out of date.

Ref-readiness workflow:
- Before generating reference images or attaching refs to nodes, confirm the entity record is specific enough to support continuity.
- Sparse records should be strengthened before image generation. Do not expect refs to solve weak upstream data.
- After entities are solid, attach them to nodes with canvas.setNodeRefs based on what is actually visible.

Common failure modes:
- Duplicating the same character under slight spelling variations.
- Storing transient scene details as permanent entity facts.
- Leaving structured face fields empty while stuffing everything into one description paragraph.
- Updating one field and forgetting the linked summary or costume note, creating internal contradictions.`,
  },
  {
    processKey: 'canvas-workflow',
    name: '画布工作流',
    description: '用于节点创建、布局、连线与画布组织的指导。',
    defaultValue: `Canvas workflow guide:

Planning rules:
- Read current node and edge state before mutating the canvas.
- Prefer reusing and updating existing nodes when the structure already exists.
- When the plan is known up front, prefer canvas.batchCreate over repeated canvas.addNode calls.

Node creation:
- Create nodes with as much correct information as possible on the first write: title, prompt/content, relevant refs or follow-up plan, and obvious structural relationships.
- Avoid creating placeholder clutter that immediately requires a second cleanup pass.
- Use text nodes for script, notes, and planning anchors. Use media nodes for actual generation targets.

Edge logic:
- Treat edge direction as meaning, not decoration.
- Build flows deliberately: source to target, setup to payoff, first frame to video, video to last frame, audio to video when sync matters.
- Verify edge direction before claiming continuity-sensitive features are wired.

Video chain workflow:
- When a video shot needs explicit frame control, think in image -> video -> image chains.
- First frame image sits upstream of the video node.
- Last frame image sits downstream of the video node.
- Dialogue or voice audio should connect where lip sync or editorial relationship is intended.

Batching:
- Use batch creation for shot trees, scripted imports, or multi-node setups that already have known relationships.
- Use differentiated per-node updates when several nodes need different prompts, refs, or templates in one operation.
- Use layout operations when manual placement adds no storytelling value.

Legibility:
- Keep related structures grouped and maintain a clear left-to-right temporal flow whenever possible.
- Reserve manual layout for cases where spatial grouping conveys meaning. Otherwise use canvas.layout.
- Avoid duplicate nodes, overlapping chains, or disconnected leftovers that make the canvas harder to read.

Mutation discipline:
- Read before mutate.
- After creation, immediately wire the essential edges and presets instead of leaving half-finished islands.
- Before destructive cleanup or large rewrites, consider snapshot.create so recovery stays possible.

Workflow handoff:
- A good canvas should let another agent understand the pipeline at a glance: where shots begin, where continuity flows, where audio lands, and which nodes are generation-ready.

Concrete build patterns:
- For a scene breakdown, use canvas.batchCreate to make one scene text node plus child shot nodes in a single operation, then connect them left to right.
- For continuity-heavy motion, build image -> video -> image chains first, then attach refs, then set video frames with canvas.setVideoFrames.
- For dialogue shots, connect audio nodes into the speaking video node so editorial intent remains obvious.
- For bulk prompt polish, use canvas.updateNodes with a nodes array instead of many single mutations.

Layout strategy:
- Keep the primary time axis moving left to right.
- Use vertical grouping for related support nodes: refs above or below the shot they inform, audio near the speaking shot, notes off to one side.
- After large graph creation, use canvas.layout unless deliberate manual placement carries production meaning.
- Reserve color tags and notes for signaling review state, approval state, or pipeline role, not for decoration.

Read-before-write sequence:
1. canvas.listNodes and canvas.listEdges for broad inspection.
2. canvas.getNode on the exact nodes you plan to mutate.
3. snapshot.create when the operation is destructive, wide in scope, or hard to undo mentally.
4. Mutation tools such as canvas.batchCreate, canvas.connectNodes, canvas.updateNodes, canvas.setNodeRefs, canvas.setVideoFrames, or preset tools.
5. Validation readback with canvas.getState or targeted canvas.getNode calls.

Decision tree:
- If the operation touches many new nodes with known structure, prefer batchCreate.
- If the structure already exists and only content changes, prefer update and ref tools.
- If edge meaning is uncertain, stop and inspect rather than drawing decorative connections.
- If the canvas is becoming unreadable, solve the graph structure first and visual layout second; layout cannot rescue bad relationships.

Validation checks:
- Every generation-ready media node has the refs, frames, or audio links it actually needs.
- Edge direction matches story logic and feature requirements.
- There are no duplicate orphan nodes from abandoned earlier passes.
- The canvas could survive a handoff to another agent without hidden assumptions.

Common failure modes:
- Creating nodes one by one for a structure that was known in advance, leaving inconsistent titles and missed edges.
- Treating edges as cosmetic and breaking frame-control workflows.
- Leaving half-configured islands that appear complete but cannot actually generate.
- Rearranging layout before the graph meaning is settled, which wastes time and hides logical errors.`,
  },
  {
    processKey: 'provider-and-config',
    name: '供应商与配置',
    description: '用于供应商选择、质量设置和媒体配置的指导。',
    defaultValue: `Provider and config guide:

Selection workflow:
1. Identify the medium first: image, video, audio, vision, or provider-specific utility.
2. Check provider readiness with provider.list before assigning or relying on a provider. Read hasKey, active model, and any missing configuration.
3. Query provider.getCapabilities for the target provider when the task depends on duration, resolution, audio support, frame refs, quality tiers, or reference-image count.
4. Only then set provider or generation params on the node.

Provider choice rules:
- Match the provider to the requested medium and constraint set, not to habit.
- Do not force a manual provider override unless the user asked for a specific provider or a capability mismatch requires it.
- If no ready provider exists for the required medium, surface that clearly instead of pretending generation can proceed.

Media configuration:
- Set only the parameters that matter to the shot: resolution, duration, quality, audio toggle, variant count, seed, img2img strength, or frame refs.
- Resolution should follow delivery intent and provider limits, not arbitrary escalation.
- Duration should match the amount of action. Longer clips cost more and often weaken motion clarity.
- Quality tiers are intentional tradeoffs, not automatic "higher is always better" switches.

Cost and quality:
- Use canvas.estimateCost when the user is choosing between setups, providers, or variant counts.
- Treat cost estimates as planning input. They should inform the user, not silently override approved creative intent.
- When a higher quality tier has a known cost multiplier, call that out through tool-visible choices or concise reporting.

Reference-image limits:
- Before attaching reference images to generation, check provider capability limits.
- If the limit is unknown, default conservatively to one reference image.
- Select refs by usefulness, not by maximum count.

Audio and video specifics:
- Verify that the chosen video provider supports audio before enabling audio on a video node.
- Verify duration range, quality tiers, and frame-reference support before configuring video generation.
- For audio nodes, ensure the provider matches the requested output type and emotional or timing constraints.

Failure discipline:
- Unknown capability means query first or choose the safe minimum.
- Never fabricate capability support.
- If configuration is incomplete, fix it before generation rather than relying on silent fallback behavior.

Concrete provider workflow:
1. Use provider.list to identify ready providers and confirm hasKey before any override.
2. Query provider.getCapabilities when the request depends on duration, audio, quality, resolution, frame refs, or ref-image count.
3. Set provider only if the current default cannot satisfy the requested job or the user explicitly named a provider.
4. Apply node-level settings with canvas.setNodeProvider, canvas.setImageParams, canvas.setVideoParams, or canvas.setAudioParams.
5. Use canvas.estimateCost when the user is comparing options, then report tradeoffs instead of silently choosing the cheapest one.

Media-specific guidance:
- Image nodes: prioritize aspect ratio, resolution, img2img strength when relevant, and variant count only when exploration is intentional.
- Video nodes: confirm duration ceiling, audio support, quality tiers, and frame-reference support before calling canvas.setVideoParams or canvas.setVideoFrames.
- Audio nodes: match provider and prompt style to the requested role, whether voice, music, or sfx.
- Vision tasks: pick from provider.list(group="vision") when the user cares about a specific analysis backend.

Decision tree:
- If the user asks for "best quality" without delivery context, explain the cost and latency tradeoff instead of blindly escalating.
- If the chosen provider lacks a key capability, either switch providers with a visible explanation or ask the user how to proceed.
- If capability data is missing, assume the safest minimum configuration and say so.
- If a provider override would fragment consistency across a sequence, prefer keeping one provider unless there is a strong reason to mix.

Quality heuristics:
- Resolution should support the actual use case: reference plate, storyboard still, review clip, or final delivery.
- Duration should reflect one motion beat, not a vague desire for "more."
- Quality tiers should be reserved for shots where the added cost materially improves the output.
- Seed and variant count are control tools, not defaults to max out.

Provider-specific risk handling:
- Audio on video nodes must be verified, not assumed.
- Ref-image count should be constrained by known capability, not by how many refs happen to exist.
- When a provider has known notes or caveats in provider.getCapabilities, treat those notes as operational constraints.

Common failure modes:
- Setting providerId without confirming an API key exists.
- Hiding technical requirements inside prose instead of node params.
- Asking for unsupported duration, quality, or frame-ref combinations and then misdiagnosing the failure as a prompt problem.
- Switching providers mid-sequence without recognizing the continuity cost.`,
  },
  {
    processKey: 'script-development',
    name: '脚本开发',
    description: '用于脚本导入、编写以及从剧本到画布工作流的指导。',
    defaultValue: `Script development guide:

Mission:
- Treat scripts as production planning assets, not raw prose dumps.
- Keep screenplay output valid Fountain format so it can move cleanly between read, write, import, and breakdown workflows.
- Separate source management from generation intent: importing preserves an external script source, while writing saves generated or revised content back into the project workspace.

Workflow:
1. Use script.read when you need to inspect the current in-project screenplay, verify scene headings, or continue editing an existing draft.
2. Use script.import when the source comes from disk or from raw pasted screenplay text that needs to enter the app as a script asset.
3. Use script.write when you already have the final generated content and want to persist it as the project's screenplay.
4. After the script structure is stable, extract entities, run script-breakdown or equivalent planning, then map the resulting beats into canvas.batchCreate.

Fountain format rules:
- Use standard scene headings, action lines, character blocks, dialogue, parentheticals, and transitions only when they add production value.
- Scene headings should stay in the familiar INT./EXT. LOCATION - TIME pattern so breakdown and import remain deterministic.
- Character cues should remain uppercase and separated cleanly from dialogue; if a mixed-case or nonstandard name must still be treated as a character cue, force it with a leading @ instead of hoping the parser guesses right.
- Keep action visual and present tense. Do not leave literary narration that cannot be filmed.
- If a scene heading needs to parse even without the usual INT./EXT. prefix, force it with a leading period.
- If an all-caps action line would be mistaken for a character cue, rewrite it or force it as action instead of letting the parser silently reinterpret the beat.
- Preserve consistent naming for recurring characters, locations, and props so later extraction stays deterministic.
- Let blank lines and line breaks remain readable; Fountain preserves writer-intended spacing, so do not collapse the screenplay into one wall of text.
- Sections, synopses, and notes are optional planning aids. Keep them only when they improve navigation and do not replace actual screenplay structure.

Import versus write:
- script.import is for existing script sources: a disk path, a pasted screenplay, or a source file that should be ingested with minimal interpretation.
- script.write is for newly generated or substantially revised screenplay content that is ready to become the current project script.
- Do not call script.write with half-baked notes. Save only usable screenplay text.

Script-to-canvas pipeline:
- Read script -> identify scenes -> extract entities -> build breakdown -> create text and media planning nodes with canvas.batchCreate.
- Keep scene headings, dramatic beats, and shot hierarchy aligned so the canvas can reflect the script's order without manual cleanup.
- Use text nodes for scene summaries or shot plans first, then expand into image, video, and audio nodes deliberately.

Quality bar:
- The script should be directly legible to a production-minded user.
- Any scene you save should already be ready for downstream entity extraction and shot planning.
- If the user request implies a major creative rewrite rather than a technical formatting pass, route that decision through approval first.

Concrete screenplay workflow:
1. Read the current script with script.read before rewriting or importing anything.
2. If the user brings in an external draft, use script.import and preserve the source structure as faithfully as possible.
3. If you are generating or revising the project's active script, produce complete Fountain text and save it with script.write only after it is structurally sound.
4. Once scene order is stable, turn scenes or shot plans into canvas nodes with canvas.batchCreate rather than hand-copying them one at a time.

Fountain patterns worth preserving:
- Scene heading: INT. WAREHOUSE OFFICE - NIGHT
- Forced scene heading when needed: .SERVER ROOM - PREDAWN
- Character cue override when mixed case must still parse as dialogue: @Dr. Vale
- Action should stay visual and producible, not novelistic commentary.

Planning guidance:
- A screenplay beat should already hint at what a shot list or scene board will need: geography, character presence, action, and turning points.
- Keep dialogue blocks speakable. If a line is too long for one shot, flag it early.
- Maintain consistent naming for recurring assets so entity extraction and ref attachment later remain deterministic.
- Use sections or synopses only when they help navigation; they are not substitutes for actual scene writing.

Decision tree:
- If the task is formatting cleanup, preserve story content and only repair Fountain structure.
- If the task is a creative rewrite, ask for approval before materially changing scene intent, character motivation, or sequence scope.
- If the script is too early for full screenplay form, keep it as structured scene notes until the user wants a true draft.

Failure modes:
- Saving outline fragments with script.write as if they were a production-ready screenplay.
- Using inconsistent character names that later split one person into multiple entities.
- Collapsing whitespace and damaging readability or parser behavior.
- Generating scene prose that cannot be filmed, which weakens every downstream canvas workflow.`,
  },
  {
    processKey: 'vision-analysis',
    name: '视觉分析',
    description: '用于逆向提示词、风格提取以及将视觉分析结果写回项目的指导。',
    defaultValue: `Vision analysis guide:

Three distinct intents:
1. reverse-engineer the image into a generation-ready prompt
2. extract style analysis for reusable cinematic language
3. write structured findings back into entity fields or a node prompt

Intent selection:
- If the user asks "what prompt made this" or wants a recreatable image brief, reverse-engineer the visible frame into a prompt-focused answer.
- If the user asks to match a look, palette, or aesthetic system, return style analysis that separates art direction, lighting, color, texture, framing, and mood.
- If the goal is production bookkeeping, extract what the image proves about characters, equipment, locations, wardrobe, or scene state, then map those findings into the right records.

Reverse-prompt rules:
- Describe only what is visually evidenced in frame.
- Prioritize subject, composition, environment, lighting behavior, material response, and camera feel over generic praise words.
- Describe composition in an ordered way when useful, such as background to foreground or left to right, so object relationships stay reconstructible.
- Keep the result editable. A good reverse-engineered prompt should help the user recreate the image, not just admire it.
- Do not overclaim exact counts, tiny text, or precise spatial relationships when the image evidence is weak.

Style analysis rules:
- Break style into reusable components: medium or art direction, lens/composition behavior, lighting pattern, palette, texture, atmosphere, and emotional tone.
- Name relationships, not just labels: hard sidelight through smoke, muted teal shadows against sodium amber highlights, coarse film grain over damp concrete.
- Preserve object-to-trait bindings and notable spatial relationships so downstream prompts do not detach details from the right subject.
- Keep style analysis abstract enough to reuse across shots, but concrete enough to inform preset tracks and prompt revisions.
- Panoramic distortion, rotated text, tiny labels, and unusual crops can reduce certainty. Surface uncertainty instead of inventing detail.

Write-back rules:
- When writing to a node prompt, convert analysis into scene-specific language that still fits the node's intended shot.
- When updating entity fields, extract persistent facts only. Do not move transient lighting or camera choices into character or equipment records unless they define the asset itself.
- Use image analysis to populate character, equipment, or location data only when the visual evidence is strong and the update improves continuity.
- If the recreation depends on exact output controls such as aspect ratio, transparent background, or exact color values, keep those as explicit node params or prompt constraints instead of burying them in vague style prose.

Extraction workflow:
- Identify the dominant subject first.
- Separate persistent design facts from temporary scene facts.
- If multiple entities are visible, note their relationships clearly instead of merging them into one muddy summary.
- If the image conflicts with stored records, surface the discrepancy instead of silently overwriting data.

Quality bar:
- Every result should support an action: recreate the image, align a style system, or improve the project's structured data.
- Avoid speculative storytelling that cannot be justified from the image alone.
- Keep output usable for direct node prompt editing, preset decisions, or asset record updates.

Tool sequence:
1. Confirm the target node actually has an image asset through canvas.getNode or the surrounding workflow.
2. Call vision.describeImage with the correct style mode: prompt, description, or style-analysis.
3. If the result should update the node prompt directly, use canvas.updateNodes rather than rewriting unrelated fields.
4. If the result reveals durable entity facts, update or create character, location, or equipment records conservatively, then attach them with canvas.setNodeRefs.

Certainty handling:
- Strongly visible facts can be written back as structured data.
- Ambiguous details should be reported as possibilities, not committed as truth.
- Tiny text, deep background clutter, and stylized distortions often deserve explicit uncertainty language.
- When the image contradicts existing records in a material way, use commander.askUser before overwriting approved data.

Actionable outputs:
- Reverse-prompt mode should end as a reusable generation brief.
- Style-analysis mode should end as preset-ready language for look, scene, emotion, or composition tracks.
- Description mode should end as production bookkeeping: what is present, what is persistent, what is temporary.

Common failure modes:
- Returning admiration language instead of usable production language.
- Treating one stylized frame as authoritative evidence for all durable entity fields.
- Writing transient lighting or mood into persistent asset records.
- Forgetting that node params like aspect ratio or transparent background belong in explicit settings, not vague analysis prose.`,
  },
  {
    processKey: 'snapshot-and-rollback',
    name: '快照与回滚',
    description: '用于安全创建、查看与恢复快照的指导。',
    defaultValue: `Snapshot and rollback guide:

Purpose:
- Preserve recovery points before destructive or large-scale changes.
- Make rollback explicit, traceable, and safe.
- Treat restore operations as high-risk because they replace project state.

When to create a snapshot:
- Before batch deletions, mass rewrites, or structural canvas cleanup.
- Before re-importing scripts, replacing many refs, or reorganizing a project with uncertain reversibility.
- Before recovery experiments where you may need to compare results against the prior state.

Label rules:
- Every snapshot label should explain why the checkpoint exists.
- Use short labels with scope and intent, such as "before scene-12 relayout", "pre style-transfer cleanup", or "before character ref refresh".
- Avoid vague labels like "backup" or "test". The label should help future restore decisions.

Restore safety:
- snapshot.restore must always follow commander.askUser confirmation.
- Name the target snapshot, summarize what will be replaced, and make the rollback consequence visible before restore.
- Never present restore as a harmless preview. It is a state replacement operation.

Recovery workflow:
1. Use snapshot.list to inspect available recovery points and choose the correct snapshot.
2. Confirm scope with the user through commander.askUser if there is any chance of overwriting meaningful recent work.
3. Run snapshot.restore only after the intended target is unambiguous.
4. After restore, re-read the relevant state instead of assuming the project now matches memory.

Decision rules:
- If the operation is reversible through ordinary undo and the scope is tiny, a snapshot may be optional and plain cancel or undo is usually better than extra confirmation friction.
- If the operation spans multiple entities, nodes, prompts, or workflow assets, prefer the snapshot.
- If you are unsure whether the user would want a rollback point later, create it first. A small snapshot cost is better than unrecoverable loss.
- Reserve restore confirmations for genuinely high-cost state replacement. Make the risky consequence explicit instead of asking with vague wording.

Reporting:
- Tell the user when a new snapshot was created and why.
- When listing snapshots, surface the labels that make recovery decisions easier.
- After rollback, clearly report that project state now reflects the restored snapshot rather than the most recent edits.

Concrete snapshot workflow:
1. Before risky work, create a label that captures scope and purpose, then run snapshot.create.
2. For review or recovery, call snapshot.list and sort mentally by recency plus label meaning, not recency alone.
3. If the user wants to roll back, restate the exact snapshot label and what later work will be lost, then confirm through commander.askUser.
4. Run snapshot.restore only after the target is unambiguous.
5. Immediately re-read relevant canvas or project state so follow-up actions are based on fact, not memory.

When snapshots are mandatory:
- Before batch prompt rewrites across many nodes.
- Before deleting or restructuring large graph sections.
- Before re-importing script content that may replace current work.
- Before any restore experiment where the user may want to compare states.

Naming conventions:
- Good labels are short, scoped, and anchored to the risky action: before warehouse scene relayout, pre batch re-prompt noir pass, before script import v2.
- Include the reason, not just the time.
- Avoid generic labels that become meaningless after a few hours.

Restore safeguards:
- Treat restore as destructive replacement, not as a temporary preview.
- Never chain multiple restore attempts casually. Reassess state after each restore.
- If the user sounds uncertain, list snapshots first and explain consequences before asking for confirmation.
- After restore, assume any cached understanding is stale until you inspect the current state again.

Decision tree:
- If undo can safely recover a tiny local change, a snapshot may be unnecessary.
- If the work spans many nodes or records, snapshot first even if undo exists.
- If there is any doubt about reversibility, lean toward snapshot creation; the cost is low and the recovery value is high.

Common failure modes:
- Creating a snapshot with an unhelpful label.
- Restoring without explicit confirmation.
- Assuming restore succeeded without reading current state.
- Using restore as a substitute for understanding what went wrong.`,
  },
  {
    processKey: 'render-and-export',
    name: '渲染与导出',
    description: '用于启动/取消渲染以及导出打包结果的指导。',
    defaultValue: `Render and export guide:

Pre-render dependency check:
- Confirm the target canvas is actually ready before render.start.
- Check that all required media nodes have generated assets, references are resolved, and there are no broken edges that would make the sequence incoherent.
- Verify output-critical settings first: aspect ratio, duration expectations, audio routing, and provider readiness where applicable.

Render start workflow:
1. Read the canvas state and confirm the intended output scope.
2. Make sure the node chain is complete enough for export.
3. Start the render with the requested format only after the structure is coherent.
4. Monitor the render job and surface failures instead of pretending progress.

Output format guidance:
- Match the container or export target to the user's delivery need.
- If the user did not ask for a format conversion, prefer matching the source or sequence settings before inventing custom export values.
- Use lighter formats for previews and review loops. H.264 is a reasonable default for quick review exports when the user does not request something else.
- Use higher-fidelity formats only when the project is ready for final export or handoff.
- If the user did not specify a format, choose a reasonable default and state it concisely.
- Preview the intended output duration, framing, and fit before export when the requested size or aspect ratio differs from the source.

Monitoring and recovery:
- Treat render jobs as asynchronous work that may fail, stall, or be cancelled.
- Use render.cancel only when the user requests cancellation or when recovery requires stopping a clearly broken render.
- If a render fails, identify whether the cause is missing assets, invalid graph structure, configuration mismatch, or provider-side failure before retrying.
- Do not loop blindly on failed renders.
- If previews, preview files, or cached intermediates are reused for speed, make sure they still match the intended output quality before trusting them for final delivery.

Export bundle rules:
- render.exportBundle is for packaging the project deliverables, not for testing whether generation succeeded.
- Verify which assets, metadata, prompts, and project state the bundle should contain before exporting.
- The bundle should be useful to reopen, review, or hand off. Keep naming and scope consistent with the canvas being exported.

Quality bar:
- Rendering starts only when the graph is ready enough to succeed.
- Cancellation is deliberate, not a substitute for diagnosis.
- Bundle exports should follow a coherent, completed slice of work rather than a half-broken graph.

Preflight workflow:
1. Inspect the canvas state and make sure the intended sequence is actually the one being rendered.
2. Verify key nodes have finished assets and that required image, video, and audio relationships are present.
3. Confirm any aspect ratio, timing, and audio expectations that would affect the deliverable.
4. Only then call render.start with the requested format and optional outputPath.

Format guidance:
- For quick review movies, H.264 in an mp4 container is a practical default when the user did not specify something else.
- For final or editorial handoff renders, choose the format the downstream toolchain actually needs.
- render.exportBundle is for structured interchange such as fcpxml or edl, not for preview movies.
- Do not promise bundle contents you have not verified. State whether the user wants reopening, editorial handoff, or archive packaging.

Monitoring:
- Treat render.start as the beginning of a job, not proof of success.
- If the render stalls or fails, inspect likely causes before retrying: missing assets, broken graph, unsupported format, or upstream generation failure.
- Use render.cancel only when the user wants to stop or when a clearly bad render should not continue consuming time.

Decision tree:
- If the user wants a watchable preview, prefer render.start.
- If the user wants to open the project in an editor or hand off timing data, prefer render.exportBundle.
- If the sequence still has placeholder nodes or missing assets, stop and fix readiness first rather than pushing a doomed render.

Failure recovery:
- A failed render caused by missing assets should trigger asset repair, not blind reruns.
- A failed bundle export should trigger format or path verification before retry.
- After cancellation, report that the job was deliberately stopped so the user does not mistake it for a completed render.

Common failure modes:
- Starting a render from a half-finished graph.
- Confusing preview output with bundle export.
- Retrying repeated failures without diagnosing root cause.
- Ignoring framing or audio mismatches until after the render is already running.`,
  },
  {
    processKey: 'workflow-orchestration',
    name: '工作流编排',
    description: '用于工作流扩展与生命周期控制的指导。',
    defaultValue: `Workflow orchestration guide:

Role of workflows:
- Use workflows when the task is a repeatable multi-step pipeline that benefits from automation, status tracking, or retry control.
- Use manual tool chains when the work is highly bespoke, exploratory, or only needs one or two direct tool calls.
- Workflows should reduce coordination overhead, not hide important creative decisions.

workflow.expandIdea:
- Expand a concept into structured story, scene, or shot-planning text nodes.
- Turn a loose idea into production-usable scaffolding: premise, beats, scenes, or grouped shot ideas that can later feed node creation.
- Because idea expansion changes story shape and creative direction, get commander.askUser approval before executing any substantial creative expansion the user has not already approved.

Creative expansion rules:
- Keep the expansion structured and editable rather than overly literary.
- Separate premise, story beats, scene summaries, and shot implications clearly so later node creation is straightforward.
- Preserve the user's declared genre, tone, and scope. Do not silently invent a different project.

workflow.control:
- Use workflow.control for pause, resume, cancel, or retry operations on existing workflow runs.
- Pause when the user wants to stop progress without losing the current run.
- Resume when prerequisites are ready again and the workflow can continue from a known good state.
- Cancel when the workflow should not continue.
- Retry only after you understand the failure and the workflow has a reasonable chance to succeed.
- Treat retry as appropriate for transient failures, not for deterministic validation or configuration mistakes that still have not changed.

When to choose workflow versus manual tools:
- Use workflows for structured ideation, repeated transformations, or longer-running automation that benefits from status control.
- Use manual tool chains for one-off edits, surgical fixes, or cases where human judgment must stay tightly in the loop.
- If a workflow would hide too many creative choices, do not use it as a shortcut.

Operational discipline:
- Before controlling a workflow, identify the target run clearly.
- After pause, resume, cancel, or retry, report the new state plainly.
- Do not use retry as a magic reset button. Fix or at least identify the reason for failure first, then retry from the existing workflow state rather than pretending the failure never happened.

Quality bar:
- Expansion should create reusable project structure, not disposable brainstorming sludge.
- Workflow control actions should be state-aware and intentional.
- The user should always know whether a workflow is being used for creative expansion or operational control.

workflow.expandIdea usage:
- Use it when the user has approved a concept expansion and needs structured scaffolding rather than polished prose.
- Good outputs are beat maps, act structures, scene summaries, and grouped shot ideas that can later become text nodes or batch-created canvas structures.
- After expansion, review the output critically and translate the useful parts into concrete node plans with canvas.batchCreate or script.write. Do not leave the expansion as dead text.

workflow.control usage:
- pause is for intentionally halting a run while preserving state.
- resume is for continuing after prerequisites or approvals are in place.
- cancel is for ending work that should not continue.
- retry is for transient failures only, and only after the blocking cause has been addressed.

Decision tree:
- If the work is mostly creative exploration with branching choices, stay manual until the user approves direction.
- If the work is a repeatable transformation with clear checkpoints, a workflow can reduce coordination overhead.
- If the failure was deterministic, fix configuration or input first; do not hit workflow.control retry out of habit.
- If the user wants visibility and fine-grained judgment at each step, prefer manual tool chains over opaque automation.

Operational discipline:
1. Identify the workflow run clearly before issuing workflow.control.
2. State why the control action is being taken.
3. After pause, resume, cancel, or retry, report the new state and any remaining risk.
4. If expandIdea output changes story shape materially, route that change through commander.askUser before converting it into project structure.

Failure modes:
- Using workflow.expandIdea without approved creative scope.
- Treating workflow.control retry as a magic reset button for bad inputs.
- Leaving expanded ideas unintegrated into script or canvas structures.
- Hiding creative decisions inside automation where the user expected visible control.`,
  },
];

export class ProcessPromptStore {
  private db: BetterSqlite3.Database;
  private defaults = new Map<string, ProcessPromptDefault>();

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    for (const entry of PROCESS_PROMPT_DEFAULTS) {
      this.defaults.set(entry.processKey, entry);
    }
    this.init();
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
    return this.db.prepare(`
      SELECT
        id,
        process_key AS processKey,
        name,
        description,
        default_value AS defaultValue,
        custom_value AS customValue,
        created_at AS createdAt,
        updated_at AS updatedAt
      FROM process_prompts
      ORDER BY id ASC
    `).all() as ProcessPromptRecord[];
  }

  get(processKey: string): ProcessPromptRecord | null {
    const record = this.db.prepare(`
      SELECT
        id,
        process_key AS processKey,
        name,
        description,
        default_value AS defaultValue,
        custom_value AS customValue,
        created_at AS createdAt,
        updated_at AS updatedAt
      FROM process_prompts
      WHERE process_key = ?
    `).get(processKey) as ProcessPromptRecord | undefined;
    return record ?? null;
  }

  getEffectiveValue(processKey: string): string | null {
    const record = this.get(processKey);
    return record ? (record.customValue ?? record.defaultValue) : null;
  }

  setCustom(processKey: string, value: string): void {
    const existing = this.get(processKey);
    if (!existing) throw new Error(`Process prompt not found: ${processKey}`);
    this.db.prepare(`
      UPDATE process_prompts
      SET custom_value = ?, updated_at = ?
      WHERE process_key = ?
    `).run(value, Date.now(), processKey);
  }

  resetToDefault(processKey: string): void {
    const existing = this.get(processKey);
    if (!existing) throw new Error(`Process prompt not found: ${processKey}`);
    this.db.prepare(`
      UPDATE process_prompts
      SET custom_value = NULL, updated_at = ?
      WHERE process_key = ?
    `).run(Date.now(), processKey);
  }

  close(): void {
    this.db.close();
  }
}
