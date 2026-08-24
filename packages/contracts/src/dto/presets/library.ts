/**
 * Built-in preset library assembly.
 *
 * Merges chunked PRESET_TEMPLATE_* fragments into a single frozen table,
 * then builds PresetDefinition entries for every (category, name) pair
 * declared in PRESET_NAME_LIBRARY. Exports both the merged template table
 * and the finalized BUILT_IN_PRESET_LIBRARY.
 */
import type {
  PresetCategory,
  PresetDefinition,
  PresetParamDefinition,
  PresetParamMap,
} from './core.js';
import { PRESET_CATEGORIES } from './core.js';
import {
  ASPECT_RATIO_BY_NAME,
  CATEGORY_DEFAULTS,
  CATEGORY_PARAM_DEFS,
  PRESET_NAME_LIBRARY,
  buildFallbackPresetPrompt,
  buildPresetDescription,
  buildPresetId,
} from './params.js';
import { PRESET_PROMPT_LIBRARY } from './prompts.js';
import type { PresetTemplateEntry } from './templates-types.js';
import { PRESET_TEMPLATES_a } from './templates-a.js';
import { PRESET_TEMPLATES_b } from './templates-b.js';
import { PRESET_TEMPLATES_c } from './templates-c.js';
import { PRESET_TEMPLATES_d } from './templates-d.js';
import { PRESET_TEMPLATES_e } from './templates-e.js';
import { PRESET_TEMPLATES_f } from './templates-f.js';

const PRESET_TEMPLATE_LIBRARY: Record<string, PresetTemplateEntry> = {
  ...PRESET_TEMPLATES_a,
  ...PRESET_TEMPLATES_b,
  ...PRESET_TEMPLATES_c,
  ...PRESET_TEMPLATES_d,
  ...PRESET_TEMPLATES_e,
  ...PRESET_TEMPLATES_f,
};

const INTENSITY_LEVELS = {
  0: 'barely perceptible',
  25: 'subtle',
  50: 'balanced',
  75: 'strong',
  100: 'dominant',
} as const;

function buildAudioPromptTemplate(
  category: PresetCategory,
  prompt: string,
): PresetTemplateEntry | undefined {
  if (category === 'voice-style') {
    return {
      template: `${prompt}; {pace} pacing; {intensity} vocal presence`,
      paramDefs: [
        {
          key: 'pace',
          label: 'Pace',
          type: 'select',
          default: 'moderate',
          options: ['slow', 'moderate', 'fast'],
        },
        {
          key: 'intensity',
          label: 'Intensity',
          type: 'intensity',
          default: 100,
          levels: INTENSITY_LEVELS,
        },
      ],
    };
  }
  if (category === 'music-genre') {
    return {
      template: `${prompt}; {tempo} tempo; {intensity} arrangement energy`,
      paramDefs: [
        {
          key: 'tempo',
          label: 'Tempo',
          type: 'select',
          default: 'moderate',
          options: ['slow', 'moderate', 'fast', 'variable'],
        },
        {
          key: 'intensity',
          label: 'Intensity',
          type: 'intensity',
          default: 100,
          levels: INTENSITY_LEVELS,
        },
      ],
    };
  }
  if (category === 'sfx-environment') {
    return {
      template: `${prompt}; {reverb}; {intensity} environmental presence`,
      paramDefs: [
        {
          key: 'reverb',
          label: 'Reverb',
          type: 'intensity',
          default: 40,
          levels: {
            0: 'dry, nearly reflection-free acoustics',
            25: 'light natural room reverb',
            50: 'moderate spatial reverb',
            75: 'strong reverberant decay',
            100: 'very long cavernous reverb',
          },
        },
        {
          key: 'intensity',
          label: 'Intensity',
          type: 'intensity',
          default: 100,
          levels: INTENSITY_LEVELS,
        },
      ],
    };
  }
  return undefined;
}

function buildPresetPrompt(category: PresetCategory, name: string): string {
  return PRESET_PROMPT_LIBRARY[`${category}:${name}`] ?? buildFallbackPresetPrompt(category, name);
}

function buildDefaults(category: PresetCategory, name: string): PresetParamMap {
  if (category !== 'technical' || !ASPECT_RATIO_BY_NAME[name]) {
    return { ...CATEGORY_DEFAULTS[category] };
  }
  const ratio = ASPECT_RATIO_BY_NAME[name] ?? '16:9';
  return { ...CATEGORY_DEFAULTS.technical, ratio };
}

function cloneParamDefs(category: PresetCategory): PresetParamDefinition[] {
  return CATEGORY_PARAM_DEFS[category].map((param) => ({
    ...param,
    options: param.options ? [...param.options] : undefined,
  }));
}

const builtInPresetLibrary = PRESET_CATEGORIES.flatMap((category) => {
  return PRESET_NAME_LIBRARY[category].map((name): PresetDefinition => {
    const defaults = buildDefaults(category, name);
    const prompt = buildPresetPrompt(category, name);

    const preset: PresetDefinition = {
      id: buildPresetId(category, name),
      category,
      name,
      description: buildPresetDescription(category, name),
      prompt,
      builtIn: true,
      modified: false,
      defaultPrompt: prompt,
      defaultParams: { ...defaults },
      params: cloneParamDefs(category),
      defaults,
    };

    const presetKey = `${category}:${name}`;
    const templateEntry =
      PRESET_TEMPLATE_LIBRARY[presetKey] ?? buildAudioPromptTemplate(category, prompt);
    if (templateEntry) {
      preset.promptTemplate = templateEntry.template;
      preset.promptParamDefs = templateEntry.paramDefs;
      if (templateEntry.conflictGroup) {
        preset.conflictGroup = templateEntry.conflictGroup;
      }
    }

    return preset;
  });
});

if (builtInPresetLibrary.length !== 216) {
  throw new Error(
    `BUILT_IN_PRESET_LIBRARY must contain 216 presets, got ${builtInPresetLibrary.length}`,
  );
}

export const BUILT_IN_PRESET_LIBRARY: PresetDefinition[] = builtInPresetLibrary;
