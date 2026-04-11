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
import styleTransfer from '../../../../../docs/ai-video-prompt-guide/09-style-transfer.md?raw';
import shotListFromScript from '../../../../../docs/ai-video-prompt-guide/10-shot-list-from-script.md?raw';
import batchRePrompt from '../../../../../docs/ai-video-prompt-guide/11-batch-re-prompt.md?raw';
import continuityCheck from '../../../../../docs/ai-video-prompt-guide/12-continuity-check.md?raw';
import storyboardExport from '../../../../../docs/ai-video-prompt-guide/13-storyboard-export.md?raw';
import videoCloneGuide from '../../../../../docs/ai-video-prompt-guide/15-video-clone.md?raw';
import dualPromptGuide from '../../../../../docs/ai-video-prompt-guide/16-dual-prompt-strategy.md?raw';
import emotionVoiceGuide from '../../../../../docs/ai-video-prompt-guide/17-emotion-voice-prompting.md?raw';
import lipSyncGuide from '../../../../../docs/ai-video-prompt-guide/18-lip-sync-workflow.md?raw';

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
  { id: 'style-transfer', name: 'Style Transfer', category: 'skill', defaultContent: styleTransfer },
  { id: 'shot-list-from-script', name: 'Shot List from Script', category: 'skill', defaultContent: shotListFromScript },
  { id: 'batch-re-prompt', name: 'Batch Re-Prompt', category: 'skill', defaultContent: batchRePrompt },
  { id: 'continuity-check', name: 'Continuity Check', category: 'skill', defaultContent: continuityCheck },
  { id: 'storyboard-export', name: 'Storyboard Export', category: 'skill', defaultContent: storyboardExport },
  { id: 'video-clone', name: 'Video Clone & Scene Analysis', category: 'skill', defaultContent: videoCloneGuide },
  { id: 'dual-prompt-strategy', name: 'Dual Prompt Strategy', category: 'skill', defaultContent: dualPromptGuide },
  { id: 'emotion-voice-prompting', name: 'Emotion & Voice Prompting', category: 'audio', defaultContent: emotionVoiceGuide },
  { id: 'lip-sync-workflow', name: 'Lip Sync Workflow', category: 'skill', defaultContent: lipSyncGuide },
];

interface StoredCustomTemplate {
  id: string;
  name: string;
  category: string;
  customContent: string | null;
}

interface PromptTemplateStorage {
  builtInCustoms: Record<string, string | null>;
  builtInNames: Record<string, string>;
  customTemplates: StoredCustomTemplate[];
}

const DEFAULT_TEMPLATE_IDS = new Set(DEFAULTS.map((template) => template.id));
const DEFAULT_TEMPLATE_NAME_BY_ID = new Map(DEFAULTS.map((template) => [template.id, template.name]));

function isStoredCustomTemplate(value: unknown): value is StoredCustomTemplate {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.name === 'string' &&
    typeof candidate.category === 'string' &&
    (typeof candidate.customContent === 'string' || candidate.customContent === null)
  );
}

function filterStringOrNullRecord(value: Record<string, unknown>): Record<string, string | null> {
  const result: Record<string, string | null> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === 'string' || entry === null) {
      result[key] = entry;
    }
  }
  return result;
}

function filterStringRecord(value: Record<string, unknown>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === 'string') {
      result[key] = entry;
    }
  }
  return result;
}

function loadStorage(): PromptTemplateStorage {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return { builtInCustoms: {}, builtInNames: {}, customTemplates: [] };
    }

    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const candidate = parsed as Record<string, unknown>;
      const builtInCustomsValue = candidate.builtInCustoms;
      const builtInNamesValue = candidate.builtInNames;
      const customTemplatesValue = candidate.customTemplates;

      if (
        builtInCustomsValue &&
        typeof builtInCustomsValue === 'object' &&
        !Array.isArray(builtInCustomsValue) &&
        Array.isArray(customTemplatesValue)
      ) {
        const builtInCustoms = filterStringOrNullRecord(
          builtInCustomsValue as Record<string, unknown>,
        );
        const builtInNames =
          builtInNamesValue && typeof builtInNamesValue === 'object' && !Array.isArray(builtInNamesValue)
            ? filterStringRecord(builtInNamesValue as Record<string, unknown>)
            : {};

        return {
          builtInCustoms,
          builtInNames,
          customTemplates: customTemplatesValue.filter(isStoredCustomTemplate),
        };
      }

      return {
        builtInCustoms: filterStringOrNullRecord(candidate),
        builtInNames: {},
        customTemplates: [],
      };
    }

    return { builtInCustoms: {}, builtInNames: {}, customTemplates: [] };
  } catch {
    return { builtInCustoms: {}, builtInNames: {}, customTemplates: [] };
  }
}

