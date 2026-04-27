import { createSlice, type PayloadAction } from '@reduxjs/toolkit';

// Bundled at build time via Vite ?raw imports (former promptTemplates defaults).
import metaPrompt from '../../../../../docs/ai-video-prompt-guide/00-meta-prompt.md?raw';
import promptStructure from '../../../../../docs/ai-video-prompt-guide/01-prompt-structure.md?raw';
import cameraComposition from '../../../../../docs/ai-video-prompt-guide/02-camera-and-composition.md?raw';
import lightingAtmosphere from '../../../../../docs/ai-video-prompt-guide/03-lighting-and-atmosphere.md?raw';
import motionEmotion from '../../../../../docs/ai-video-prompt-guide/04-motion-and-emotion.md?raw';
import styleAesthetics from '../../../../../docs/ai-video-prompt-guide/05-style-and-aesthetics.md?raw';
import workflowMethods from '../../../../../docs/ai-video-prompt-guide/06-workflow-methods.md?raw';
import modelAdaptation from '../../../../../docs/ai-video-prompt-guide/07-model-specific-adaptation.md?raw';
import audioPrompting from '../../../../../docs/ai-video-prompt-guide/08-audio-prompting.md?raw';
import styleTransferGuide from '../../../../../docs/ai-video-prompt-guide/09-style-transfer.md?raw';
import shotListFromScript from '../../../../../docs/ai-video-prompt-guide/10-shot-list-from-script.md?raw';
import batchRePrompt from '../../../../../docs/ai-video-prompt-guide/11-batch-re-prompt.md?raw';
import continuityCheck from '../../../../../docs/ai-video-prompt-guide/12-continuity-check.md?raw';
import storyboardExport from '../../../../../docs/ai-video-prompt-guide/13-storyboard-export.md?raw';
import videoCloneGuide from '../../../../../docs/ai-video-prompt-guide/15-video-clone.md?raw';
import dualPromptGuide from '../../../../../docs/ai-video-prompt-guide/16-dual-prompt-strategy.md?raw';
import emotionVoiceGuide from '../../../../../docs/ai-video-prompt-guide/17-emotion-voice-prompting.md?raw';
import lipSyncGuide from '../../../../../docs/ai-video-prompt-guide/18-lip-sync-workflow.md?raw';

// Former workflowDefinitions BUILT_IN_ENTRIES, loaded from their own md files.
import wfNovelToVideo from '../../../../../docs/ai-skills/skills/wf-novel-to-video.md?raw';
import wfVideoCloneRemake from '../../../../../docs/ai-skills/skills/wf-video-clone.md?raw';
import wfStyleTransferSkill from '../../../../../docs/ai-skills/skills/wf-style-transfer.md?raw';
import skReversePrompt from '../../../../../docs/ai-skills/skills/sk-reverse-prompt.md?raw';
import skLipSync from '../../../../../docs/ai-skills/skills/sk-lip-sync.md?raw';
import skSrtImport from '../../../../../docs/ai-skills/skills/sk-srt-import.md?raw';
import skCapcutExport from '../../../../../docs/ai-skills/skills/sk-capcut-export.md?raw';
import skSemanticSearch from '../../../../../docs/ai-skills/skills/sk-semantic-search.md?raw';
import skMultiView from '../../../../../docs/ai-skills/skills/sk-multi-view.md?raw';

// Commander-side WORKFLOW_GUIDES, loaded as renderer-visible skills so users
// can read/override them in the same Settings surface. Keeping them bundled
// here mirrors the previous main-side WORKFLOW_GUIDES constant — the main
// process no longer needs to merge its own copy because every guide now
// flows through renderer → IPC.
import wfgStyleTransfer from '../../../../../docs/ai-skills/workflows/style-transfer.md?raw';
import wfgShotList from '../../../../../docs/ai-skills/workflows/shot-list.md?raw';
import wfgContinuityCheck from '../../../../../docs/ai-skills/workflows/continuity-check.md?raw';
import wfgImageAnalyze from '../../../../../docs/ai-skills/workflows/image-analyze.md?raw';
import wfgAudioProduction from '../../../../../docs/ai-skills/workflows/audio-production.md?raw';
import wfgStoryToVideo from '../../../../../docs/ai-skills/workflows/story-to-video.md?raw';
import wfgStylePlate from '../../../../../docs/ai-skills/workflows/style-plate.md?raw';

const STORAGE_KEY = 'lucid-skills-v1';

