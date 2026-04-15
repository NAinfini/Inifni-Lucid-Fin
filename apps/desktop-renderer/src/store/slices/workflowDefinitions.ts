import { createSlice, type PayloadAction } from '@reduxjs/toolkit';

const STORAGE_KEY = 'lucid-workflow-definitions-v1';

export interface WorkflowDefEntry {
  id: string;
  name: string;
  category: 'workflow' | 'skill';
  content: string;
  builtIn: boolean;
  createdAt: number;
}

function loadCustomEntries(): WorkflowDefEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as WorkflowDefEntry[]) : [];
  } catch {
    return [];
  }
}

function saveCustomEntries(entries: WorkflowDefEntry[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    /* localStorage unavailable */
  }
}

const BUILT_IN_ENTRIES: WorkflowDefEntry[] = [
  {
    id: 'wf-story-idea-to-video',
    name: 'Story Idea → Video',
    category: 'workflow',
    content: `# Story Idea -> Video

Use this when you only have a premise, mood, or one strong visual hook and need a production-ready canvas.

Goal:
- turn a loose idea into scenes, entities, shot nodes, and approved visual anchors
- establish continuity before expensive batch generation starts

Workflow:
1. Start with a one-sentence logline, target runtime, genre, and emotional arc.
2. Expand the idea into 3 to 7 beats, then turn each beat into a playable scene with location, conflict, and outcome.
3. Extract recurring characters, locations, and hero props early. Create reference images before generating lots of shots.
4. Build a shot list per scene. Give each shot one clear job: establish, reveal, react, transition, or payoff.
5. Generate keyframe images for the anchor shots first. Approve those before creating motion-heavy nodes.
6. Promote the approved look into preset tracks or the project style guide so later shots inherit the same cinematic grammar.
7. Add video nodes only where motion or timing matters. Leave static beats as stills or planning notes.
8. Run one continuity pass across wardrobe, props, lighting direction, and geography before batch generation.

Checks:
- every shot has a visible story function
- recurring entities already have refs
- scene order is readable left to right
- the approved anchor frames actually match the intended tone

Avoid:
- generating final video before the shot list is stable
- inventing new recurring entities in the middle of production
- relying on vague style adjectives instead of specific visual evidence`,
    builtIn: true,
    createdAt: 0,
  },
  {
    id: 'wf-novel-to-video',
    name: 'Novel/Book → Video',
    category: 'workflow',
    content: `# Novel/Book -> Video Adaptation

Use this when the source is long-form prose and the main risk is losing structure, continuity, or adaptation discipline.

Goal:
- compress chapters into a coherent screen spine
- preserve the important character, location, and prop continuity that prose scatters across many pages

Workflow:
1. Break the source into acts, chapters, and candidate scenes. Do not treat every paragraph as screen time.
2. Decide the adaptation spine first: whose point of view leads, what conflict drives the sequence, and what can be omitted.
3. Extract recurring characters, locations, props, costumes, and state changes into a working bible.
4. Create refs for the recurring cast and environments before building shot-heavy canvases.
5. Convert each selected prose scene into a short scene card with objective, obstacle, emotional turn, and visual payoff.
6. Split each scene card into 3 to 8 filmable shots. Favor clear geography and editorial purpose over exhaustive coverage.
7. Use a single style guide per sequence unless the story explicitly calls for a visual shift such as dream, memory, or montage.
8. Generate anchors for chapter openings, climactic reversals, and continuity-sensitive transitions first.
9. Review sequence by sequence so costume state, weather, time of day, and props do not drift across chapters.

Checks:
- the adaptation still has a clear narrative spine
- important recurring entities were extracted only once and reused everywhere
- each scene change is visually motivated, not just copied from prose ordering

Avoid:
- carrying prose-only internal monologue into every shot
- over-cutting quiet scenes that need only one or two strong images
- generating all chapters before testing continuity on a smaller sequence`,
    builtIn: true,
    createdAt: 0,
  },
  {
    id: 'wf-video-clone',
    name: 'Video Clone → Remake',
    category: 'workflow',
    content: `# Video Clone -> Remake

Use this when you want to rebuild the structure of an existing video inside Lucid instead of starting from an empty canvas.

Workflow:
1. Open the Video Clone dialog from the canvas toolbar and choose the source file.
2. Tune scene detection sensitivity. Lower values keep more cuts; higher values merge similar shots.
3. Run the clone. Lucid detects scenes, extracts a keyframe for each scene, and creates a new canvas automatically.
4. Review the generated sequence node by node. Each scene becomes a video node with a source frame and an inferred prompt.
5. Fix bad scene boundaries first. If the detector merged two beats, split them manually before polishing prompts.
6. Refine prompts only after the editorial order feels right. Preserve shot purpose, then improve style language, motion, and subject specificity.
7. Attach recurring character, location, and prop refs so later regenerations stay consistent with the source sequence.
8. Keep first-frame and cross-shot continuity where transitions matter. The extracted frames are most useful as anchors, not as final truth.
9. Regenerate a few representative shots before you batch the whole remake.

Checks:
- scene order matches the source rhythm
- prompts describe the real shot, not a generic summary
- recurring entities are attached with reusable refs
- the remake keeps the original editorial intent even if the style changes

Avoid:
- trusting raw auto-descriptions without human review
- cloning style while losing the original shot structure
- batch-regenerating before you fix incorrect cut detection`,
    builtIn: true,
    createdAt: 0,
  },
  {
    id: 'wf-style-transfer',
    name: 'Style Transfer Across Shots',
    category: 'workflow',
    content: `# Style Transfer Across Shots

Use this when one approved frame already contains the look you want and the rest of the sequence needs to inherit that look without copying its exact subject matter.

Workflow:
1. Pick the strongest finished reference frame. It should already express the palette, contrast, texture, and lighting logic you want.
2. Analyze that frame with image description or style analysis so you can extract reusable look language instead of copying the whole scene.
3. Build a style packet with only transferable traits: rendering medium, palette relationships, lens feel, contrast behavior, grain, atmosphere, and emotional pressure.
4. Move the reusable style into preset tracks or the project style guide first. Rewrite prompts only when shot-specific language still needs help.
5. Keep each target shot's subject, action, and geography intact. Only replace the look layer.
6. Preview one or two representative prompts before a full rewrite so you can catch muddy or conflicting style language early.
7. Regenerate representative shots first, then roll the transfer across the full sequence after approval.

Checks:
- the transferred style stays reusable and does not smuggle in one-off scene content
- preset tracks and prompt text are not fighting each other
- target shots still read as the same story beat after the transfer

Avoid:
- copying exact props, characters, or staging from the reference frame
- stacking multiple incompatible looks into one averaged style mush
- using prompt rewrites for changes that belong in preset tracks`,
    builtIn: true,
    createdAt: 0,
  },
  {
    id: 'sk-reverse-prompt',
    name: 'Reverse Prompt Inference',
    category: 'skill',
    content: `# Reverse Prompt Inference

Use this when you have a finished image and want a clean, reusable prompt instead of a vague visual summary.

Workflow:
1. Start from a real image node or reference frame, not from memory.
2. Ask for the right readout:
   - use prompt-style description when you want a recreation prompt
   - use style analysis when you want reusable look language
3. Break the result into layers before writing anything back:
   - subject and action
   - environment and time cues
   - composition and lens feel
   - lighting and atmosphere
   - style and texture
4. Rebuild the prompt in plain, generation-ready language. Keep only what is actually visible and useful.
5. Remove invented backstory, over-specific guesses, or details the frame does not clearly support.
6. If the goal is modification, keep the stable parts and only swap the layer you want to change.

Checks:
- the rewritten prompt describes visible evidence, not fantasy explanations
- the prompt is clean enough to edit later
- style traits are separated from story content when reuse matters

Avoid:
- pasting the raw description back without editing
- treating uncertain details as facts
- mixing style transfer goals with literal scene reconstruction in one messy prompt`,
    builtIn: true,
    createdAt: 0,
  },
  {
    id: 'sk-lip-sync',
    name: 'Lip Sync Video',
    category: 'skill',
    content: `# Lip Sync Video

Use this when a shot needs readable speech and the speaking performance matters on screen.

Workflow:
1. Keep the setup tight: one visible speaker, one manageable line, one shot with a readable mouth region.
2. Create or reuse a voice audio node for the line. Write the exact dialogue there, not in the video node.
3. Set voice delivery intentionally with a simple emotion vector and a short delivery note such as restrained, urgent, tired, or warm.
4. Generate the audio first so the speech asset exists before the video pass.
5. Connect the audio node to the video node so the editorial relationship is explicit.
6. Enable audio and lip sync on the video node, then set a shot duration that can realistically contain the line.
7. Prefer close or medium shots. If the mouth is tiny in frame, lip sync will not read well no matter how good the audio is.
8. Test one shot before you repeat the setup across an entire dialogue scene.

Checks:
- the line length fits the shot duration
- only one active speaking source is driving the shot
- the framing makes mouth motion legible
- the audio asset succeeded before video generation starts

Avoid:
- wide shots with tiny faces
- multiple overlapping dialogue nodes on one speaking clip
- generating the video before the voice node is ready`,
    builtIn: true,
    createdAt: 0,
  },
  {
    id: 'sk-srt-import',
    name: 'SRT Subtitle Import',
    category: 'skill',
    content: `# SRT Subtitle Import

Use this when timing already exists in subtitle form and you want to turn it into editable canvas structure.

Workflow:
1. Import the SRT from the canvas toolbar once the target canvas is open.
2. Choose the right mode for the job:
   - create nodes when you need a rough script lane on the canvas
   - align to existing video nodes when the sequence order already exists
3. Treat imported lines as timing scaffolding first, not as final polished prompts.
4. Clean up long subtitle lines before turning them into voice nodes. Spoken dialogue usually needs shorter, more breathable chunks.
5. Convert the lines that matter into audio nodes, then add delivery and emotion intentionally instead of keeping raw subtitle wording forever.
6. If aligning to existing shots, review the order visually from left to right and confirm the imported text landed on the intended clips.

Checks:
- subtitle order matches the shot order
- long lines are split where natural cuts or breaths exist
- imported text is reviewed before audio generation

Avoid:
- assuming subtitle text is automatically good voiceover writing
- aligning to a canvas whose shot order is still unstable
- importing once and never checking whether timing or punctuation needs cleanup`,
    builtIn: true,
    createdAt: 0,
  },
  {
    id: 'sk-capcut-export',
    name: 'CapCut Export',
    category: 'skill',
    content: `# CapCut Export

Use this when Lucid has already produced the usable clips and you want a clean editorial handoff for finishing.

Workflow:
1. Finalize order first. CapCut draft export follows the sequence you hand it, so fix shot order before exporting.
2. Export only nodes that already have real assets. Placeholder nodes and empty prompts do not belong in the handoff.
3. Check clip durations, especially for still images or timing-sensitive inserts. The draft exporter will use the duration you provide or the default fallback.
4. Include audio clips when dialogue, narration, or music should already arrive on the edit timeline.
5. Run Export -> CapCut and choose the destination folder. Lucid writes a CapCut draft directory with track metadata and resolved asset paths.
6. Open that draft in CapCut for trimming, transitions, captions, sound balancing, and final polish.

Checks:
- every exported node has a resolved asset
- sequence order is already approved
- durations are sane for both stills and moving clips
- audio clips are included only when they belong on the editorial timeline

Avoid:
- exporting scratch variants instead of the approved clips
- assuming CapCut will fix broken scene order for you
- sending a handoff before the source assets are actually generated`,
    builtIn: true,
    createdAt: 0,
  },
  {
    id: 'sk-semantic-search',
    name: 'Semantic Asset Search',
    category: 'skill',
    content: `# Semantic Asset Search

Use this when filenames and folders are not enough and you need assets by meaning, mood, or described content.

Workflow:
1. Open the Asset Browser and switch to semantic search mode.
2. Write natural language queries that describe what you need, such as subject, setting, mood, or action.
3. Start broad, then refine with stronger constraints: camera angle, environment, object type, color story, or emotional tone.
4. Inspect the top results instead of trusting the first hit blindly. Semantic ranking is useful, but you still need creative judgment.
5. Re-index after large imports so newly added assets are actually searchable.
6. When a query works well repeatedly, turn that pattern into better tags, naming, or a saved retrieval habit for the team.

Good query patterns:
- rainy neon alley with backlit silhouette
- clean product close-up on white sweep
- quiet forest dawn atmosphere plate

Checks:
- the search text describes meaning, not just guessed filenames
- results are reviewed visually before reuse
- the index is refreshed after major library changes

Avoid:
- one-word queries that are too vague
- assuming high score means perfect fit
- forgetting to re-index after importing new material`,
    builtIn: true,
    createdAt: 0,
  },
  {
    id: 'sk-multi-view',
    name: 'Multi-View Canvas Editing',
    category: 'skill',
    content: `# Multi-View Canvas Editing

Use this when the canvas is doing too many jobs at once and you need to switch between structure, detail work, and audio review without losing context.

Views:
- Main: full graph view for sequence planning, layout, and connection sanity checks
- Edit: focused refinement for one selected node when prompt or params need concentrated attention
- Audio: voice, music, and SFX review without the visual graph getting in the way
- Materials: asset-oriented review space for media inspection and library checks as that view evolves

Recommended rhythm:
1. Rough in the sequence in Main view so order and dependencies are obvious.
2. Jump to Edit view only when one node needs concentrated prompt, preset, or provider work.
3. Use Audio view when dialogue timing, narration, music, or lip-sync relationships need review.
4. Return to Main view for continuity, missing-edge checks, and final sequencing decisions.
5. Use Materials view for asset audit or retrieval tasks instead of cluttering the graph with library browsing.

Checks:
- each view change has a purpose
- you return to Main view before large batch actions
- audio review happens before lip-sync-sensitive renders

Avoid:
- doing every task in Main view until the graph becomes unreadable
- editing prompts in bulk without returning to the sequence overview
- treating Materials as final editorial truth when it is still a supporting review surface`,
    builtIn: true,
    createdAt: 0,
  },
];

