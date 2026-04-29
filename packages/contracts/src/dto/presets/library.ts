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
  CATEGORY_PROMPT_HINT,
  PRESET_NAME_LIBRARY,
  buildPresetDescription,
  buildPresetId,
  toTitleCase,
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

function buildPresetPrompt(category: PresetCategory, name: string): string {
  return (
    PRESET_PROMPT_LIBRARY[`${category}:${name}`] ??
    `${toTitleCase(name)}, ${CATEGORY_PROMPT_HINT[category]}`
  );
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
    const templateEntry = PRESET_TEMPLATE_LIBRARY[presetKey];
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

if (builtInPresetLibrary.length !== 186) {
  throw new Error(
    `BUILT_IN_PRESET_LIBRARY must contain 186 presets, got ${builtInPresetLibrary.length}`,
  );
}

export const BUILT_IN_PRESET_LIBRARY: PresetDefinition[] = builtInPresetLibrary;