/**
 * Unified skill definition — the single source of truth for every LLM-visible
 * prompt guide / workflow / skill entry shown in Settings and shipped to
 * Commander via `promptGuides` over IPC.
 *
 * `source` tags where the built-in originated so UIs and migrations can
 * distinguish cohorts; it is not used for any runtime behavior.
 */
export type SkillSource = 'promptTemplate' | 'workflowSkill' | 'workflowGuide' | 'user';
export type SkillCategory =
  | 'system'
  | 'core'
  | 'visual'
  | 'audio'
  | 'skill'
  | 'workflow'
  | 'process';

export interface SkillDefinition {
  id: string;
  name: string;
  category: SkillCategory | string;
  defaultContent: string;
  customContent: string | null;
  builtIn: boolean;
  source: SkillSource;
  createdAt: number;
  autoInject?: boolean;
}

interface BuiltInSeed {
  id: string;
  name: string;
  category: SkillCategory;
  defaultContent: string;
  source: SkillSource;
  autoInject?: boolean;
}

const BUILT_IN_SEEDS: BuiltInSeed[] = [
  // promptTemplate cohort (18)
  { id: 'meta-prompt', name: 'Meta-Prompt (AI Instructor)', category: 'system', defaultContent: metaPrompt, source: 'promptTemplate' },
  { id: 'prompt-structure', name: 'Prompt Structure & Fundamentals', category: 'core', defaultContent: promptStructure, source: 'promptTemplate', autoInject: true },
  { id: 'camera-composition', name: 'Camera & Composition', category: 'visual', defaultContent: cameraComposition, source: 'promptTemplate' },
  { id: 'lighting-atmosphere', name: 'Lighting & Atmosphere', category: 'visual', defaultContent: lightingAtmosphere, source: 'promptTemplate' },
  { id: 'motion-emotion', name: 'Motion & Emotion', category: 'visual', defaultContent: motionEmotion, source: 'promptTemplate' },
  { id: 'style-aesthetics', name: 'Style & Aesthetics', category: 'visual', defaultContent: styleAesthetics, source: 'promptTemplate' },
  { id: 'workflow-methods', name: 'Workflow Methods', category: 'process', defaultContent: workflowMethods, source: 'promptTemplate' },
  { id: 'model-adaptation', name: 'Model-Specific Adaptation', category: 'system', defaultContent: modelAdaptation, source: 'promptTemplate' },
  { id: 'audio-prompting', name: 'Audio Prompting', category: 'audio', defaultContent: audioPrompting, source: 'promptTemplate' },
  { id: 'style-transfer', name: 'Style Transfer', category: 'skill', defaultContent: styleTransferGuide, source: 'promptTemplate' },
  { id: 'shot-list-from-script', name: 'Shot List from Script', category: 'skill', defaultContent: shotListFromScript, source: 'promptTemplate' },
  { id: 'batch-re-prompt', name: 'Batch Re-Prompt', category: 'skill', defaultContent: batchRePrompt, source: 'promptTemplate' },
  { id: 'continuity-check', name: 'Continuity Check', category: 'skill', defaultContent: continuityCheck, source: 'promptTemplate' },
  { id: 'storyboard-export', name: 'Storyboard Export', category: 'skill', defaultContent: storyboardExport, source: 'promptTemplate' },
  { id: 'video-clone', name: 'Video Clone & Scene Analysis', category: 'skill', defaultContent: videoCloneGuide, source: 'promptTemplate' },
  { id: 'dual-prompt-strategy', name: 'Dual Prompt Strategy', category: 'skill', defaultContent: dualPromptGuide, source: 'promptTemplate' },
  { id: 'emotion-voice-prompting', name: 'Emotion & Voice Prompting', category: 'audio', defaultContent: emotionVoiceGuide, source: 'promptTemplate' },
  { id: 'lip-sync-workflow', name: 'Lip Sync Workflow', category: 'skill', defaultContent: lipSyncGuide, source: 'promptTemplate' },

  // workflowDefinitions cohort (9)
  { id: 'wf-novel-to-video', name: 'Novel/Book → Video', category: 'workflow', defaultContent: wfNovelToVideo, source: 'workflowSkill' },
  { id: 'wf-video-clone', name: 'Video Clone → Remake', category: 'workflow', defaultContent: wfVideoCloneRemake, source: 'workflowSkill' },
  { id: 'wf-style-transfer', name: 'Style Transfer Across Shots', category: 'workflow', defaultContent: wfStyleTransferSkill, source: 'workflowSkill' },
  { id: 'sk-reverse-prompt', name: 'Reverse Prompt Inference', category: 'skill', defaultContent: skReversePrompt, source: 'workflowSkill' },
  { id: 'sk-lip-sync', name: 'Lip Sync Video', category: 'skill', defaultContent: skLipSync, source: 'workflowSkill' },
  { id: 'sk-srt-import', name: 'SRT Subtitle Import', category: 'skill', defaultContent: skSrtImport, source: 'workflowSkill' },
  { id: 'sk-capcut-export', name: 'CapCut Export', category: 'skill', defaultContent: skCapcutExport, source: 'workflowSkill' },
  { id: 'sk-semantic-search', name: 'Semantic Asset Search', category: 'skill', defaultContent: skSemanticSearch, source: 'workflowSkill' },
  { id: 'sk-multi-view', name: 'Multi-View Canvas Editing', category: 'skill', defaultContent: skMultiView, source: 'workflowSkill' },

  // WORKFLOW_GUIDES cohort — Commander-facing multi-step guides. Phase 4
  // trimmed the set: video-clone + storyboard-export dropped (the tools
  // remain; the guides were rarely-read narrative rewrites of tool docs);
  // batch-reprompt merged into continuity-check as a follow-up section;
  // lip-sync + emotion-voice merged into workflow-audio-production as
  // stage 1 / stage 2 of one pipeline.
  { id: 'workflow-style-transfer', name: 'Style Transfer (Commander)', category: 'workflow', defaultContent: wfgStyleTransfer, source: 'workflowGuide' },
  { id: 'workflow-shot-list', name: 'Shot List (Commander)', category: 'workflow', defaultContent: wfgShotList, source: 'workflowGuide' },
  { id: 'workflow-continuity-check', name: 'Continuity Check + Batch Re-Prompt (Commander)', category: 'workflow', defaultContent: wfgContinuityCheck, source: 'workflowGuide' },
  { id: 'workflow-image-analyze', name: 'Image Analyze (Commander)', category: 'workflow', defaultContent: wfgImageAnalyze, source: 'workflowGuide' },
  { id: 'workflow-audio-production', name: 'Audio Production — Voice + Lip Sync (Commander)', category: 'workflow', defaultContent: wfgAudioProduction, source: 'workflowGuide' },
  { id: 'workflow-story-to-video', name: 'Story to Video (Commander)', category: 'workflow', defaultContent: wfgStoryToVideo, source: 'workflowGuide', autoInject: true },
  { id: 'workflow-style-plate', name: 'Style Plate Lock (Commander)', category: 'workflow', defaultContent: wfgStylePlate, source: 'workflowGuide', autoInject: true },
];

