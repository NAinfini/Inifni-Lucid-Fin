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
    content: `# Story Idea → Video

From a short story idea, expand into a full video production:
1. Commander AI expands the story concept into scenes and characters
2. Create character/location entities with reference images
3. Build shot list with camera, lighting, timing
4. Apply shot templates and presets
5. Generate key frames, then convert to video clips`,
    builtIn: true,
    createdAt: 0,
  },
  {
    id: 'wf-novel-to-video',
    name: 'Novel/Book → Video',
    category: 'workflow',
    content: `# Novel/Book → Video Adaptation

Adapt a long novel or book into video:
1. Parse text structure — chapters, scenes, key moments
2. Extract characters with 15-20 physical traits each
3. Extract equipment/props and locations
4. Generate reference images for all entities
5. Segment key moments into 3-8 shots each
6. Apply consistent style guide across all shots
7. Batch generate and review for consistency`,
    builtIn: true,
    createdAt: 0,
  },
  {
    id: 'wf-video-clone',
    name: 'Video Clone → Remake',
    category: 'workflow',
    content: `# Video Clone → Remake

Reverse-engineer and remake an existing video:
1. Open Clone Video dialog from the Canvas Toolbar (Film icon)
2. Select a source video file and adjust scene detection sensitivity
3. System detects scene cuts, extracts keyframes, and auto-describes each frame
4. A new canvas is created with one video node per scene
5. Review and refine the AI-generated prompts for each shot
6. Adjust style guide to match your desired aesthetic
7. Regenerate individual shots or batch regenerate all
8. Use cross-frame continuity for smooth transitions`,
    builtIn: true,
    createdAt: 0,
  },
  {
    id: 'wf-style-transfer',
    name: 'Style Transfer Across Shots',
    category: 'workflow',
    content: `# Style Transfer Across Shots

Apply a consistent visual style from a reference across all shots:
1. Generate or upload a reference image with the desired style
2. Use vision.describeImage with style="style-analysis" to extract style characteristics
3. Apply extracted style to the project's Style Guide settings
4. Use workflow.batchRePrompt to rewrite all node prompts with the new style
5. Regenerate shots — they will follow the unified style`,
    builtIn: true,
    createdAt: 0,
  },
  {
    id: 'sk-reverse-prompt',
    name: 'Reverse Prompt Inference',
    category: 'skill',
    content: `# Reverse Prompt Inference

Extract a generation-ready prompt from any existing image:
1. Select an image node on the canvas
2. Ask Commander: "describe this image" or use vision.describeImage directly
3. Choose style: "prompt" for recreation, "style-analysis" for structured breakdown
4. Apply the result to imagePrompt, videoPrompt, or the base prompt field
5. Use as a starting point for regeneration with modifications`,
    builtIn: true,
    createdAt: 0,
  },
  {
    id: 'sk-lip-sync',
    name: 'Lip Sync Video',
    category: 'skill',
    content: `# Lip Sync Video

Add lip-synced mouth motion to generated video clips:
1. Create a voice audio node with the dialogue text
2. Set the emotion vector to match the scene mood
3. Generate the TTS audio
4. Connect the audio node to the video node via an edge
5. Enable lip sync on the video node (lipSyncEnabled = true)
6. Generate or regenerate the video — lip sync runs automatically after generation`,
    builtIn: true,
    createdAt: 0,
  },
  {
    id: 'sk-srt-import',
    name: 'SRT Subtitle Import',
    category: 'skill',
    content: `# SRT Subtitle Import

Import SRT subtitles to create timed audio nodes:
1. Import an SRT file via the Canvas Toolbar
2. Each subtitle entry becomes a text or audio node
3. Optionally align subtitles to existing video nodes by timing
4. Use as a starting point for voice-over generation with emotion vectors`,
    builtIn: true,
    createdAt: 0,
  },
  {
    id: 'sk-capcut-export',
    name: 'CapCut Export',
    category: 'skill',
    content: `# CapCut Export

Export canvas as a CapCut-compatible project:
1. Arrange all video nodes in the desired sequence
2. Set scene numbers and shot order on each node
3. Set duration overrides if needed
4. Export via Canvas Toolbar → Export → CapCut
5. Import the generated draft folder into CapCut for final editing`,
    builtIn: true,
    createdAt: 0,
  },
  {
    id: 'sk-semantic-search',
    name: 'Semantic Asset Search',
    category: 'skill',
    content: `# Semantic Asset Search

Find assets by meaning, not just filename:
1. Open the Asset Browser panel
2. Toggle the Semantic Search mode (brain icon)
3. Type a natural language query (e.g. "sunset over mountains")
4. Results are ranked by relevance score
5. Use "Re-index" to update embeddings after importing new assets`,
    builtIn: true,
    createdAt: 0,
  },
  {
    id: 'sk-multi-view',
    name: 'Multi-View Canvas Editing',
    category: 'skill',
    content: `# Multi-View Canvas Editing

Switch between specialized canvas views:
- Main: Full node graph with connections (default)
- Edit: Focus on a single node for detailed prompt editing
- Audio: Audio-centric view for voice/music/SFX workflow
- Materials: Browse and manage assets used in the canvas

Use the view switcher in the Canvas Toolbar to switch modes.`,
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
