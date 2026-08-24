import { COMMANDER_GUIDE_LIMITS } from '@lucid-fin/contracts';
import { createSlice, type PayloadAction } from '@reduxjs/toolkit';

// Bundled at build time via Vite ?raw imports (former promptTemplates defaults).
import metaPrompt from '../../../../../docs/ai-video-prompt-guide/00-meta-prompt.md?raw';
import promptStructure from '../../../../../docs/ai-video-prompt-guide/01-prompt-structure.md?raw';
import cameraComposition from '../../../../../docs/ai-video-prompt-guide/02-camera-and-composition.md?raw';
import lightingAtmosphere from '../../../../../docs/ai-video-prompt-guide/03-lighting-and-atmosphere.md?raw';
import motionEmotion from '../../../../../docs/ai-video-prompt-guide/04-motion-and-emotion.md?raw';
import styleAesthetics from '../../../../../docs/ai-video-prompt-guide/05-style-and-aesthetics.md?raw';
import taskMethods from '../../../../../docs/ai-video-prompt-guide/06-task-methods.md?raw';
import modelAdaptation from '../../../../../docs/ai-video-prompt-guide/07-model-specific-adaptation.md?raw';
import audioPrompting from '../../../../../docs/ai-video-prompt-guide/08-audio-prompting.md?raw';
import styleTransferGuide from '../../../../../docs/ai-video-prompt-guide/09-style-transfer.md?raw';
import shotListFromScript from '../../../../../docs/ai-video-prompt-guide/10-shot-list-from-script.md?raw';
import batchRePrompt from '../../../../../docs/ai-video-prompt-guide/11-batch-re-prompt.md?raw';
import continuityCheck from '../../../../../docs/ai-video-prompt-guide/12-continuity-check.md?raw';
import dualPromptGuide from '../../../../../docs/ai-video-prompt-guide/16-dual-prompt-strategy.md?raw';
import emotionVoiceGuide from '../../../../../docs/ai-video-prompt-guide/17-emotion-voice-prompting.md?raw';

// Reusable task and skill guides, loaded from their own markdown files.
import taskNovelToVideo from '../../../../../docs/ai-skills/skills/task-novel-to-video.md?raw';
import taskStyleTransferSkill from '../../../../../docs/ai-skills/skills/task-style-transfer.md?raw';
import skReversePrompt from '../../../../../docs/ai-skills/skills/sk-reverse-prompt.md?raw';
import skMultiView from '../../../../../docs/ai-skills/skills/sk-multi-view.md?raw';

// Commander task-list guides are renderer-visible so users can read or
// override the same content that flows through renderer → IPC.
import taskGuideStyleTransfer from '../../../../../docs/ai-skills/task-list-guides/style-transfer.md?raw';
import taskGuideShotList from '../../../../../docs/ai-skills/task-list-guides/shot-list.md?raw';
import taskGuideContinuityCheck from '../../../../../docs/ai-skills/task-list-guides/continuity-check.md?raw';
import taskGuideImageAnalyze from '../../../../../docs/ai-skills/task-list-guides/image-analyze.md?raw';
import taskGuideAudioProduction from '../../../../../docs/ai-skills/task-list-guides/audio-production.md?raw';
import taskGuideStoryToVideo from '../../../../../docs/ai-skills/task-list-guides/story-to-video.md?raw';
import taskGuideStylePlate from '../../../../../docs/ai-skills/task-list-guides/style-plate.md?raw';

export const SKILL_DEFINITIONS_STORAGE_KEY = 'lucid-skills-v2' as const;

/**
 * Unified skill definition — the single source of truth for every LLM-visible
 * prompt guide / task guide / skill entry shown in Settings and shipped to
 * Commander via `promptGuides` over IPC.
 *
 * `source` tags where the built-in originated so UIs and migrations can
 * distinguish cohorts; it is not used for any runtime behavior.
 */
export type SkillSource = 'promptTemplate' | 'taskSkill' | 'taskListGuide' | 'user';
export type SkillCategory = 'system' | 'core' | 'visual' | 'audio' | 'skill' | 'task' | 'process';

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
  autoInjectContent?: string;
  priority?: number;
  retention?: 'turn' | 'task_list' | 'discovery';
  phases?: Array<
    | 'unbound'
    | 'production_plan_pending'
    | 'production_plan_revision'
    | 'style_exploration'
    | 'visual_constitution_pending'
    | 'preproduction'
    | 'media_generation'
    | 'assembly'
    | 'delivery_preparation'
    | 'delivery_pending'
    | 'delivery_approved'
    | 'blocked'
  >;
}