const BUILT_IN_ID_SET = new Set(BUILT_IN_SEEDS.map((s) => s.id));
const BUILT_IN_NAME_BY_ID = new Map(BUILT_IN_SEEDS.map((s) => [s.id, s.name]));

interface StoredCustomSkill {
  id: string;
  name: string;
  category: string;
  customContent: string | null;
  source: SkillSource;
  createdAt: number;
}

interface SkillsStorage {
  /** Overrides on built-in defaultContent. null = no override. */
  builtInCustoms: Record<string, string | null>;
  /** Overrides on built-in display names. */
  builtInNames: Record<string, string>;
  /** User-authored entries with no built-in counterpart. */
  customSkills: StoredCustomSkill[];
}

function loadStorage(): SkillsStorage {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as SkillsStorage;
      return {
        builtInCustoms: parsed.builtInCustoms ?? {},
        builtInNames: parsed.builtInNames ?? {},
        customSkills: Array.isArray(parsed.customSkills) ? parsed.customSkills : [],
      };
    }
  } catch { /* malformed — fall through to empty */ }

  return {
    builtInCustoms: {},
    builtInNames: {},
    customSkills: [],
  };
}

function saveSkills(skills: SkillDefinition[]): void {
  const storage: SkillsStorage = {
    builtInCustoms: {},
    builtInNames: {},
    customSkills: [],
  };

  for (const skill of skills) {
    if (BUILT_IN_ID_SET.has(skill.id)) {
      if (skill.customContent !== null) {
        storage.builtInCustoms[skill.id] = skill.customContent;
      }
      const defaultName = BUILT_IN_NAME_BY_ID.get(skill.id);
      if (defaultName && skill.name !== defaultName) {
        storage.builtInNames[skill.id] = skill.name;
      }
      continue;
    }
    storage.customSkills.push({
      id: skill.id,
      name: skill.name,
      category: skill.category,
      customContent: skill.customContent,
      source: skill.source,
      createdAt: skill.createdAt,
    });
  }

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(storage));
  } catch { /* best-effort */ }
}

