import { availableLocales, messages, type Locale, type NestedMessages } from './i18n.messages.js';

let currentLocale: Locale = loadLocale();
const listeners = new Set<() => void>();

function loadLocale(): Locale {
  try {
    const stored = localStorage.getItem('lucid-fin:locale');
    if (stored === 'zh-CN' || stored === 'en-US') return stored;

    const sys = navigator.language;
    if (sys.startsWith('zh')) return 'zh-CN';
    return 'en-US';
  } catch {
    /* localStorage unavailable (e.g. SSR or restricted context) — use default locale */
    return 'zh-CN';
  }
}

function localizeWithFallback(key: string, fallback: string): string {
  const result = t(key);
  return result !== key ? result : fallback;
}

export function setLocale(locale: Locale): void {
  currentLocale = locale;

  try {
    localStorage.setItem('lucid-fin:locale', locale);
  } catch {
    /* localStorage unavailable — locale preference will not persist */
    // localStorage unavailable
  }

  listeners.forEach((fn) => fn());
}

export function getLocale(): Locale {
  return currentLocale;
}

export function t(key: string): string {
  const parts = key.split('.');
  let obj: NestedMessages | string = messages[currentLocale];

  for (const part of parts) {
    if (typeof obj === 'string') return key;
    obj = obj[part];
    if (obj === undefined) return key;
  }

  return typeof obj === 'string' ? obj : key;
}

export function onLocaleChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getAvailableLocales(): Locale[] {
  return [...availableLocales];
}

export function localizePresetName(name: string): string {
  return localizeWithFallback('presetNames.' + name, name);
}

export function localizePresetDescription(
  category: string,
  name: string,
  fallbackDesc: string,
): string {
  const localizedName = localizePresetName(name);
  const localizedCategory = localizeWithFallback('presetCategory.' + category, category);
  const template = t('presetDescriptionTemplate');
  if (template && template !== 'presetDescriptionTemplate') {
    return template.replace('{name}', localizedName).replace('{category}', localizedCategory);
  }
  return fallbackDesc;
}

export function localizeSlot(slot: string): string {
  const result = t('slots.' + slot);
  if (result !== 'slots.' + slot) return result;
  return slot.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export function localizeShotTemplateName(id: string, fallback: string): string {
  return localizeWithFallback('shotTemplateNames.' + id, fallback);
}

export function localizeShotTemplateDescription(id: string, fallback: string): string {
  return localizeWithFallback('shotTemplateDescriptions.' + id, fallback);
}

/**
 * Localize a preset parameter label (e.g. "Crop Tightness" → "裁剪紧度").
 * Looks up `presetParamLabels.<key>`, falls back to the English label.
 */
export function localizeParamLabel(key: string, fallback: string): string {
  return localizeWithFallback('presetParamLabels.' + key, fallback);
}

/**
 * Localize a preset parameter option or intensity level label.
 * These are display-only — the underlying value for prompt templates stays English.
 * Looks up `presetParamValues.<value>`, falls back to the English string.
 */
export function localizeParamValue(value: string): string {
  // Normalize to a key-friendly format (spaces → underscores, lowercase)
  const key = value.toLowerCase().replace(/\s+/g, '_');
  return localizeWithFallback('presetParamValues.' + key, value);
}

export function localizePromptTemplateName(id: string, fallback: string): string {
  return localizeWithFallback('promptTemplateNames.' + id, fallback);
}

export function localizeProcessPromptName(processKey: string, fallback: string): string {
  return localizeWithFallback('processPromptNames.' + processKey, fallback);
}

export function localizeProcessPromptDescription(processKey: string, fallback: string): string {
  return localizeWithFallback('processPromptDescriptions.' + processKey, fallback);
}

export function localizeWorkflowDefinitionName(id: string, fallback: string): string {
  return localizeWithFallback('workflowDefinitionNames.' + id, fallback);
}

/**
 * Localize a guide/skill display name by checking all three name maps
 * (promptTemplateNames, workflowDefinitionNames, workflowGuideNames)
 * for a built-in id. Returns the fallback (usually the raw English
 * name) when no localized entry exists — this preserves user-renamed
 * custom skills and any id we haven't translated yet.
 */
export function localizeSkillName(id: string, fallback: string): string {
  const candidates = [
    'promptTemplateNames.' + id,
    'workflowDefinitionNames.' + id,
    'workflowGuideNames.' + id,
  ];
  for (const key of candidates) {
    const translated = localizeWithFallback(key, key);
    if (translated !== key) return translated;
  }
  return fallback;
}

export function localizeToolName(toolName: string): string {
  return localizeWithFallback('toolNames.' + toolName, toolName);
}

export function localizeSettingsCategory(category: string): string {
  return localizeWithFallback('settings.category.' + category, category);
}
