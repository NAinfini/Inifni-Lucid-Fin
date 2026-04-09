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
  } catch { /* localStorage unavailable */ }
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
];

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
    addEntry(state, action: PayloadAction<{ name: string; category: 'workflow' | 'skill'; content: string }>) {
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