const BUILT_IN_ENTRY_NAME_BY_ID = new Map(BUILT_IN_ENTRIES.map((entry) => [entry.id, entry.name]));

export interface WorkflowDefinitionsState {
  entries: WorkflowDefEntry[];
}

const initialState: WorkflowDefinitionsState = {
  entries: [...BUILT_IN_ENTRIES, ...loadCustomEntries()],
};

export const workflowDefinitionsSlice = createSlice({
  name: 'workflowDefinitions',
  initialState,
  reducers: {
    addEntry(
      state,
      action: PayloadAction<{ name: string; category: 'workflow' | 'skill'; content: string }>,
    ) {
      const entry: WorkflowDefEntry = {
        id: `custom-wf-${Date.now()}`,
        name: action.payload.name,
        category: action.payload.category,
        content: action.payload.content,
        builtIn: false,
        createdAt: Date.now(),
      };
      state.entries.push(entry);
      saveCustomEntries(state.entries.filter((e) => !e.builtIn));
    },
    updateEntry(state, action: PayloadAction<{ id: string; name: string; content: string }>) {
      const entry = state.entries.find((e) => e.id === action.payload.id);
      if (!entry) return;
      entry.name = action.payload.name;
      entry.content = action.payload.content;
      saveCustomEntries(state.entries.filter((e) => !e.builtIn));
    },
    removeEntry(state, action: PayloadAction<string>) {
      const idx = state.entries.findIndex((e) => e.id === action.payload);
      if (idx === -1 || state.entries[idx].builtIn) return;
      state.entries.splice(idx, 1);
      saveCustomEntries(state.entries.filter((e) => !e.builtIn));
    },
  },
});

export const { addEntry, updateEntry, removeEntry } = workflowDefinitionsSlice.actions;

export function getDefaultWorkflowDefinitionName(id: string): string | undefined {
  return BUILT_IN_ENTRY_NAME_BY_ID.get(id);
}