function buildInitialSkills(): SkillDefinition[] {
  const storage = loadStorage();

  const built: SkillDefinition[] = BUILT_IN_SEEDS.map((seed) => ({
    id: seed.id,
    name: storage.builtInNames[seed.id] ?? seed.name,
    category: seed.category,
    defaultContent: seed.defaultContent,
    customContent: storage.builtInCustoms[seed.id] ?? null,
    builtIn: true,
    source: seed.source,
    createdAt: 0,
    ...(seed.autoInject ? { autoInject: true } : {}),
  }));

  const custom: SkillDefinition[] = storage.customSkills
    .filter((c) => !BUILT_IN_ID_SET.has(c.id))
    .map((c) => ({
      id: c.id,
      name: c.name,
      category: c.category,
      defaultContent: '',
      customContent: c.customContent,
      builtIn: false,
      source: c.source,
      createdAt: c.createdAt,
    }));

  return [...built, ...custom];
}

export interface SkillDefinitionsState {
  skills: SkillDefinition[];
}

const initialState: SkillDefinitionsState = {
  skills: buildInitialSkills(),
};

export const skillDefinitionsSlice = createSlice({
  name: 'skillDefinitions',
  initialState,
  reducers: {
    setCustomContent(state, action: PayloadAction<{ id: string; content: string }>) {
      const s = state.skills.find((t) => t.id === action.payload.id);
      if (!s) return;
      s.customContent = action.payload.content;
      saveSkills(state.skills);
    },
    resetContent(state, action: PayloadAction<string>) {
      const s = state.skills.find((t) => t.id === action.payload);
      if (!s || !s.builtIn) return;
      s.customContent = null;
      const defaultName = BUILT_IN_NAME_BY_ID.get(s.id);
      if (defaultName) s.name = defaultName;
      saveSkills(state.skills);
    },
    resetAllContent(state) {
      for (const s of state.skills) {
        if (!s.builtIn) continue;
        s.customContent = null;
        const defaultName = BUILT_IN_NAME_BY_ID.get(s.id);
        if (defaultName) s.name = defaultName;
      }
      saveSkills(state.skills);
    },
    renameSkill(state, action: PayloadAction<{ id: string; name: string }>) {
      const s = state.skills.find((t) => t.id === action.payload.id);
      if (!s) return;
      s.name = action.payload.name;
      saveSkills(state.skills);
    },
    addCustomSkill(
      state,
      action: PayloadAction<{ id?: string; name: string; category: string; content: string }>,
    ) {
      const id = action.payload.id ?? `custom-${Date.now()}`;
      if (state.skills.some((s) => s.id === id)) return;
      state.skills.push({
        id,
        name: action.payload.name,
        category: action.payload.category,
        defaultContent: '',
        customContent: action.payload.content,
        builtIn: false,
        source: 'user',
        createdAt: Date.now(),
      });
      saveSkills(state.skills);
    },
    removeCustomSkill(state, action: PayloadAction<string>) {
      const idx = state.skills.findIndex((t) => t.id === action.payload);
      if (idx === -1 || state.skills[idx].builtIn) return;
      state.skills.splice(idx, 1);
      saveSkills(state.skills);
    },
  },
});

export const {
  setCustomContent,
  resetContent,
  resetAllContent,
  renameSkill,
  addCustomSkill,
  removeCustomSkill,
} = skillDefinitionsSlice.actions;

export function getDefaultSkillName(id: string): string | undefined {
  return BUILT_IN_NAME_BY_ID.get(id);
}

export function isBuiltInSkillId(id: string): boolean {
  return BUILT_IN_ID_SET.has(id);
}

/**
 * Project a flat `{id, name, content}[]` for Commander's `promptGuides` IPC.
 * Active content = custom override when present, otherwise the built-in default.
 */
export function selectActiveSkills(
  skills: SkillDefinition[],
): Array<{ id: string; name: string; content: string; autoInject?: boolean }> {
  return skills.map((s) => ({
    id: s.id,
    name: s.name,
    content: s.customContent ?? s.defaultContent,
    ...(s.autoInject ? { autoInject: true } : {}),
  }));
}