function saveTemplates(templates: PromptTemplate[]): void {
  const builtInCustoms: Record<string, string | null> = {};
  const builtInNames: Record<string, string> = {};
  const customTemplates: StoredCustomTemplate[] = [];

  for (const template of templates) {
    if (DEFAULT_TEMPLATE_IDS.has(template.id)) {
      const defaultName = DEFAULT_TEMPLATE_NAME_BY_ID.get(template.id);
      if (template.customContent !== null) {
        builtInCustoms[template.id] = template.customContent;
      }
      if (defaultName && template.name !== defaultName) {
        builtInNames[template.id] = template.name;
      }
      continue;
    }

    customTemplates.push({
      id: template.id,
      name: template.name,
      category: template.category,
      customContent: template.customContent,
    });
  }

  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        builtInCustoms,
        builtInNames,
        customTemplates,
      } satisfies PromptTemplateStorage),
    );
  } catch {
    // localStorage unavailable
  }
}

function buildInitialTemplates(): PromptTemplate[] {
  const storage = loadStorage();
  const builtInTemplates = DEFAULTS.map((template) => ({
    ...template,
    name: storage.builtInNames[template.id] ?? template.name,
    customContent: storage.builtInCustoms[template.id] ?? null,
  }));
  const customTemplates = storage.customTemplates
    .map((template) => ({
      id: template.id,
      name: template.name,
      category: template.category,
      defaultContent: '',
      customContent: template.customContent,
    }))
    .filter((template) => !DEFAULT_TEMPLATE_IDS.has(template.id));

  return [...builtInTemplates, ...customTemplates];
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
      saveTemplates(state.templates);
    },
    resetContent(state, action: PayloadAction<string>) {
      const tpl = state.templates.find((t) => t.id === action.payload);
      if (!tpl) return;
      tpl.customContent = null;
      const defaultName = DEFAULT_TEMPLATE_NAME_BY_ID.get(tpl.id);
      if (defaultName) {
        tpl.name = defaultName;
      }
      saveTemplates(state.templates);
    },
    resetAllContent(state) {
      for (const t of state.templates) {
        t.customContent = null;
        const defaultName = DEFAULT_TEMPLATE_NAME_BY_ID.get(t.id);
        if (defaultName) {
          t.name = defaultName;
        }
      }
      saveTemplates(state.templates);
    },
    renameTemplate(state, action: PayloadAction<{ id: string; name: string }>) {
      const tpl = state.templates.find((t) => t.id === action.payload.id);
      if (!tpl) return;
      tpl.name = action.payload.name;
      saveTemplates(state.templates);
    },
    addCustomTemplate(state, action: PayloadAction<{ id: string; name: string; category: string; content: string }>) {
      state.templates.push({
        id: action.payload.id,
        name: action.payload.name,
        category: action.payload.category,
        defaultContent: '',
        customContent: action.payload.content,
      });
      saveTemplates(state.templates);
    },
    removeCustomTemplate(state, action: PayloadAction<string>) {
      const idx = state.templates.findIndex((t) => t.id === action.payload);
      if (idx === -1) return;
      // Only allow removing templates with no defaultContent (user-created)
      if (state.templates[idx].defaultContent) return;
      state.templates.splice(idx, 1);
      saveTemplates(state.templates);
    },
  },
});

export const {
  setCustomContent,
  resetContent,
  resetAllContent,
  renameTemplate,
  addCustomTemplate,
  removeCustomTemplate,
} = promptTemplatesSlice.actions;

export function getDefaultPromptTemplateName(id: string): string | undefined {
  return DEFAULT_TEMPLATE_NAME_BY_ID.get(id);
}

export function isDefaultPromptTemplateName(id: string, name: string): boolean {
  return DEFAULT_TEMPLATE_NAME_BY_ID.get(id) === name;
}

/** Returns the active content (custom if set, else default) for each template */
export function selectActiveTemplates(templates: PromptTemplate[]): Array<{ id: string; name: string; content: string }> {
  return templates.map((t) => ({
    id: t.id,
    name: t.name,
    content: t.customContent ?? t.defaultContent,
  }));
}