interface BuiltInSeed {
  id: string;
  name: string;
  category: SkillCategory;
  defaultContent: string;
  source: SkillSource;
  autoInject?: boolean;
  autoInjectContent?: string;
  priority?: number;
  retention?: SkillDefinition['retention'];
  phases?: SkillDefinition['phases'];
}

const BUILT_IN_SEEDS: BuiltInSeed[] = [
  // promptTemplate cohort (15)
  {
    id: 'meta-prompt',
    name: 'Meta-Prompt (AI Instructor)',
    category: 'system',
    defaultContent: metaPrompt,
    source: 'promptTemplate',
  },
  {
    id: 'prompt-structure',
    name: 'Prompt Structure & Fundamentals',
    category: 'core',
    defaultContent: promptStructure,
    source: 'promptTemplate',
  },
  {
    id: 'camera-composition',
    name: 'Camera & Composition',
    category: 'visual',
    defaultContent: cameraComposition,
    source: 'promptTemplate',
  },
  {
    id: 'lighting-atmosphere',
    name: 'Lighting & Atmosphere',
    category: 'visual',
    defaultContent: lightingAtmosphere,
    source: 'promptTemplate',
  },
  {
    id: 'motion-emotion',
    name: 'Motion & Emotion',
    category: 'visual',
    defaultContent: motionEmotion,
    source: 'promptTemplate',
  },
  {
    id: 'style-aesthetics',
    name: 'Style & Aesthetics',
    category: 'visual',
    defaultContent: styleAesthetics,
    source: 'promptTemplate',
  },
  {
    id: 'task-methods',
    name: 'Task Planning Methods',
    category: 'process',
    defaultContent: taskMethods,
    source: 'promptTemplate',
  },
  {
    id: 'model-adaptation',
    name: 'Model-Specific Adaptation',
    category: 'system',
    defaultContent: modelAdaptation,
    source: 'promptTemplate',
  },
  {
    id: 'audio-prompting',
    name: 'Audio Prompting',
    category: 'audio',
    defaultContent: audioPrompting,
    source: 'promptTemplate',
  },
  {
    id: 'style-transfer',
    name: 'Style Transfer',
    category: 'skill',
    defaultContent: styleTransferGuide,
    source: 'promptTemplate',
  },
  {
    id: 'shot-list-from-script',
    name: 'Shot List from Script',
    category: 'skill',
    defaultContent: shotListFromScript,
    source: 'promptTemplate',
  },
  {
    id: 'batch-re-prompt',
    name: 'Batch Re-Prompt',
    category: 'skill',
    defaultContent: batchRePrompt,
    source: 'promptTemplate',
  },
  {
    id: 'continuity-check',
    name: 'Continuity Check',
    category: 'skill',
    defaultContent: continuityCheck,
    source: 'promptTemplate',
  },
  {
    id: 'dual-prompt-strategy',
    name: 'Dual Prompt Strategy',
    category: 'skill',
    defaultContent: dualPromptGuide,
    source: 'promptTemplate',
  },
  {
    id: 'emotion-voice-prompting',
    name: 'Emotion & Voice Prompting',
    category: 'audio',
    defaultContent: emotionVoiceGuide,
    source: 'promptTemplate',
  },
  // Reusable taskSkill cohort (4)
  {
    id: 'task-novel-to-video',
    name: 'Novel/Book → Video',
    category: 'task',
    defaultContent: taskNovelToVideo,
    source: 'taskSkill',
  },
  {
    id: 'task-style-transfer',
    name: 'Style Transfer Across Shots',
    category: 'task',
    defaultContent: taskStyleTransferSkill,
    source: 'taskSkill',
  },
  {
    id: 'sk-reverse-prompt',
    name: 'Reverse Prompt Inference',
    category: 'skill',
    defaultContent: skReversePrompt,
    source: 'taskSkill',
  },
  {
    id: 'sk-multi-view',
    name: 'Multi-View Canvas Editing',
    category: 'skill',
    defaultContent: skMultiView,
    source: 'taskSkill',
  },

  // Commander-facing taskListGuide cohort (7).
  // trimmed the set: storyboard-export dropped because its guide was a
  // rarely-read narrative rewrite of tool docs;
  // batch-reprompt merged into continuity-check as a follow-up section;
  // emotion-voice is covered by the durable audio-production task-list guide.
  {
    id: 'task-guide-style-transfer',
    name: 'Style Transfer (Commander)',
    category: 'task',
    defaultContent: taskGuideStyleTransfer,
    source: 'taskListGuide',
  },
  {
    id: 'task-guide-shot-list',
    name: 'Shot List (Commander)',
    category: 'task',
    defaultContent: taskGuideShotList,
    source: 'taskListGuide',
  },
  {
    id: 'task-guide-continuity-check',
    name: 'Continuity Check + Batch Re-Prompt (Commander)',
    category: 'task',
    defaultContent: taskGuideContinuityCheck,
    source: 'taskListGuide',
  },
  {
    id: 'task-guide-image-analyze',
    name: 'Image Analyze (Commander)',
    category: 'task',
    defaultContent: taskGuideImageAnalyze,
    source: 'taskListGuide',
  },
  {
    id: 'task-guide-audio-production',
    name: 'Audio Production — Voice (Commander)',
    category: 'task',
    defaultContent: taskGuideAudioProduction,
    source: 'taskListGuide',
  },
  {
    id: 'task-guide-story-to-video',
    name: 'Story to Video (Commander)',
    category: 'task',
    defaultContent: taskGuideStoryToVideo,
    source: 'taskListGuide',
  },
  {
    id: 'task-guide-style-plate',
    name: 'Visual Style Draft (Commander)',
    category: 'task',
    defaultContent: taskGuideStylePlate,
    source: 'taskListGuide',
  },
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

export interface LegacySkillsV2Export {
  readonly storageKey: typeof SKILL_DEFINITIONS_STORAGE_KEY;
  readonly rawJson: string;
  readonly rawHash: string;
}

/** Explicit maintenance/cutover export; migration validates the payload strictly. */
export async function exportLegacySkillsV2(
  storage: Pick<Storage, 'getItem'> = localStorage,
): Promise<LegacySkillsV2Export> {
  const rawJson =
    storage.getItem(SKILL_DEFINITIONS_STORAGE_KEY) ??
    JSON.stringify({ builtInCustoms: {}, builtInNames: {}, customSkills: [] });
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(rawJson));
  return {
    storageKey: SKILL_DEFINITIONS_STORAGE_KEY,
    rawJson,
    rawHash: [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join(''),
  };
}

function loadStorage(): SkillsStorage {
  try {
    const raw = localStorage.getItem(SKILL_DEFINITIONS_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as SkillsStorage;
      return {
        builtInCustoms: parsed.builtInCustoms ?? {},
        builtInNames: parsed.builtInNames ?? {},
        customSkills: Array.isArray(parsed.customSkills) ? parsed.customSkills : [],
      };
    }
  } catch {
    /* malformed — fall through to empty */
  }

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
    localStorage.setItem(SKILL_DEFINITIONS_STORAGE_KEY, JSON.stringify(storage));
  } catch {
    /* best-effort */
  }
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
    ...(seed.autoInjectContent ? { autoInjectContent: seed.autoInjectContent } : {}),
    ...(seed.priority !== undefined ? { priority: seed.priority } : {}),
    ...(seed.retention ? { retention: seed.retention } : {}),
    ...(seed.phases ? { phases: seed.phases } : {}),
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
      if (action.payload.content.length > getSkillContentLimit(s.source)) return;
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
      if (action.payload.content.length > getSkillContentLimit('user')) return;
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

export function getSkillContentLimit(source: SkillSource): number {
  switch (source) {
    case 'promptTemplate':
      return COMMANDER_GUIDE_LIMITS.maxPromptTemplateChars;
    case 'taskSkill':
      return COMMANDER_GUIDE_LIMITS.maxTaskSkillChars;
    case 'taskListGuide':
      return COMMANDER_GUIDE_LIMITS.maxTaskListGuideChars;
    case 'user':
      return COMMANDER_GUIDE_LIMITS.maxUserGuideChars;
    default:
      return COMMANDER_GUIDE_LIMITS.maxUserGuideChars;
  }
}

/**
 * Project a flat `{id, name, content}[]` for Commander's `promptGuides` IPC.
 * Active content = custom override when present, otherwise the built-in default.
 */
export function selectActiveSkills(
  skills: SkillDefinition[],
): import('@lucid-fin/contracts').CommanderPromptGuide[] {
  return skills.flatMap((s) => {
    const content = s.customContent ?? s.defaultContent;
    if (content.length > getSkillContentLimit(s.source)) return [];
    return [
      {
        id: s.id,
        name: s.name,
        content,
        ...(s.autoInject ? { autoInject: true } : {}),
        ...(s.autoInjectContent ? { autoInjectContent: s.autoInjectContent } : {}),
        ...(s.priority !== undefined ? { priority: s.priority } : {}),
        ...(s.retention ? { retention: s.retention } : {}),
        ...(s.phases ? { phases: s.phases } : {}),
      },
    ];
  });
}
