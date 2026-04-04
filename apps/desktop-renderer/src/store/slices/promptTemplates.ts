import { createSlice, type PayloadAction } from '@reduxjs/toolkit';

// Bundled at build time via Vite ?raw imports
import metaPrompt from '../../../../../docs/ai-video-prompt-guide/00-meta-prompt.md?raw';
import promptStructure from '../../../../../docs/ai-video-prompt-guide/01-prompt-structure.md?raw';
import cameraComposition from '../../../../../docs/ai-video-prompt-guide/02-camera-and-composition.md?raw';
import lightingAtmosphere from '../../../../../docs/ai-video-prompt-guide/03-lighting-and-atmosphere.md?raw';
import motionEmotion from '../../../../../docs/ai-video-prompt-guide/04-motion-and-emotion.md?raw';
import styleAesthetics from '../../../../../docs/ai-video-prompt-guide/05-style-and-aesthetics.md?raw';
import workflowMethods from '../../../../../docs/ai-video-prompt-guide/06-workflow-methods.md?raw';
import modelAdaptation from '../../../../../docs/ai-video-prompt-guide/07-model-specific-adaptation.md?raw';
import audioPrompting from '../../../../../docs/ai-video-prompt-guide/08-audio-prompting.md?raw';

const STORAGE_KEY = 'lucid-prompt-templates-v1';

export interface PromptTemplate {
  id: string;
  name: string;
  category: string;
  defaultContent: string;
  customContent: string | null;
}

const DEFAULTS: Omit<PromptTemplate, 'customContent'>[] = [
  { id: 'meta-prompt', name: 'Meta-Prompt (AI Instructor)', category: 'system', defaultContent: metaPrompt },
  { id: 'prompt-structure', name: 'Prompt Structure & Fundamentals', category: 'core', defaultContent: promptStructure },
  { id: 'camera-composition', name: 'Camera & Composition', category: 'visual', defaultContent: cameraComposition },
  { id: 'lighting-atmosphere', name: 'Lighting & Atmosphere', category: 'visual', defaultContent: lightingAtmosphere },
  { id: 'motion-emotion', name: 'Motion & Emotion', category: 'visual', defaultContent: motionEmotion },
  { id: 'style-aesthetics', name: 'Style & Aesthetics', category: 'visual', defaultContent: styleAesthetics },
  { id: 'workflow-methods', name: 'Workflow Methods', category: 'process', defaultContent: workflowMethods },
  { id: 'model-adaptation', name: 'Model-Specific Adaptation', category: 'system', defaultContent: modelAdaptation },
  { id: 'audio-prompting', name: 'Audio Prompting', category: 'audio', defaultContent: audioPrompting },
];

function loadCustoms(): Record<string, string | null> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, string | null>) : {};
  } catch {
    return {};
  }
}

function saveCustoms(customs: Record<string, string | null>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(customs));
  } catch {
    // localStorage unavailable
  }
}

function buildInitialTemplates(): PromptTemplate[] {
  const customs = loadCustoms();
  return DEFAULTS.map((d) => ({ ...d, customContent: customs[d.id] ?? null }));
}

export interface PromptTemplatesState {
  templates: PromptTemplate[];
}

const initialState: PromptTemplatesState = {
  templates: buildInitialTemplates(),
};

export const promptTemplatesSlice = createSlice({
  name: 'promptTemplates',
  initialState,
  reducers: {
    setCustomContent(state, action: PayloadAction<{ id: string; content: string }>) {
      const tpl = state.templates.find((t) => t.id === action.payload.id);
      if (!tpl) return;
      tpl.customContent = action.payload.content;
      const customs: Record<string, string | null> = {};
      for (const t of state.templates) {
        if (t.customContent !== null) customs[t.id] = t.customContent;
      }
      saveCustoms(customs);
    },
    resetContent(state, action: PayloadAction<string>) {
      const tpl = state.templates.find((t) => t.id === action.payload);
      if (!tpl) return;
      tpl.customContent = null;
      const customs: Record<string, string | null> = {};
      for (const t of state.templates) {
        if (t.customContent !== null) customs[t.id] = t.customContent;
      }
      saveCustoms(customs);
    },
    resetAllContent(state) {
      for (const t of state.templates) {
        t.customContent = null;
      }
      saveCustoms({});
    },
  },
});

export const { setCustomContent, resetContent, resetAllContent } = promptTemplatesSlice.actions;

/** Returns the active content (custom if set, else default) for each template */
export function selectActiveTemplates(templates: PromptTemplate[]): Array<{ id: string; name: string; content: string }> {
  return templates.map((t) => ({
    id: t.id,
    name: t.name,
    content: t.customContent ?? t.defaultContent,
  }));
}
